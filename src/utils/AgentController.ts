import {Mutex} from "async-mutex";
import {SerializableElementData} from "./BrowserHelper";
import Port = chrome.runtime.Port;
import {v4 as uuidV4} from 'uuid';
import {Logger} from "loglevel";
import {createNamedLogger} from "./shared_logging_setup";
import {OpenAiEngine} from "./OpenAiEngine";
import {
    Action, Background2PagePortMsgType, buildGenericActionDesc, expectedMsgForPortDisconnection, sleep,
    Page2BackgroundPortMsgType
} from "./misc";
import {formatChoices, generatePrompt, LmmPrompts, postProcessActionLlm, StrTriple} from "./format_prompts";
import {getIndexFromOptionName} from "./format_prompt_utils";
import {ChromeWrapper} from "./ChromeWrapper";

/**
 * states for the agent controller FSM
 */
export enum AgentControllerState {
    IDLE,//i.e. no active task
    WAITING_FOR_CONTENT_SCRIPT_INIT,//there's an active task, but injection of content script hasn't completed yet
    ACTIVE,//partway through an event handler function
    WAITING_FOR_PAGE_STATE,// waiting for content script to retrieve page state (e.g. interactive elements) from page
    WAITING_FOR_ACTION,//waiting for content script to perform an action on an element
    PENDING_RECONNECT//content script disconnected, but waiting for new connection to be established when the onDisconnect listener gets to run
}

/**
 * distinguishes between different types of no-op actions
 */
enum NoopType {
    INVALID_ELEMENT,//ai gave invalid element name
    ACTION_INCOMPATIBLE_WITH_NONE_OF_ABOVE_ELEMENT,//ai chose 'none of the above' option for element but also chose an action that requires a target element
    AI_SELECTED_NONE_ACTION//ai selected the NONE action
}

/**
 * allows simplification of the method that consults the LLM to determine the next action based on a new page state
 */
enum LmmOutputReaction {
    ABORT_TASK,
    PROCEED_WITH_ACTION,
    TRY_REPROMPT
}

/**
 * used to store information about the current AI-suggested action, so that the controller can later make decisions,
 * logs, and records based on detailed information if the action fails
 */
type ActionInfo = { elementIndex?: number, elementData?: SerializableElementData, action: Action, value?: string };

/**
 * used to store information about an action that was performed, so that the controller can give the AI a clear history
 * of what actions have been tried and what the results were
 */
type ActionRecord = { actionDesc: string, success: boolean, noopType?: NoopType };

//todo explore whether it might be possible to break this into multiple classes, or at least if there are
// pure/non-state-affecting helper functions that could be extracted from existing code and then moved to
// controller_utils file
/**
 * @description Controller for the agent that completes tasks for the user in their browser
 */
export class AgentController {
    readonly mutex = new Mutex();

    taskId: string | undefined = undefined;
    private taskSpecification: string = "";
    currTaskTabId: number | undefined;


    private tentativeActionInfo: ActionInfo | undefined;
    private mightNextActionCausePageNav: boolean = false;

    private actionsSoFar: ActionRecord[] = [];

    /**
     * total number of operations (successful or not) within current task (excluding noops)
     */
    opsCount: number = 0;
    /**
     * total number of noops within current task
     */
    noopCount: number = 0;
    /**
     * total number of failed actions within current task
     */
    failureCount: number = 0;
    /**
     * length of current streak of noops and/or failures
     */
    failureOrNoopStreak: number = 0;

    //todo get below limits from chrome.storage rather than hard-coding (when/where to do that retrieval? constructor?)
    // that would also involve setting those limits via options menu
    /**
     * max number of total operations (successful or not) allowed in a task
     */
    maxOpsLimit: number = 20;
    /**
     * max number of total noops allowed in a task before it is terminated
     */
    maxNoopLimit: number = 4;
    /**
     * max number of total failed operations allowed in a task before it is terminated
     */
    maxFailureLimit: number = 5;
    /**
     * max length of streak of noops and/or failures allowed in a task before it is terminated
     */
    maxFailureOrNoopStreakLimit: number = 2;


    state: AgentControllerState = AgentControllerState.IDLE;

    currPortToContentScript: Port | undefined;
    private aiEngine: OpenAiEngine;
    private chromeWrapper: ChromeWrapper;
    readonly logger: Logger;

    /**
     * @description Constructor for the AgentController
     * @param aiEngine The OpenAiEngine instance to use for analyzing the situation and generating actions
     * @param chromeWrapper a wrapper to allow mocking of Chrome extension API calls
     */
    constructor(aiEngine: OpenAiEngine, chromeWrapper?: ChromeWrapper) {
        this.aiEngine = aiEngine;
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();

        this.logger = createNamedLogger('agent-controller', true);
        this.logger.debug(`max ops limit: ${this.maxOpsLimit}, max noop limit: ${this.maxNoopLimit}, max failure limit: ${this.maxFailureLimit}, max failure-or-noop streak limit: ${this.maxFailureOrNoopStreakLimit}`);
    }


    /**
     * @description Injects the agent's page-interaction/data-gathering script into the current tab
     * @param isStartOfTask Whether this injection is to start a new task or to continue an existing one (e.g. after
     *                      a page navigation)
     * @param sendResponse Optional callback to send a response back to the caller if it's a start-of-task injection
     * @param newTab optional tab object to inject the script into, to avoid wasted effort if the caller has already
     *                identified the active tab
     */
    injectPageActorScript = async (isStartOfTask: boolean, sendResponse?: (response?: any) => void, newTab?: chrome.tabs.Tab): Promise<void> => {
        let tabId: number | undefined = undefined;
        let tab: chrome.tabs.Tab | undefined = newTab;
        if (!tab) {
            try {
                tab = await this.getActiveTab();
            } catch (error) {
                this.logger.error(`error ${error} getting active tab id, cannot inject content script; full error object:${JSON.stringify(error)}`);
                this.terminateTask();
                sendResponse?.({success: false, message: `Can't get tab id because of error: ${error}`});
                return;
            }
        }
        tabId = tab.id;
        if (!tabId) {
            this.logger.warn("Can't inject agent script into chrome:// URLs for security reasons; " + isStartOfTask ? "please only try to start the agent on a regular web page." : "please don't switch to a chrome:// URL while the agent is running");
            this.terminateTask();
            sendResponse?.({success: false, message: "Can't inject script in a chrome:// URL"});
        } else {
            const toStartTaskStr = isStartOfTask ? " to start a task" : "";

            if (isStartOfTask) {
                this.currTaskTabId = tabId;
            } else if (this.currTaskTabId !== tabId) {
                if (this.mightNextActionCausePageNav) {
                    this.currTaskTabId = tabId;
                } else {
                    const errMsg = `The active tab changed unexpectedly to ${tab.title}. Terminating task.`;
                    this.logger.error(errMsg);
                    this.terminateTask();
                    sendResponse?.({success: false, message: errMsg});
                    return;
                }
            }
            this.logger.trace("injecting agent script into page" + toStartTaskStr + "; in tab " + tabId);

            this.state = AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT;
            try {
                await this.chromeWrapper.runScript({files: ['./src/page_interaction.js'], target: {tabId: tabId}});
                this.logger.trace('agent script injected into page' + toStartTaskStr);
                sendResponse?.({success: true, taskId: this.taskId, message: "Started content script in current tab"});
            } catch (error) {
                this.logger.error(`error injecting agent script into page${toStartTaskStr}; error: ${error}; jsonified error: ${JSON.stringify(error)}`);
                this.terminateTask();
                sendResponse?.({success: false, message: "Error injecting agent script into page" + toStartTaskStr});
            }
        }
    }


    /**
     * @description Starts a new task for the agent to complete
     * @param request The request object describing the new task
     * @param sendResponse The callback to send a response back to the caller that requested the new task
     */
    startTask = async (request: any, sendResponse: (response?: any) => void): Promise<void> => {
        if (this.taskId !== undefined) {
            const taskRejectMsg = `Task ${this.taskId} already in progress; not starting new task`;
            this.logger.warn(taskRejectMsg);
            sendResponse({success: false, message: taskRejectMsg});
        } else {
            this.taskId = uuidV4();
            this.taskSpecification = request.taskSpecification;
            this.logger.info(`STARTING TASK ${this.taskId} with specification: ${this.taskSpecification}`);
            try {
                await this.injectPageActorScript(true, sendResponse)
            } catch (error: any) {
                this.logger.error(`error injecting content script to start task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                this.terminateTask();
                sendResponse({success: false, message: `Error injecting content script to start task: ${error}`});
            }
        }
    }

    /**
     * @description deals with notification from content script that the page actor is ready to accept requests from
     * the controller
     * @param port the port object representing the connection between the service worker and the content script
     */
    processPageActorInitialized = (port: Port): void => {
        if (this.state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
            this.logger.error("received 'content script initialized and ready' message from content script while not waiting for content script initialization, but rather in state " + AgentControllerState[this.state]);
            this.terminateTask();
            return;
        }
        this.logger.trace("content script initialized and ready; requesting interactive elements")

        this.state = AgentControllerState.WAITING_FOR_PAGE_STATE
        try {
            port.postMessage({msg: Background2PagePortMsgType.REQ_PAGE_STATE});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("content script disconnected from service worker while processing initial message and before trying to request interactive elements; task will resume after new content script connection is established");
                this.state = AgentControllerState.PENDING_RECONNECT;
            } else {
                this.logger.error(`unexpected error while processing initial message and before trying to request interactive elements; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                this.terminateTask();
            }
        }
    }

    /**
     * given page information (e.g. interactive elements) from the page actor in the content script, determine via LLM
     * what the next step should be and then send a request for that action to the page actor
     * My apologies for the severely nonlinear control flow. Looking out for ways to rework it to be less convoluted
     * @param message the message from the content script containing the page state information
     * @param port the port object representing the connection between the service worker and the content script
     */
    processPageStateFromActor = async (message: any, port: Port): Promise<void> => {
        if (this.state !== AgentControllerState.WAITING_FOR_PAGE_STATE) {
            this.logger.error("received 'sending interactive elements' message from content script while not waiting for elements, but rather in state " + AgentControllerState[this.state]);
            this.terminateTask();
            return;
        }
        this.logger.trace("received interactive elements from content script")

        this.state = AgentControllerState.ACTIVE;
        const interactiveElements = message.interactiveElements as SerializableElementData[];
        const candidateIds = interactiveElements.map((element, index) => {
            return (element.centerCoords[0] != 0 && element.centerCoords[1] != 0) ? index : undefined;
        }).filter(Boolean) as number[];//ts somehow too dumb to realize that filter(Boolean) removes undefined elements

        const interactiveChoiceDetails = interactiveElements.map<StrTriple>((element) => {
            return [element.description, element.tagHead, element.tagName];
        });
        const interactiveChoices = formatChoices(interactiveChoiceDetails, candidateIds);

        //todo? try catch for error when trying to get screenshot, if that fails, then terminate task
        const screenshotDataUrl: string = await this.chromeWrapper.fetchVisibleTabScreenshot();
        this.logger.debug("screenshot data url (truncated): " + screenshotDataUrl.slice(0, 100) + "...");

        while (this.noopCount <= this.maxNoopLimit && this.failureOrNoopStreak <= this.maxFailureOrNoopStreakLimit) {
            const reactionToLmmOutput = await this.queryLmmAndProcessResponsesForAction(interactiveChoices,
                screenshotDataUrl, candidateIds, interactiveElements);
            if (reactionToLmmOutput === LmmOutputReaction.ABORT_TASK) {
                return;
            } else if (reactionToLmmOutput === LmmOutputReaction.TRY_REPROMPT) {
                continue;
            }

            this.state = AgentControllerState.WAITING_FOR_ACTION;
            try {
                port.postMessage({
                    msg: Background2PagePortMsgType.REQ_ACTION, elementIndex: this.tentativeActionInfo?.elementIndex,
                    action: this.tentativeActionInfo?.action, value: this.tentativeActionInfo?.value
                });
            } catch (error: any) {
                if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                    this.logger.info("content script disconnected from service worker while processing interactive elements and before trying to request an action; task will resume after new content script connection is established");
                    this.state = AgentControllerState.PENDING_RECONNECT;
                    this.tentativeActionInfo = undefined;
                } else {
                    this.logger.error(`unexpected error while processing interactive elements and before trying to request an action; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                    this.terminateTask();
                }
            }
            return;//not doing break here b/c no point doing the noop checks if it successfully chose an action which
            // was sent to the content script
        }
        if (this.noopCount > this.maxNoopLimit) {
            this.logger.warn(`task terminated due to exceeding the maximum noop limit of ${this.maxNoopLimit}`);
            this.terminateTask();
        } else if (this.failureOrNoopStreak > this.maxFailureOrNoopStreakLimit) {
            this.logger.warn(`task terminated due to exceeding the maximum failure-or-noop streak limit of ${this.maxFailureOrNoopStreakLimit}`);
            this.terminateTask();
        }
    }

    //todo ask Boyuan if he wants me to break this up even further- I'm on the fence as to whether it would actually
    // improve code readability
    /**
     * @description Queries the LLM for the next action to take based on the current state of the page and the actions
     * so far, then processes the response and (if there is a chosen action) stores the chosen action in
     * this.tentativeActionInfo
     * @param interactiveChoices brief descriptions of the interactive elements on the page (starting and ending with the appropriate html tag)
     * @param screenshotDataUrl the data URL of the screenshot of the current page
     * @param candidateIds the indices of the interactive elements that are candidates for the next action
     * @param interactiveElements the full data about the interactive elements on the page
     * @return indicator of what the main "processPageStateFromActor" function should do next based on the LLM response
     *         (e.g. whether to try reprompting, proceed with the action, or abort the task)
     */
    private queryLmmAndProcessResponsesForAction = async (
        interactiveChoices: string[], screenshotDataUrl: string, candidateIds: number[],
        interactiveElements: SerializableElementData[]): Promise<LmmOutputReaction> => {
        const prompts: LmmPrompts = generatePrompt(this.taskSpecification,
            this.actionsSoFar.map(entry => `${entry.success ? "SUCCEEDED" : "FAILED"}-${entry.actionDesc}`), interactiveChoices);
        this.logger.debug("prompts:", prompts);
        let planningOutput: string;
        let groundingOutput: string;
        const aiApiBaseDelay = 1_000;
        //todo maybe increase temperature and/or add more to prompt if previous action was a noop
        // e.g. warn that ai should try to think out of the box if prev action choice was NONE; or that it should be
        // more careful about element selection if element name was invalid; or, if prev action was element
        // dependent and they chose 'none of the above' for element, they must either choose element-independent
        // action or choose a valid element action or else provide a valid element
        // The "add to prompt" part might be redundant with the additions to actionsSoFar when noop detected,
        // depending on model cleverness
        try {
            planningOutput = await this.aiEngine.generateWithRetry(
                {prompts: prompts, turnInStep: 0, imgDataUrl: screenshotDataUrl}, aiApiBaseDelay);
            this.logger.info("planning output: " + planningOutput);

            groundingOutput = await this.aiEngine.generateWithRetry(
                {prompts: prompts, turnInStep: 1, imgDataUrl: screenshotDataUrl, priorTurnOutput: planningOutput},
                aiApiBaseDelay);
            //todo low priority per Boyuan, but experiment with json output mode specifically for the grounding api call
        } catch (error) {
            this.logger.error(`error getting next step from ai; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            this.terminateTask();
            return LmmOutputReaction.ABORT_TASK;
        }
        this.logger.info("grounding output: " + groundingOutput);
        const [elementName, actionName, value] = postProcessActionLlm(groundingOutput);
        this.logger.debug(`suggested action: ${actionName}; value: ${value}`);

        if (actionName === Action.TERMINATE) {
            this.logger.info("Task completed!");
            this.terminateTask();
            return LmmOutputReaction.ABORT_TASK;
        } else if (actionName === Action.NONE) {
            this.logger.warn("ai selected NONE action, counting as noop action and reprompting");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected NONE action type`,
                success: false, noopType: NoopType.AI_SELECTED_NONE_ACTION
            });
            return LmmOutputReaction.TRY_REPROMPT;
        }
        const actionNeedsNoElement = actionName === Action.SCROLL_UP || actionName === Action.SCROLL_DOWN
            || actionName === Action.PRESS_ENTER;

        let chosenCandidateIndex = getIndexFromOptionName(elementName);

        if ((!chosenCandidateIndex || chosenCandidateIndex > candidateIds.length) && !actionNeedsNoElement) {
            this.logger.warn(`ai selected invalid option ${elementName} ` + (chosenCandidateIndex
                ? `(was parsed as candidate index ${chosenCandidateIndex}, but the candidates list only had ${candidateIds.length} entries)`
                : `(cannot be parsed into an index)`) + ", counting as noop action and reprompting");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected invalid option ${elementName}`,
                success: false, noopType: NoopType.INVALID_ELEMENT
            });
            return LmmOutputReaction.TRY_REPROMPT;
        } else if (chosenCandidateIndex === candidateIds.length && !actionNeedsNoElement) {
            this.logger.info("ai selected 'none of the above' option for element selection when action targets specific element, marking action as noop");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected 'none of the above' option for element selection when action ${actionName} targets specific element`,
                success: false, noopType: NoopType.ACTION_INCOMPATIBLE_WITH_NONE_OF_ABOVE_ELEMENT
            });
            return LmmOutputReaction.TRY_REPROMPT;
        }

        if (chosenCandidateIndex && chosenCandidateIndex >= candidateIds.length && actionNeedsNoElement) {
            chosenCandidateIndex = undefined;
        }

        const chosenElementIndex: number | undefined = chosenCandidateIndex ? candidateIds[chosenCandidateIndex] : undefined;
        this.logger.debug(`acting on the ${chosenCandidateIndex} entry from the candidates list; which is the ${chosenElementIndex} element of the original interactiveElements list`);

        this.tentativeActionInfo = {
            elementIndex: chosenElementIndex, action: actionName, value: value,
            elementData: chosenElementIndex ? interactiveElements[chosenElementIndex] : undefined
        };
        //can add TYPE and SELECT here if I ever see or get reports of such actions causing page navigation
        this.mightNextActionCausePageNav = (actionName === Action.PRESS_ENTER || actionName === Action.CLICK);


        return LmmOutputReaction.PROCEED_WITH_ACTION;
    }


    /**
     * @description Processes the confirmation from the content script that an action was performed, and then requests
     * information about the new page state from the content script
     * @param message the message from the content script containing the result of the action
     * @param port the port object representing the connection between the service worker and the content script
     */
    processActionPerformedConfirmation = async (message: any, port: Port): Promise<void> => {
        if (this.state !== AgentControllerState.WAITING_FOR_ACTION) {
            this.logger.error("received 'action performed' message from content script while not waiting for action, but rather in state " + AgentControllerState[this.state]);
            this.terminateTask();
            return;
        }
        this.logger.trace("controller notified that action was performed by content script");
        this.state = AgentControllerState.ACTIVE;

        const wasSuccessful: boolean = message.success;
        let actionDesc: string = message.result ? message.result :
            (this.tentativeActionInfo ?
                    buildGenericActionDesc(this.tentativeActionInfo.action, this.tentativeActionInfo.elementData,
                        this.tentativeActionInfo?.value)
                    : "no information stored about the action"
            );

        let wasPageNav = false;
        let tab: chrome.tabs.Tab | undefined;
        if (this.mightNextActionCausePageNav) {
            await sleep(500);//make sure that, if the browser is opening a new tab, there's time for browser to
            // make the new tab the active tab before we check for active tab change
            tab = await this.getActiveTab();
            const tabId = tab.id;
            if (tabId !== this.currTaskTabId) {
                wasPageNav = true;
                actionDesc += `; opened ${tab.title} in new tab`;
            }
        }

        const shouldAbort = this.updateActionHistory(actionDesc, wasSuccessful);
        if (shouldAbort) {
            this.logger.info("task terminated due to exceeding a limit on operations, noops, or failures");
        } else if (wasPageNav) {
            this.logger.info("tab id changed after action was performed, so killing connection to " +
                "old tab and injecting content script in new tab " + tab?.title);
            this.killPageConnection(port);
            await this.injectPageActorScript(false, undefined, tab);
            //only resetting this after script injection because script injection needs to know whether it's ok
            // that the tab id might've changed
            this.mightNextActionCausePageNav = false;
        } else {
            this.mightNextActionCausePageNav = false;
            this.state = AgentControllerState.WAITING_FOR_PAGE_STATE
            try {
                port.postMessage({msg: Background2PagePortMsgType.REQ_PAGE_STATE});
            } catch (error: any) {
                if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                    this.logger.info("content script disconnected from service worker while processing completed action and before trying to request more interactive elements; task will resume after new content script connection is established");
                    this.state = AgentControllerState.PENDING_RECONNECT;
                } else {
                    this.logger.error(`unexpected error while processing completed action and before trying to request more interactive elements; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                    this.terminateTask();
                }
            }
        }
    }

    /**
     * @description Processes the result of an action that was attempted, updating the controller's record of actions
     * and its counters for operations, failures, and failure/noop streaks;
     * it then enforces the limits on those counters (aborting the task if any of them are exceeded)
     *
     * @param actionDesc description of the action that was attempted
     * @param wasSuccessful whether the action was successful
     * @return whether the task should be aborted; indicates whether the action-completion-handler function which called
     *          this should proceed with setting things in motion for the next step of the task
     */ //todo write at least skeleton of unit test suite for this
    updateActionHistory(actionDesc: string, wasSuccessful: boolean) {
        let shouldAbort: boolean = false;
        this.actionsSoFar.push({actionDesc: actionDesc, success: wasSuccessful});
        this.tentativeActionInfo = undefined;

        this.opsCount++;
        if (wasSuccessful) {
            this.failureOrNoopStreak = 0;//failure-or-noop streak can only be broken by successfully _completed_ action
        } else {
            this.failureCount++;
            this.failureOrNoopStreak++;
        }
        this.logger.debug(`current ops count is ${this.opsCount}, noop count is ${this.noopCount}, failure count is ${this.failureCount}, failure-or-noop streak is ${this.failureOrNoopStreak}`)

        if (this.failureOrNoopStreak > this.maxFailureOrNoopStreakLimit) {
            this.logger.warn(`task terminated due to exceeding the maximum failure-or-noop streak limit of ${this.maxFailureOrNoopStreakLimit}`);
            this.terminateTask();
            shouldAbort = true;
        } else if (this.failureCount > this.maxFailureLimit) {
            this.logger.warn(`task terminated due to exceeding the maximum failure limit of ${this.maxFailureLimit}`);
            this.terminateTask();
            shouldAbort = true;
        } else if (this.opsCount > this.maxOpsLimit) {
            this.logger.warn(`task terminated due to exceeding the maximum operations limit of ${this.maxOpsLimit}`);
            this.terminateTask();
            shouldAbort = true;
        }
        return shouldAbort;
    }

    /**
     * @description Handles messages from the content script to the service worker over their persistent connection
     * @param message the message from the content script
     * @param port the port object representing the connection between the service worker and the content script
     */
    handlePageMsgToAgentController = async (message: any, port: Port): Promise<void> => {
        if (message.msg === Page2BackgroundPortMsgType.READY) {
            await this.mutex.runExclusive(() => {this.processPageActorInitialized(port);});
        } else if (message.msg === Page2BackgroundPortMsgType.PAGE_STATE) {
            await this.mutex.runExclusive(async () => {await this.processPageStateFromActor(message, port);});
        } else if (message.msg === Page2BackgroundPortMsgType.ACTION_DONE) {
            await this.mutex.runExclusive(async () => {await this.processActionPerformedConfirmation(message, port);});
        } else if (message.msg === Page2BackgroundPortMsgType.TERMINAL) {
            await this.mutex.runExclusive(() => {
                this.logger.error("something went horribly wrong in the content script, so terminating the task; details: ", message.error);
                this.terminateTask();
            });
        } else {
            this.logger.warn("unknown message from content script:", message);
        }
    }

    /**
     * @description deals with the case where the content script disconnects from the service worker while the
     * controller is waiting for the content script to perform an action; reinjecting the content script into the
     * (presumably new) page
     */
    processActorDisconnectDuringAction = async (): Promise<void> => {
        if (!this.tentativeActionInfo) {
            this.logger.error("service worker's connection to content script was lost while performing an " +
                "action, but no tentative action was stored; terminating current task");
            this.terminateTask();
            return;
        }
        this.state = AgentControllerState.ACTIVE;
        this.logger.info("service worker's connection to content script was lost while performing an action, " +
            "which most likely means that the action has caused page navigation");
        if (this.mightNextActionCausePageNav) {
            //give the browser time to ensure that the new page is ready for scripts to be injected into it
            await sleep(500);
        } else {
            this.logger.error("service worker's connection to content script was lost while performing an action, " +
                "but the action was not expected to cause page navigation; this is unexpected");
        }

        const tab = await this.getActiveTab();
        if (tab.id !== this.currTaskTabId) {
            this.logger.error("tab changed after action and yet the connection to the old tab's " +
                "content script was lost (before the controller could terminate it); this is unexpected")
        }
        const actionDesc = buildGenericActionDesc(this.tentativeActionInfo.action, this.tentativeActionInfo.elementData,
            this.tentativeActionInfo.value) + `; this caused page navigation to ${tab.title}`;

        //marking action as failure if it _accidentally_ caused page navigation or otherwise caused the page connection
        // to fail
        const shouldAbort = this.updateActionHistory(actionDesc, this.mightNextActionCausePageNav);
        if (!shouldAbort) {
            await this.injectPageActorScript(false);
            //only resetting this after script injection because script injection needs to know whether it's ok that the
            // tab id might've changed
            this.mightNextActionCausePageNav = false;
        }
    }

    /**
     * @description Handles a loss of the connection between the content script and the service worker
     * @param port the port object representing the connection between the service worker and the content script
     */
    handlePageDisconnectFromAgentController = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(async () => {
            this.logger.debug("content script disconnected from service worker; port name:", port.name);
            this.currPortToContentScript = undefined;

            if (this.state === AgentControllerState.WAITING_FOR_ACTION) {
                await this.processActorDisconnectDuringAction();
            } else if (this.state === AgentControllerState.PENDING_RECONNECT) {
                this.logger.info("service worker's connection to content script was lost partway through the controller's processing of some step; reestablishing connection")
                await this.injectPageActorScript(false);
            } else {
                this.logger.error("service worker's connection to content script was lost while not waiting for action, " +
                    "but rather in state " + AgentControllerState[this.state] + "; terminating current task " + this.taskSpecification);
                this.terminateTask();
                //todo Boyuan may eventually want recovery logic here for the user accidentally closing the tab or for the tab/page crashing
                // reloading or reopening the tab might require adding even more permissions to the manifest.json
            }
        });
    }

    /**
     * @description ends any connection the service worker may still have to the content script, which should
     * eliminate any further computation in the targeted content script
     * @param pageConn the port object representing the connection between the service worker and the content script
     */
    killPageConnection = (pageConn: Port): void => {
        try {
            pageConn.onDisconnect.removeListener(this.handlePageDisconnectFromAgentController);
            if (pageConn.onDisconnect.hasListeners()) {
                this.logger.error("something went wrong when removing the onDisconnect listener for the port "
                    + pageConn.name + "between service worker and content script. the onDisconnect event of that port " +
                    "still has one or more listeners");
            }
            pageConn.disconnect();
            this.logger.info(`successfully cleaned up content script connection ${pageConn.name}`);
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info(`unable to clean up content script connection ${pageConn.name} because the connection to the content script was already closed`);
            } else {
                this.logger.error(`unexpected error while cleaning up content script connection ${pageConn.name}; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }
    }


    //todo b4 release, make this take an error message param and make it show an alert so the user doesn't need to look
    // at the extension's dev console to see why the actions stopped (if param null, alert would just say task completed)
    /**
     * @description Terminates the current task, resetting any state and cleaning up the page connection if it's still
     * open
     */
    terminateTask = (): void => {
        this.logger.info(`TERMINATING TASK ${this.taskId} which had specification: ${this.taskSpecification}; final this.state was ${AgentControllerState[this.state]}`);
        this.taskId = undefined;
        this.taskSpecification = "";
        this.currTaskTabId = undefined;
        this.state = AgentControllerState.IDLE;
        this.tentativeActionInfo = undefined;
        this.mightNextActionCausePageNav = false;
        this.logger.info("action history for task: " + JSON.stringify(this.actionsSoFar));
        this.actionsSoFar = [];
        this.logger.info(`summary of actions in task: ${this.opsCount} operations, ${this.noopCount} no-ops, ${this.failureCount} failures; at end of task, the length of the failure-or-noop streak was ${this.failureOrNoopStreak} (this is not the length of the longest such streak during the task)`)
        this.opsCount = 0;
        this.noopCount = 0;
        this.failureCount = 0;
        this.failureOrNoopStreak = 0;
        if (this.currPortToContentScript) {
            this.logger.info("terminating task while content script connection may still be open, attempting to close it")
            this.killPageConnection(this.currPortToContentScript);
            this.currPortToContentScript = undefined;
        }
        //todo if aiEngine ever has its own nontrivial bits of state, should probably somehow reset them here

        //todo if I use console.group elsewhere, should use console.groupEnd() here repeatedly (maybe 10 times) to be
        // completely certain that any nested groups get escaped when the task ends, even if things went really wrong with
        // exception handling and control flow expectations wrt group management
        // If groupEnd throws when there's no group to escape, use a try catch and the catch block would break the loop
    }

    /**
     * @description Get the active tab in the current window (but with id set to undefined if the active tab is a chrome:// URL)
     * @returns {Promise<chrome.tabs.Tab>} The active tab, with the id member undefined if the active tab is a chrome:// URL
     *                                          (which scripts can't be injected into for safety reasons)
     * @throws {Error} If the active tab is not found or doesn't have an id
     */
    getActiveTab = async (): Promise<chrome.tabs.Tab> => {
        let tabs;
        try {
            tabs = await this.chromeWrapper.fetchTabs({active: true, currentWindow: true});
        } catch (error) {
            const errMsg = `error querying active tab; error: ${error}, jsonified: ${JSON.stringify(error)}`;
            this.logger.error(errMsg);
            throw new Error(errMsg);
        }
        const tab: chrome.tabs.Tab | undefined = tabs[0];
        if (!tab) throw new Error('Active tab not found');
        const id = tab.id;
        if (!id) throw new Error('Active tab id not found');
        if (tab.url?.startsWith('chrome://')) {
            this.logger.warn('Active tab is a chrome:// URL: ' + tab.url);
            tab.id = undefined;
        }
        return tab;
    }

    /**
     * @description Sends an Enter key press to the tab with the given id
     * @param tabId the id of the tab to send the Enter key press to
     */
    sendEnterKeyPress = async (tabId: number): Promise<void> => {
        //todo if/when adding support for press_sequentially for TYPE action, will want this helper method to flexibly
        // handle strings of other characters; in that case, want to do testing to see if windowsVirtualKeyCode is needed or
        // if text (and?/or? unmodifiedText) is enough (or something else)
        await this.chromeWrapper.attachDebugger({tabId: tabId}, "1.3");
        this.logger.debug(`chrome.debugger attached to the tab ${tabId} to send an Enter key press`)
        //thanks to @activeliang https://github.com/ChromeDevTools/devtools-protocol/issues/45#issuecomment-850953391
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent key-down keyevent for Enter/CR key to tab ${tabId}`)
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "char", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent char keyevent for Enter/CR key to tab ${tabId}`)
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent keyup keyevent for Enter/CR key to tab ${tabId}`)
        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after sending an Enter key press`)
    }


}








