import {Mutex} from "async-mutex";
import {SerializableElementData} from "./BrowserHelper";
import {v4 as uuidV4} from 'uuid';
import {Logger} from "loglevel";
import {
    AgentDb,
    createNamedLogger,
    dbConnHolder,
    LogMessage,
    LOGS_OBJECT_STORE,
    ScreenshotRecord,
    SCREENSHOTS_OBJECT_STORE,
    taskIdHolder,
    taskIdPlaceholderVal
} from "./shared_logging_setup";
import {
    Action,
    Background2PagePortMsgType,
    Background2PanelPortMsgType,
    base64ToByteArray,
    buildGenericActionDesc,
    defaultIsMonitorMode,
    defaultMaxFailureOrNoopStreak,
    defaultMaxFailures,
    defaultMaxNoops,
    defaultMaxOps,
    elementHighlightRenderDelay,
    expectedMsgForPortDisconnection,
    Page2BackgroundPortMsgType,
    Panel2BackgroundPortMsgType,
    renderUnknownValue,
    setupMonitorModeCache,
    sleep,
    validateIntegerLimitUpdate,
    ViewportDetails
} from "./misc";
import {formatChoices, generatePrompt, LmmPrompts, postProcessActionLlm} from "./format_prompts";
import {getIndexFromOptionName} from "./format_prompt_utils";
import {ChromeWrapper} from "./ChromeWrapper";
import JSZip from "jszip";
import {IDBPDatabase} from "idb";
import Port = chrome.runtime.Port;
import {AiEngine} from "./AiEngine";

/**
 * states for the agent controller Finite State Machine
 */
export enum AgentControllerState {
    IDLE,//i.e. no active task
    WAITING_FOR_CONTENT_SCRIPT_INIT,//there's an active task, but injection of content script hasn't completed yet
    ACTIVE,//partway through an event handler function
    WAITING_FOR_PAGE_STATE,// waiting for content script to retrieve page state (e.g. interactive elements) from page
    WAITING_FOR_MONITOR_RESPONSE,//only reached in monitor mode, waiting for user to indicate (either from side panel or via keyboard shortcut) whether proposed action should be performed or whether the LMM should be reprompted
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
export type ActionInfo = {
    elementIndex?: number, elementData?: SerializableElementData, action: Action, value?: string, explanation: string
};

/**
 * used to store information about an action that was performed, so that the controller can give the AI a clear history
 * of what actions have been tried and what the results were
 */
type ActionRecord = { actionDesc: string, success: boolean, noopType?: NoopType, explanation: string };

/**
 * stores all relevant info about a round of LMM output for later export at end of task
 */
type PredictionRecord = {
    modelPlanningOutput: string,
    modelGroundingOutput: string,
    targetElementData?: SerializableElementData,
    actionName: string
    value?: string
    explanation: string
};

/**
 * these alarms are turned on when the side panel makes contact with the service worker and turned off when that
 * connection is lost. They serve to keep the service worker responsive to user input in the side panel
 *
 * with just 1 keepalive alarm, sometimes it would serve its purpose (if Chrome fired that event a fraction of a second early)
 *  but it would fail to do its job if there was a 30 second period with no keepalive pings from the side panel (side
 *  panel pings to service worker are bafflingly unreliable) and that time the alarm fired even a tiny fraction of a
 * second more than 30 seconds after the previous firing
 */
export const serviceWorkerKeepaliveAlarmName = "serviceWorkerKeepaliveAlarm";
export const serviceWorker2ndaryKeepaliveAlarmName = "serviceWorker2ndaryKeepaliveAlarm";


//todo explore whether it might be possible to break this into multiple classes, or at least if there are
// pure/non-state-affecting helper functions that could be extracted from existing code and then moved to
// controller_utils file
/**
 * @description Controller for the agent that completes tasks for the user in their browser
 */
export class AgentController {
    terminationSignal: boolean = false;//this is the ~only piece of state that should be accessed without the mutex

    readonly mutex = new Mutex();

    taskId: string | undefined = undefined;
    private taskSpecification: string = "";
    currTaskTabId: number | undefined;

    initWebsiteForTask: string | undefined;


    private pendingActionInfo: ActionInfo | undefined;
    private mightNextActionCausePageNav: boolean = false;

    private actionsSoFar: ActionRecord[] = [];
    private predictionsInTask: PredictionRecord[] = [];

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

    /**
     * max number of total operations (successful or not) allowed in a task
     */
    maxOpsLimit: number = defaultMaxOps;
    /**
     * max number of total noops allowed in a task before it is terminated
     */
    maxNoopLimit: number = defaultMaxNoops;
    /**
     * max number of total failed operations allowed in a task before it is terminated
     */
    maxFailureLimit: number = defaultMaxFailures;
    /**
     * max length of streak of noops and/or failures allowed in a task before it is terminated
     */
    maxFailureOrNoopStreakLimit: number = defaultMaxFailureOrNoopStreak;

    cachedMonitorMode: boolean = defaultIsMonitorMode;
    wasPrevActionRejectedByMonitor: boolean = false;
    monitorFeedback: string = "";

    numPriorScreenshotsTakenForPromptingCurrentAction: number = 0;


    state: AgentControllerState = AgentControllerState.IDLE;

    portToContentScript: Port | undefined;
    portToSidePanel: Port | undefined;

    private aiEngine: AiEngine;
    private chromeWrapper: ChromeWrapper;
    readonly logger: Logger;

    /**
     * @description Constructor for the AgentController
     * @param aiEngine The OpenAiEngine instance to use for analyzing the situation and generating actions
     * @param chromeWrapper a wrapper to allow mocking of Chrome extension API calls
     */
    constructor(aiEngine: AiEngine, chromeWrapper?: ChromeWrapper) {
        this.aiEngine = aiEngine;
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();

        this.logger = createNamedLogger('agent-controller', true);
        this.logger.debug(`max ops limit: ${this.maxOpsLimit}, max noop limit: ${this.maxNoopLimit}, max failure limit: ${this.maxFailureLimit}, max failure-or-noop streak limit: ${this.maxFailureOrNoopStreakLimit}`);

        setupMonitorModeCache((newMonitorModeVal: boolean) => this.cachedMonitorMode = newMonitorModeVal, this.logger);
        if (chrome?.storage?.local) {
            //todo fix following 6 lines to use storage key string constants
            chrome.storage.local.get(["maxOps", "maxNoops", "maxFailures", "maxFailureOrNoopStreak"], (items) => {
                this.validateAndApplyAgentOptions(true, items.maxOps, items.maxNoops, items.maxFailures, items.maxFailureOrNoopStreak);
            });
            chrome.storage.local.onChanged.addListener((changes: { [p: string]: chrome.storage.StorageChange }) => {
                this.validateAndApplyAgentOptions(false, changes.maxOps?.newValue, changes.maxNoops?.newValue,
                    changes.maxFailures?.newValue, changes.maxFailureOrNoopStreak?.newValue);
            });
        }
    }

    /**
     * validates information from local storage about agent-controller-specific options and applies any valid updates
     * to the controller's instance variables
     * @param initOrUpdate whether this is being called for the lazy initialization of the controller's options on
     *                      start-up (true) or for an update of those options based on a change in local storage (false)
     * @param newMaxOps possible new value for this.maxOpsLimit
     * @param newMaxNoops possible new value for this.maxNoopLimit
     * @param newMaxFailures possible new value for this.maxFailureLimit
     * @param newMaxFailureOrNoopStreak possible new value for this.maxFailureOrNoopStreakLimit
     */
    validateAndApplyAgentOptions = (
        initOrUpdate: boolean, newMaxOps: unknown, newMaxNoops: unknown, newMaxFailures: unknown,
        newMaxFailureOrNoopStreak: unknown): void => {
        const contextStr = initOrUpdate ? "when loading options from storage" : "when processing an update from storage";
        if (validateIntegerLimitUpdate(newMaxOps, 1)) {
            this.maxOpsLimit = newMaxOps;
        } else if (newMaxOps !== undefined) {this.logger.error(`invalid maxOps value ${newMaxOps} in chrome.storage detected ${contextStr}; ignoring it`);}

        if (validateIntegerLimitUpdate(newMaxNoops)) {
            this.maxNoopLimit = newMaxNoops;
        } else if (newMaxNoops !== undefined) {this.logger.error(`invalid maxNoops value ${newMaxNoops} in chrome.storage detected ${contextStr}; ignoring it`);}

        if (validateIntegerLimitUpdate(newMaxFailures)) {
            this.maxFailureLimit = newMaxFailures;
        } else if (newMaxFailures !== undefined) {this.logger.error(`invalid maxFailures value ${newMaxFailures} in chrome.storage detected ${contextStr}; ignoring it`);}

        if (validateIntegerLimitUpdate(newMaxFailureOrNoopStreak)) {
            this.maxFailureOrNoopStreakLimit = newMaxFailureOrNoopStreak;
        } else if (newMaxFailureOrNoopStreak !== undefined) {this.logger.error(`invalid maxFailureOrNoopStreak value ${newMaxFailureOrNoopStreak} in chrome.storage detected ${contextStr}; ignoring it`);}
    }

    /**
     * @description Injects the agent's page-interaction/data-gathering script into the current tab
     * @param isStartOfTask Whether this injection is to start a new task or to continue an existing one (e.g. after
     *                      a page navigation)
     * @param newTab optional tab object to inject the script into, to avoid wasted effort if the caller has already
     *                identified the active tab
     */
    injectPageActorScript = async (isStartOfTask: boolean, newTab?: chrome.tabs.Tab): Promise<void> => {
        let tabId: number | undefined = undefined;
        let tab: chrome.tabs.Tab | undefined = newTab;
        if (!tab) {
            try {
                tab = await this.getActiveTab();
            } catch (error) {
                const termReason = `error getting active tab id, cannot inject content script; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return;
            }
        }
        tabId = tab.id;
        if (!tabId) {
            const termReason = `Can't inject agent script into chrome:// URLs for security reasons; ${isStartOfTask ? "please only try to start the agent on a regular web page." : "please don't switch to a chrome:// URL while the agent is running"}`;
            this.logger.warn(termReason);
            this.terminateTask(termReason);
        } else {
            const toStartTaskStr = isStartOfTask ? " to start a task" : "";

            if (isStartOfTask) {
                this.currTaskTabId = tabId;
                this.initWebsiteForTask = tab.url;
            } else if (this.currTaskTabId !== tabId) {
                if (this.mightNextActionCausePageNav) {
                    this.currTaskTabId = tabId;
                } else {
                    const errMsg = `The active tab changed unexpectedly to ${tab.title}`;
                    this.logger.error(errMsg + "; terminating task");
                    this.terminateTask(errMsg);
                    return;
                }
            }
            this.logger.trace("injecting agent script into page" + toStartTaskStr + "; in tab " + tabId);

            this.state = AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT;
            try {
                await this.chromeWrapper.runScript({files: ['./src/page_interaction.js'], target: {tabId: tabId}});
                this.logger.trace('agent script injected into page' + toStartTaskStr);
            } catch (error) {
                const termReason = `error injecting agent script into page${toStartTaskStr}; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
            }
        }
    }


    /**
     * @description Starts a new task for the agent to complete
     * @param message The message describing the new task
     * @param port the connection to the side panel which requested the start of the task
     */
    startTask = async (message: any, port: Port): Promise<void> => {
        if (this.taskId !== undefined) {
            const taskRejectMsg = `Task ${this.taskId} already in progress; not starting new task`;
            this.logger.warn(taskRejectMsg);
            try {
                port.postMessage({type: Background2PanelPortMsgType.ERROR, msg: taskRejectMsg});
            } catch (error: any) {
                this.logger.error(`error while trying to send error message to side panel about task-start request being received when task is already running; error: ${renderUnknownValue(error)}`);
            }
        } else if (typeof (message.taskSpecification) !== "string" || message.taskSpecification.trim().length === 0) {
            this.logger.error(`received bad task specification from side panel: ${renderUnknownValue(message.taskSpecification)}`);
            this.state = AgentControllerState.IDLE;
            try {
                port.postMessage({type: Background2PanelPortMsgType.ERROR, msg: "bad task specification"});
            } catch (error: any) {
                this.logger.error(`error while trying to send error message to side panel about task start request with bad task specification; error: ${renderUnknownValue(error)}`);
            }
        } else {
            this.taskId = uuidV4();
            taskIdHolder.currTaskId = this.taskId;
            this.taskSpecification = message.taskSpecification;
            this.logger.info(`STARTING TASK ${this.taskId} with specification: ${this.taskSpecification}`);
            this.logger.debug(`maxOps: ${this.maxOpsLimit}, maxNoops: ${this.maxNoopLimit}, maxFailures: ${this.maxFailureLimit}, maxFailureOrNoopStreak: ${this.maxFailureOrNoopStreakLimit}`);
            try {
                await this.injectPageActorScript(true);
            } catch (error: any) {
                const termReason = `error injecting content script to start task; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
            }
        }
    }

    /**
     * processes new connection from a content script
     * @param port the persistent communication connection with that content script
     */
    addPageConnection = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            if (this.state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
                const termReason = "received connection from content script while not waiting for content script initialization, but rather in state " + AgentControllerState[this.state];
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return;
            }
            this.logger.trace("content script connected to agent controller in service worker");
            port.onMessage.addListener(this.handlePageMsgToAgentController);
            port.onDisconnect.addListener(this.handlePageDisconnectFromAgentController);
            this.portToContentScript = port;
        });
    }

    /**
     * handles the creation of a new connection from the side panel
     * @param port the persistent communication connection with the side panel
     */
    addSidePanelConnection = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            if (this.state !== AgentControllerState.IDLE) {
                const termReason = "received connection from side panel while not idle, but rather in state " + AgentControllerState[this.state];
                this.logger.error(termReason);
                this.terminateTask(termReason);
            }
            this.logger.trace("side panel connected to agent controller in service worker");
            this.portToSidePanel = port;
            this.portToSidePanel.onMessage.addListener(this.handlePanelMsgToController);
            this.portToSidePanel.onDisconnect.addListener(this.handlePanelDisconnectFromController);
            this.logger.trace("about to notify side panel that agent controller is ready");
            try {
                this.portToSidePanel.postMessage({type: Background2PanelPortMsgType.AGENT_CONTROLLER_READY});
            } catch (error: any) {
                this.logger.error(`error while trying to inform side panel about agent controller's readiness for start of new task; error: ${renderUnknownValue(error)}`);
            }
            this.logger.trace("sent notification to side panel that agent controller is ready");
            chrome.alarms.create(serviceWorkerKeepaliveAlarmName, {periodInMinutes: 0.5}).catch((error) =>
                this.logger.error(`error while trying to set up service worker keepalive alarm; error: ${renderUnknownValue(error)}`));
            setTimeout(() => {
                this.logger.debug("setting up secondary keepalive alarm in service worker");
                chrome.alarms.create(serviceWorker2ndaryKeepaliveAlarmName, {periodInMinutes: 0.5}).catch((error) =>
                    this.logger.error(`error while trying to set up secondary service worker keepalive alarm; error: ${renderUnknownValue(error)}`));
            }, 15_000);
        });
    }

    /**
     * @description deals with notification from content script that the page actor is ready to accept requests from
     * the controller
     * @param port the port object representing the connection between the service worker and the content script
     */
    processPageActorInitialized = (port: Port): void => {
        if (this.state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
            const termReason = "received 'content script initialized and ready' message from new content script while not waiting for content script initialization, but rather in state " + AgentControllerState[this.state];
            this.logger.error(termReason);
            this.terminateTask(termReason);
            return;
        }
        this.logger.trace("content script initialized and ready; requesting interactive elements")

        this.state = AgentControllerState.WAITING_FOR_PAGE_STATE
        let successfulStart = false;
        try {
            port.postMessage({type: Background2PagePortMsgType.REQ_PAGE_STATE});
            successfulStart = true;
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("content script disconnected from service worker while processing initial message and before trying to request interactive elements; task will resume after new content script connection is established");
                this.state = AgentControllerState.PENDING_RECONNECT;
            } else {
                const termReason = `unexpected error while trying to request interactive elements; error: ${renderUnknownValue(error)}`;
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
            }
        }
        if (this.actionsSoFar.length === 0) {
            if (!this.portToSidePanel) {
                const termReason = "no side panel connection to send task started message to";
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
            } else {
                try {
                    this.portToSidePanel.postMessage({
                        type: Background2PanelPortMsgType.TASK_STARTED, taskId: this.taskId,
                        success: successfulStart, taskSpec: this.taskSpecification
                    });
                } catch (error: any) {
                    const termReason = `error while trying to inform side panel about start of task and the requesting of interactive elements; error: ${renderUnknownValue(error)}`;
                    this.logger.error(`${termReason}; terminating task`);
                    this.terminateTask(termReason);
                }
            }
        }
    }

    //note for later- fetching interactive elements seems to involve maybe 50ms, so probably not worth big changes
    // to control flow in order to be able to skip it when the ai's planning output indicates that it wants to do an
    // element-independent action like scrolling

    /**
     * given page information (e.g. interactive elements) from the page actor in the content script, determine via LLM
     * what the next step should be and then send a request for that action to the page actor
     * My apologies for the severely nonlinear control flow. Looking out for ways to rework it to be less convoluted
     * @param message the message from the content script containing the page state information
     * @param pageActorPort the port object representing the connection between the service worker and the content script
     */
    processPageStateFromActor = async (message: any, pageActorPort: Port): Promise<void> => {
        if (this.state !== AgentControllerState.WAITING_FOR_PAGE_STATE) {
            const termReason = "received 'sending interactive elements' message from content script while not waiting for elements, but rather in state " + AgentControllerState[this.state];
            this.logger.error(termReason);
            this.terminateTask(termReason);
            return;
        }
        this.logger.trace("received interactive elements from content script")

        this.state = AgentControllerState.ACTIVE;
        const interactiveElements = message.interactiveElements as SerializableElementData[];
        const viewportInfo = message.viewportInfo as ViewportDetails;
        //todo consider removing the candidateIds complication since BrowserHelper.getInteractiveElements is already
        // filtering out all of the elements that are not really visible&interactive, and candidateIds adds annoying complexity throughout the planning code in this class
        const candidateIds = interactiveElements.map((element, index) => {
            return (element.centerCoords[0] != 0 && element.centerCoords[1] != 0) ? index : undefined;
        }).filter(Boolean) as number[];//ts somehow too dumb to realize that filter(Boolean) removes undefined elements

        const interactiveChoices = formatChoices(interactiveElements, candidateIds, viewportInfo);

        //todo? idea for later refinement- store previous round's screenshot, then do stuff with it
        // (e.g. querying ai at least some of the time with both current and prior screenshots)
        // to check for actions being silently ineffectual, with no error message and the content script having
        // judged the action as successful
        // Maybe could limit this to only some action types that are particularly prone to being ineffectual, or
        // use a non-ML software tool to check for the two images being too close to identical
        //      the latter could be easily thrown off by ads or other dynamic content. maybe getting a good solution for this would be more effort than it's worth
        const numPromptingScreenshotsTakenForCurrentActionBeforeThisRound = this.numPriorScreenshotsTakenForPromptingCurrentAction;

        const screenshotDataUrl = await this.captureAndStoreScreenshot("initial",
            numPromptingScreenshotsTakenForCurrentActionBeforeThisRound);
        if (screenshotDataUrl === undefined) { return; }//task will have been terminated by helper method
        //note for future reference - resizing the prompting screenshot to 512x512 (to reduce cost/latency:
        // https://platform.openai.com/docs/guides/vision/low-or-high-fidelity-image-understanding)
        // degrades readability of text too much to be worth serious consideration

        let monitorRejectionInfo: string | undefined;
        if (this.wasPrevActionRejectedByMonitor) {
            if (!this.pendingActionInfo) {
                const termReason = "previous action was rejected by monitor, but no tentative action info stored";
                this.logger.error(termReason + "; terminating task");
                this.terminateTask(termReason);
                return;
            }
            monitorRejectionInfo = "WARNING- The monitor/user rejected your previous planned action: "
                + buildGenericActionDesc(this.pendingActionInfo.action, this.pendingActionInfo.elementData, this.pendingActionInfo.value);
            if (this.monitorFeedback) {monitorRejectionInfo += `;\n They gave the feedback: ${this.monitorFeedback}`;}
            this.monitorFeedback = "";
            this.pendingActionInfo = undefined;
            this.wasPrevActionRejectedByMonitor = false;
        }

        while (this.noopCount <= this.maxNoopLimit && this.failureOrNoopStreak <= this.maxFailureOrNoopStreakLimit) {
            this.logger.debug(`noop count: ${this.noopCount}, failure-or-noop streak: ${this.failureOrNoopStreak}; noopLimit: ${this.maxNoopLimit}, failure-or-noop streak limit: ${this.maxFailureOrNoopStreakLimit}`);
            const reactionToLmmOutput = await this.queryLmmAndProcessResponsesForAction(interactiveChoices,
                screenshotDataUrl, candidateIds, interactiveElements, monitorRejectionInfo, viewportInfo);
            if (this.terminationSignal) {
                this.logger.info("received termination signal while processing interactive elements; terminating task")
                //the task termination will be handled by the terminateTask method being called by the handler (for
                // messages from side panel) once this method ends and the controller's mutex is released
                // This prevents the agent from performing a final action after the user presses the terminate button
                // and also lets the user cut off a noop-loop.
                return;
            }
            if (reactionToLmmOutput === LmmOutputReaction.ABORT_TASK) {
                return;
            } else if (reactionToLmmOutput === LmmOutputReaction.TRY_REPROMPT) {
                continue;
            }

            if (this.pendingActionInfo === undefined) {
                const termReason = "Bug in action selection code allowed the scaffolding to reach a point where it would commit to the chosen action while no action had actually been chosen";
                this.logger.error(termReason + "; terminating task");
                this.terminateTask(termReason);
                return;
            }

            if (this.portToSidePanel) {
                try {
                    this.portToSidePanel.postMessage(
                        {type: Background2PanelPortMsgType.ACTION_CANDIDATE, actionInfo: this.pendingActionInfo});
                } catch (error: any) {
                    const termReason = `error while trying to inform side panel about pending action; error: ${renderUnknownValue(error)}`;
                    this.logger.error(`${termReason}; terminating task`);
                    this.terminateTask(termReason);
                    return;
                }
            } else {
                const termReason = "side panel connection lost at some point during action planning";
                this.logger.error(termReason + ", terminating task");
                this.terminateTask(termReason);
                return;
            }
            if (this.pendingActionInfo.elementIndex !== undefined) {
                this.logger.info("about to instruct page actor to highlight the target element");
                try {
                    pageActorPort.postMessage({
                        type: Background2PagePortMsgType.HIGHLIGHT_CANDIDATE_ELEM,
                        elementIndex: this.pendingActionInfo.elementIndex,
                        promptingIndexForAction: numPromptingScreenshotsTakenForCurrentActionBeforeThisRound
                    });
                } catch (error: any) {
                    if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                        this.logger.info("content script disconnected from service worker while processing interactive elements and before trying to highlight an element; task will resume after new content script connection is established");
                        this.state = AgentControllerState.PENDING_RECONNECT;
                        this.pendingActionInfo = undefined;
                    } else {
                        const termReason = `unexpected error while trying to highlight an element for monitor mode; error: ${renderUnknownValue(error)}`;
                        this.logger.error(`${termReason}; terminating task`);
                        this.terminateTask(termReason);
                    }
                    return;
                }
            }

            if (this.cachedMonitorMode) {
                this.state = AgentControllerState.WAITING_FOR_MONITOR_RESPONSE;
            } else {
                //to get high confidence that the screenshot with highlighted target element has been captured
                if (this.pendingActionInfo.elementIndex !== undefined) { await sleep(40 + elementHighlightRenderDelay); }

                if (this.terminationSignal) {
                    this.logger.info("received termination signal after deciding on the action but before actually committing it (possibly while waiting for a screenshot to be captured with the target element highlighted; terminating task")
                    //the task termination will be handled by the terminateTask method being called by the handler (for
                    // messages from side panel) once this method ends and the controller's mutex is released
                    // This prevents the agent from performing a final action after the user presses the terminate button
                    return;
                }
                this.numPriorScreenshotsTakenForPromptingCurrentAction = 0;
                this.state = AgentControllerState.WAITING_FOR_ACTION;
                try {
                    pageActorPort.postMessage({
                        type: Background2PagePortMsgType.REQ_ACTION, action: this.pendingActionInfo.action,
                        elementIndex: this.pendingActionInfo.elementIndex, value: this.pendingActionInfo.value
                    });
                } catch (error: any) {
                    if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                        this.logger.info("content script disconnected from service worker while processing interactive elements and before trying to request an action; task will resume after new content script connection is established");
                        this.state = AgentControllerState.PENDING_RECONNECT;
                        this.pendingActionInfo = undefined;
                    } else {
                        const termReason = `unexpected error while requesting an action; error: ${renderUnknownValue(error)}`;
                        this.logger.error(`${termReason}; terminating task`);
                        this.terminateTask(termReason);
                    }
                }
            }
            return;//not doing break here b/c no point doing the noop checks if it successfully chose an action which
            // was sent to the content script
        }
        if (this.noopCount > this.maxNoopLimit) {
            const termReason = `exceeded the maximum noop limit of ${this.maxNoopLimit}`;
            this.logger.warn(`task terminated because it ${termReason}`);
            this.terminateTask(termReason);
        } else if (this.failureOrNoopStreak > this.maxFailureOrNoopStreakLimit) {
            const termReason = `exceeded the maximum failure-or-noop streak limit of ${this.maxFailureOrNoopStreakLimit}`;
            this.logger.warn(`task terminated because it ${termReason}`);
            this.terminateTask(termReason);
        }
    }

    //todo ask Boyuan if he wants me to break this up even further- I'm on the fence as to whether it would actually
    // improve code readability
    /**
     * @description Queries the LLM for the next action to take based on the current state of the page and the actions
     * so far, then processes the response and (if there is a chosen action) stores the chosen action in
     * this.pendingActionInfo
     * @param interactiveChoices brief descriptions of the interactive elements on the page (starting and ending with the appropriate html tag)
     * @param screenshotDataUrl the data URL of the screenshot of the current page
     * @param candidateIds the indices of the interactive elements that are candidates for the next action
     * @param interactiveElements the full data about the interactive elements on the page
     * @param monitorRejectionContext optional string to include in the query prompt if the previous action was rejected by the monitor
     * @param viewportInfo information about the viewport and the dimensions of the page that it's showing part of
     * @return indicator of what the main "processPageStateFromActor" function should do next based on the LLM response
     *         (e.g. whether to try reprompting, proceed with the action, or abort the task)
     */
    private queryLmmAndProcessResponsesForAction = async (
        interactiveChoices: string[], screenshotDataUrl: string, candidateIds: number[],
        interactiveElements: SerializableElementData[], monitorRejectionContext: string | undefined,
        viewportInfo: ViewportDetails): Promise<LmmOutputReaction> => {
        if (this.portToSidePanel === undefined) {
            this.logger.error("no side panel connection to send query prompt to; abandoning task");
            //terminateTask() will be called by the onDisconnect listener
            return LmmOutputReaction.ABORT_TASK;
        }

        const prompts: LmmPrompts = generatePrompt(this.taskSpecification,
            this.actionsSoFar.map(entry => `${entry.success ? "SUCCEEDED" : "FAILED"}-${entry.actionDesc}; explanation: ${entry.explanation}`),
            interactiveChoices, viewportInfo);
        if (monitorRejectionContext !== undefined) {
            prompts.queryPrompt += `\n${monitorRejectionContext}`;
        }

        this.logger.debug("prompts: " + JSON.stringify(prompts));
        const startOfAiQuerying = Date.now();
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
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.NOTIFICATION, details: planningOutput,
                    msg: "AI planning complete, now asking model to specify what exactly it should do next to advance that plan"
                });
            } catch (error: any) {
                const termReason = `error while trying to send notification to side panel about planning completion; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return LmmOutputReaction.ABORT_TASK;
            }

            groundingOutput = await this.aiEngine.generateWithRetry(
                {prompts: prompts, turnInStep: 1, imgDataUrl: screenshotDataUrl, priorTurnOutput: planningOutput},
                aiApiBaseDelay);
        } catch (error) {
            const termReason = `error getting next step from ai; error: ${renderUnknownValue(error)}`;
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return LmmOutputReaction.ABORT_TASK;
        }
        this.logger.debug(`ai querying took ${Date.now() - startOfAiQuerying}ms`);
        this.logger.info("grounding output: " + groundingOutput);

        const [element, action, value, explanation] = postProcessActionLlm(groundingOutput);
        //if it proves to be a problem, can add validation to reject explanations which contain multiple periods that're each followed by space or end of string
        this.logger.debug(`suggested action: ${action}; value: ${value}; explanation: ${explanation}`);
        let chosenCandidateIndex = getIndexFromOptionName(element);


        this.predictionsInTask.push({
            modelPlanningOutput: planningOutput, modelGroundingOutput: groundingOutput,
            targetElementData: chosenCandidateIndex !== undefined && chosenCandidateIndex < candidateIds.length
                ? interactiveElements[candidateIds[chosenCandidateIndex]] : undefined,
            actionName: action, value: value, explanation: explanation
        });

        if (action === Action.TERMINATE) {
            this.logger.info("Task completed!");
            this.actionsSoFar.push(
                {actionDesc: "Terminate task as completed", success: true, explanation: explanation});
            this.terminateTask("Task completed: " + explanation);
            return LmmOutputReaction.ABORT_TASK;
        } else if (action === Action.NONE) {
            //after next major model release, if this comes up, then maybe, if the agent repeatedly says that the page
            // hasn't fully loaded, we should consider the possibility that the "wait until page fully loaded" logic in
            // content script didn't work properly and we should fetch fresh elements
            this.logger.warn("ai selected NONE action, counting as noop action and reprompting");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected NONE action type`, explanation: explanation,
                success: false, noopType: NoopType.AI_SELECTED_NONE_ACTION
            });
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.NOTIFICATION, details: groundingOutput,
                    msg: "AI refused to specify a next action; reprompting"
                });
            } catch (error: any) {
                const termReason = `error while trying to send notification to side panel about refusal to specify next action; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return LmmOutputReaction.ABORT_TASK;
            }
            return LmmOutputReaction.TRY_REPROMPT;
        }
        const actionNeedsNoElement = action === Action.SCROLL_UP || action === Action.SCROLL_DOWN
            || action === Action.PRESS_ENTER;


        if ((chosenCandidateIndex == undefined || chosenCandidateIndex > candidateIds.length) && !actionNeedsNoElement) {
            this.logger.warn(`ai selected invalid option ${element} ` + (chosenCandidateIndex !== undefined
                ? `(was parsed as candidate index ${chosenCandidateIndex}, but the candidates list only had ${candidateIds.length} entries)`
                : `(cannot be parsed into an index)`) + ", counting as noop action and reprompting");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected invalid option ${element}`,
                success: false, noopType: NoopType.INVALID_ELEMENT, explanation: explanation
            });
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.NOTIFICATION, details: groundingOutput,
                    msg: "AI gave invalid specification of element to act on; reprompting"
                });
            } catch (error: any) {
                const termReason = `error while trying to send notification to side panel about failure to specify valid target element for next action; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return LmmOutputReaction.ABORT_TASK;
            }
            return LmmOutputReaction.TRY_REPROMPT;
        } else if (chosenCandidateIndex === candidateIds.length && !actionNeedsNoElement) {
            this.logger.info("ai selected 'none of the above' option for element selection when action targets specific element, marking action as noop");
            this.noopCount++;
            this.failureOrNoopStreak++;
            this.actionsSoFar.push({
                actionDesc: `NOOP: ai selected 'none of the above' option for element selection when action ${action} targets specific element`,
                success: false, noopType: NoopType.ACTION_INCOMPATIBLE_WITH_NONE_OF_ABOVE_ELEMENT,
                explanation: explanation
            });
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.NOTIFICATION, details: groundingOutput,
                    msg: "AI specified a next action that requires a target element but didn't provide a valid target element identifier; reprompting"
                });
            } catch (error: any) {
                const termReason = `error while trying to send notification to side panel about inconsistency in specification of next action; error: ${renderUnknownValue(error)}`;
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return LmmOutputReaction.ABORT_TASK;
            }
            return LmmOutputReaction.TRY_REPROMPT;
        }
        //todo if it says 'scroll down' when viewport info shows that we're already at the bottom, simply treat that as a no-op and remprompt
        // same for scroll up when at top

        if (chosenCandidateIndex !== undefined && chosenCandidateIndex >= candidateIds.length && actionNeedsNoElement) {
            chosenCandidateIndex = undefined;
        }

        const chosenElementIndex: number | undefined = chosenCandidateIndex != undefined ? candidateIds[chosenCandidateIndex] : undefined;
        this.logger.debug(`acting on the ${chosenCandidateIndex} entry from the candidates list; which is the ${chosenElementIndex} element of the original interactiveElements list`);

        this.pendingActionInfo = {
            elementIndex: chosenElementIndex, action: action, value: value, explanation: explanation,
            elementData: chosenElementIndex ? interactiveElements[chosenElementIndex] : undefined
        };
        //can add TYPE and SELECT here if I ever see or get reports of such actions causing page navigation
        this.mightNextActionCausePageNav = (action === Action.PRESS_ENTER || action === Action.CLICK);


        return LmmOutputReaction.PROCEED_WITH_ACTION;
    }

    /**
     * takes screenshot of current tab, tries to save it to database (asynchronously), and returns that screenshot
     * as a data url
     * @param screenshotType what the purpose of the screenshot is (e.g. initial for prompting the model to pick a
     *          next action, 'targeted' to visually capture which element the model chose to target, etc.)
     * @param promptingIndexForAction how many prompting screenshots had been taken before this one for the current
     *          action (i.e. without an action being decided-on/performed between those prior prompting screenshots and
     *          this screenshot)
     * @return a data url of the screenshot (i.e. base64-encoded string for the png file's bytes)
     */
    captureAndStoreScreenshot = async (screenshotType: string, promptingIndexForAction: number): Promise<string | undefined> => {
        let screenshotDataUrl: string | undefined;
        if (this.taskId === undefined) {
            const termReason = `task id is undefined when capturing screenshot of type ${screenshotType}`;
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return;
        }

        //removing Z because it could throw off string-based ordering in browser db index if some entries timestamps
        // were millisecond precision and others were microsecond precision.
        // Realistically, this is probably not a possible problem for screenshot object store (since all entries in
        // that store are created by the service worker), but it is a necessary measure for the logs store (since some
        // entries in that store are created by things that can use performance.now() (i.e. side panel) while others
        // are created by things that can't (i.e. the service worker and content script));
        // It's better for all timestamps in the indexeddb to follow the same convention
        const screenshotTs = new Date().toISOString().slice(0, -1);
        try {
            screenshotDataUrl = await this.chromeWrapper.fetchVisibleTabScreenshot();
        } catch (error: any) {
            const termReason = `error while trying to get screenshot of current tab; error: ${renderUnknownValue(error)}`;
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return;
        }
        this.logger.debug(`${screenshotType} screenshot data url (truncated): ${screenshotDataUrl.slice(0, 100)}...`);
        if (dbConnHolder.dbConn) {
            const screenshotIdStr = [this.taskId, this.actionsSoFar.length,
                promptingIndexForAction, screenshotType].join(",");
            const startIndexForBase64Data = screenshotDataUrl.indexOf(';base64,') + 8;
            if (startIndexForBase64Data <= 0) {
                const termReason = "error while trying to add screenshot to indexeddb: screenshot data url does not contain expected prefix";
                this.logger.error(termReason);
                this.terminateTask(termReason);
                return;
            }
            const screenshotBase64Content = screenshotDataUrl.substring(startIndexForBase64Data);
            dbConnHolder.dbConn.add(SCREENSHOTS_OBJECT_STORE, {
                timestamp: screenshotTs, taskId: this.taskId, numPriorActions: this.actionsSoFar.length,
                numPriorScreenshotsForPrompts: promptingIndexForAction,
                screenshotType: screenshotType, screenshotId: screenshotIdStr, screenshot64: screenshotBase64Content
            }).catch((error) => console.error("error adding screenshot to indexeddb:", renderUnknownValue(error)));
        } else {
            this.logger.warn("no db connection available, cannot save screenshot");
        }
        if (screenshotType === "initial") { this.numPriorScreenshotsTakenForPromptingCurrentAction++; }
        return screenshotDataUrl;
    }

    /**
     * @description Processes the confirmation from the content script that an action was performed, and then requests
     * information about the new page state from the content script
     * @param message the message from the content script containing the result of the action
     * @param port the port object representing the connection between the service worker and the content script
     */
    processActionPerformedConfirmation = async (message: any, port: Port): Promise<void> => {
        if (this.state !== AgentControllerState.WAITING_FOR_ACTION) {
            const termReason = "received 'action performed' message from content script while not waiting for action, but rather in state " + AgentControllerState[this.state];
            this.logger.error(termReason);
            this.terminateTask(termReason);
            return;
        }
        this.logger.trace("controller notified that action was performed by content script");
        this.state = AgentControllerState.ACTIVE;

        const wasSuccessful: boolean = message.success;
        let actionDesc: string = message.result ? message.result :
            (this.pendingActionInfo ?
                    buildGenericActionDesc(this.pendingActionInfo.action, this.pendingActionInfo.elementData,
                        this.pendingActionInfo?.value)
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

        const aborted = this.updateActionHistory(actionDesc, wasSuccessful, this.pendingActionInfo?.explanation);
        if (aborted) {
            this.logger.info("task terminated due to exceeding a limit on operations, noops, or failures");
        } else if (wasPageNav) {
            this.logger.info("tab id changed after action was performed, so killing connection to " +
                "old tab and injecting content script in new tab " + tab?.title);
            this.killPageConnection(port);
            await this.injectPageActorScript(false, tab);
            //only resetting this after script injection because script injection needs to know whether it's ok
            // that the tab id might've changed
            this.mightNextActionCausePageNav = false;
        } else {
            this.mightNextActionCausePageNav = false;
            this.state = AgentControllerState.WAITING_FOR_PAGE_STATE
            try {
                port.postMessage({type: Background2PagePortMsgType.REQ_PAGE_STATE});
            } catch (error: any) {
                if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                    this.logger.info("content script disconnected from service worker while processing completed action and before trying to request more interactive elements; task will resume after new content script connection is established");
                    this.state = AgentControllerState.PENDING_RECONNECT;
                } else {
                    const termReason = `unexpected error while trying to request more interactive elements; error: ${renderUnknownValue(error)}`;
                    this.logger.error(`${termReason}; terminating task`);
                    this.terminateTask(termReason);
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
     * @param explanation model-generated 1 sentence explanation of the nature and purpose of the current action
     * @return whether the task should be aborted; indicates whether the action-completion-handler function which called
     *          this should proceed with setting things in motion for the next step of the task
     */ //todo write at least skeleton of unit test suite for this
    updateActionHistory(actionDesc: string, wasSuccessful: boolean, explanation: string = "explanation unavailable") {
        let shouldAbort: boolean = false;
        this.actionsSoFar.push({actionDesc: actionDesc, success: wasSuccessful, explanation: explanation});

        if (!this.portToSidePanel) {
            const termReason = "no side panel connection to send action history to";
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return true;
        }
        try {
            this.portToSidePanel.postMessage({
                actionDesc: actionDesc, success: wasSuccessful, explanation: explanation,
                actionInfo: this.pendingActionInfo, type: Background2PanelPortMsgType.TASK_HISTORY_ENTRY
            });
        } catch (error: any) {
            const termReason = "error when sending action history entry to side panel";
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return true;
        }

        this.pendingActionInfo = undefined;

        this.opsCount++;
        if (wasSuccessful) {
            this.failureOrNoopStreak = 0;//failure-or-noop streak can only be broken by successfully _completed_ action
        } else {
            this.failureCount++;
            this.failureOrNoopStreak++;
        }
        this.logger.debug(`current ops count is ${this.opsCount}, noop count is ${this.noopCount}, failure count is ${this.failureCount}, failure-or-noop streak is ${this.failureOrNoopStreak}`)

        if (this.failureOrNoopStreak > this.maxFailureOrNoopStreakLimit) {
            const termReason = `exceeded the maximum failure-or-noop streak limit of ${this.maxFailureOrNoopStreakLimit}`;
            this.logger.warn(`task terminated because it ${termReason}`);
            this.terminateTask(termReason);
            shouldAbort = true;
        } else if (this.failureCount > this.maxFailureLimit) {
            const termReason = `exceeded the maximum failure limit of ${this.maxFailureLimit}`;
            this.logger.warn(`task terminated because it ${termReason}`);
            this.terminateTask(termReason);
            shouldAbort = true;
        } else if (this.opsCount > this.maxOpsLimit) {
            const termReason = `exceeded the maximum operations limit of ${this.maxOpsLimit}`;
            this.logger.warn("task terminated because it " + termReason);
            this.terminateTask(termReason);
            shouldAbort = true;
        }
        return shouldAbort;
    }

    processMonitorApproval = () => {
        if (this.state !== AgentControllerState.WAITING_FOR_MONITOR_RESPONSE) {
            const termReason = "received monitor approval message while not waiting for monitor response, but rather in state " + AgentControllerState[this.state];
            this.logger.error(termReason);
            this.terminateTask(termReason);
            return;
        } else if (this.portToContentScript === undefined) {
            const termReason = "received monitor approval message while not having a connection to the content script";
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return;
        } else if (this.pendingActionInfo === undefined) {
            const termReason = "Monitor approval received for chosen action, but no chosen action remains stored in controller's memory";
            this.logger.error(`${termReason}; terminating task`);
            this.terminateTask(termReason);
            return;
        }
        this.numPriorScreenshotsTakenForPromptingCurrentAction = 0;
        this.state = AgentControllerState.WAITING_FOR_ACTION;
        try {
            this.portToContentScript.postMessage({
                type: Background2PagePortMsgType.REQ_ACTION, elementIndex: this.pendingActionInfo.elementIndex,
                action: this.pendingActionInfo.action, value: this.pendingActionInfo.value
            });
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("content script disconnected from service worker while waiting for monitor judgement on proposed action; task will resume after new content script connection is established");
                this.state = AgentControllerState.PENDING_RECONNECT;
                this.pendingActionInfo = undefined;
            } else {
                const termReason = `unexpected error while requesting an action after monitor approval; error: ${renderUnknownValue(error)}`;
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
            }
        }
    }

    processMonitorRejection = (message: any) => {
        if (this.state !== AgentControllerState.WAITING_FOR_MONITOR_RESPONSE) {
            const termReason = `received monitor rejection message while not waiting for monitor response, but rather in state ${AgentControllerState[this.state]}`;
            this.logger.error(termReason);
            this.terminateTask(termReason);
            return;
        } else if (this.portToContentScript === undefined) {
            const termReason = "received monitor rejection message while not having a connection to the content script";
            this.logger.error(termReason + "; terminating task");
            this.terminateTask(termReason);
            return;
        }
        this.wasPrevActionRejectedByMonitor = true;
        this.monitorFeedback = message.feedback as string;
        //to?do if monitor mode is used a lot (and the models continue to be dumb enough that you sometimes have to
        // reject several bad ideas in a row), then it might be useful to accumulate the feedback from each rejection
        // and include all previously proposed actions and each proposed action's rejection info (potentially including
        // its rejection feedback) in the next planning prompt to the model

        this.state = AgentControllerState.WAITING_FOR_PAGE_STATE
        try {
            this.portToContentScript.postMessage(
                {type: Background2PagePortMsgType.REQ_PAGE_STATE, isMonitorRetry: true});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("content script disconnected from agent controller while the latter was waiting for a response from the monitor; task will resume after new content script connection is established");
                this.state = AgentControllerState.PENDING_RECONNECT;
            } else {
                const termReason = `unexpected error trying to request interactive elements; error: ${renderUnknownValue(error)}`;
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
            }
        }
    }

    handlePanelMsgToController = async (message: any, port: chrome.runtime.Port): Promise<void> => {
        if (message.type === Panel2BackgroundPortMsgType.START_TASK) {
            await this.mutex.runExclusive(() => {
                this.startTask(message, port).catch((error) => {
                    this.logger.error("error while trying to start task; error: ", renderUnknownValue(error));
                });
            });
        } else if (message.type === Panel2BackgroundPortMsgType.KILL_TASK) {
            this.terminationSignal = true;
            await this.mutex.runExclusive(() => {
                if (this.taskId === undefined) {
                    this.logger.error("received termination signal from side panel while no task was running; ignoring");
                    try {
                        port.postMessage(
                            {type: Background2PanelPortMsgType.ERROR, msg: "No task was running to terminate"});
                    } catch (error: any) {
                        this.logger.error(`error while trying to send error message to side panel about task termination request when no task was running; error: ${renderUnknownValue(error)}`);
                    }
                    this.terminationSignal = false;
                } else {
                    this.terminateTask("user request");
                }
            });
        } else if (message.type === Panel2BackgroundPortMsgType.MONITOR_APPROVED) {
            await this.mutex.runExclusive(() => this.processMonitorApproval());
        } else if (message.type === Panel2BackgroundPortMsgType.MONITOR_REJECTED) {
            await this.mutex.runExclusive(() => this.processMonitorRejection(message));
        } else if (message.type === Panel2BackgroundPortMsgType.KEEP_ALIVE) {
            this.logger.trace("received keep-alive message from side panel");
            //ignore this message; just receiving it serves the purpose of keeping Chrome from killing the service
            // worker for another 30sec; as an added layer of redundancy on top of the keep-alive alarms
            // Just the alarms on their own still lead to service worker disconnects every few hours
        } else if (message.type === Panel2BackgroundPortMsgType.EXPORT_UNAFFILIATED_LOGS) {
            if (dbConnHolder.dbConn) {
                const zip = new JSZip();
                const logFileContents = await this.retrieveLogsForTaskId(dbConnHolder.dbConn, taskIdPlaceholderVal);
                if (logFileContents != undefined) {
                    const fileSafeTimestampStr = new Date().toISOString().split(":").join("-").split(".").join("_");
                    zip.file(`non_task_specific_${fileSafeTimestampStr}.log`, logFileContents);
                    this.sendZipToSidePanelForDownload(taskIdPlaceholderVal, zip, `misc_logs_${fileSafeTimestampStr}.zip`);
                } //error message already logged in retrieveLogsForTaskId()
            } else { this.logger.error("no db connection available to export non-task-specific logs"); }
        } else {
            this.logger.error("unknown message from side panel:", JSON.stringify(message));
        }
    }

    /**
     * @description Handles messages from the content script to the service worker over their persistent connection
     * @param message the message from the content script
     * @param port the port object representing the connection between the service worker and the content script
     */
    handlePageMsgToAgentController = async (message: any, port: Port): Promise<void> => {
        if (message.type === Page2BackgroundPortMsgType.READY) {
            await this.mutex.runExclusive(() => {this.processPageActorInitialized(port);});
        } else if (message.type === Page2BackgroundPortMsgType.PAGE_STATE) {
            await this.mutex.runExclusive(async () => {await this.processPageStateFromActor(message, port);});
        } else if (message.type === Page2BackgroundPortMsgType.ACTION_DONE) {
            await this.mutex.runExclusive(async () => {await this.processActionPerformedConfirmation(message, port);});
        } else if (message.type === Page2BackgroundPortMsgType.TERMINAL) {
            await this.mutex.runExclusive(() => {
                const termReason = `something went horribly wrong in the content script; details: ${message.error}`;
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
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
        if (!this.pendingActionInfo) {
            const termReason = "service worker's connection to content script was lost while performing an action, but no tentative action was stored";
            this.logger.error(termReason + "; terminating task");
            this.terminateTask(termReason);
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
            this.logger.warn("tab changed after action and yet the connection to the old tab's " +
                "content script was lost (before the controller could terminate it); this is unexpected")
        }
        const actionDesc = buildGenericActionDesc(this.pendingActionInfo.action, this.pendingActionInfo.elementData,
            this.pendingActionInfo.value) + `; this caused page navigation to ${tab.title}`;

        //marking action as failure if it _accidentally_ caused page navigation or otherwise caused the page connection
        // to fail
        const aborted = this.updateActionHistory(actionDesc, this.mightNextActionCausePageNav, this.pendingActionInfo?.explanation);
        if (!aborted) {
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
            this.portToContentScript = undefined;
            if (this.portToSidePanel === undefined) {
                const termReason = "content script disconnected while no side panel connection was open";
                this.logger.error(termReason + "; terminating task");
                this.terminateTask(termReason);
                return;
            }

            if (this.state === AgentControllerState.WAITING_FOR_ACTION) {
                await this.processActorDisconnectDuringAction();
            } else if (this.state === AgentControllerState.PENDING_RECONNECT) {
                this.logger.info("service worker's connection to content script was lost partway through the controller's processing of some step; reestablishing connection")
                try {
                    this.portToSidePanel.postMessage({
                        type: Background2PanelPortMsgType.NOTIFICATION,
                        msg: "Reestablishing connection to content script after it broke unexpectedly"
                    });
                } catch (error: any) {
                    const termReason = `error while trying to notify side panel about reestablishing connection to content script; error: ${renderUnknownValue(error)}`;
                    this.logger.error(`${termReason}; terminating task`);
                    this.terminateTask(termReason);
                    return;
                }
                await this.injectPageActorScript(false);
            } else if (this.state === AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
                this.logger.info("service worker's connection to content script was lost while waiting for the new page to finish loading, probably means another navigation happened automatically. trying to inject the content script into the new page");
                await this.injectPageActorScript(false);
            } else if (this.state === AgentControllerState.IDLE) {
                this.logger.debug("service worker's connection to content script was lost while in idle state; ignoring");
            } else {
                const termReason = `service worker's connection to content script was lost while not waiting for action, but rather in state ${AgentControllerState[this.state]}`;
                this.logger.error(`${termReason}; terminating task`);
                this.terminateTask(termReason);
                //todo Boyuan may eventually want recovery logic here for the user accidentally closing the tab or for the tab/page crashing
                // reloading or reopening the tab might require adding even more permissions to the manifest.json
            }
        });
    }

    handlePanelDisconnectFromController = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            this.logger.debug("side panel disconnected from service worker; port name:", port.name);
            this.portToSidePanel = undefined;
            if (this.state !== AgentControllerState.IDLE) {
                const termReason = "side panel disconnected";
                this.logger.error(termReason);
                this.terminateTask(termReason);
            }
            this.logger.debug("clearing keep-alive alarms so that service worker will be shut down");
            chrome.alarms.clear(serviceWorkerKeepaliveAlarmName).catch((error) =>
                this.logger.warn("error while trying to clear keep-alive alarm; error: ", renderUnknownValue(error)));
            chrome.alarms.clear(serviceWorker2ndaryKeepaliveAlarmName).catch((error) =>
                this.logger.warn("error while trying to clear secondary keep-alive alarm; error: ", renderUnknownValue(error)));
        });
    }

    /**
     * @description ends any connection the service worker may still have to the content script, which should
     * eliminate any further computation in the targeted content script
     * @param pageConn the port object representing the connection between the service worker and the content script
     */
    killPageConnection = (pageConn: Port): void => {
        try {
            //per chrome docs, this shouldn't be necessary (calling disconnect on one side of a port shouldn't trigger
            // that side's onDisconnect listener), but in practice it seems to be necessary
            pageConn.onDisconnect.removeListener(this.handlePageDisconnectFromAgentController);
            this.logger.trace(`removed onDisconnect listener from content script connection ${pageConn.name}`)
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
                this.logger.error(`unexpected error while cleaning up content script connection ${pageConn.name}; error: ${renderUnknownValue(error)}`);
            }
        }
    }

    processMonitorApproveKeyCommand = async (): Promise<void> => {
        if (!this.cachedMonitorMode) {
            this.logger.info("user pressed key command to approve the current action; but monitor mode is not enabled; ignoring");
            return;
        }
        await this.mutex.runExclusive(() => {
            if (this.state !== AgentControllerState.WAITING_FOR_MONITOR_RESPONSE) {
                this.logger.info("user pressed key command to approve the current action, but the controller is not waiting for monitor response; ignoring");
                return;
            }
            this.processMonitorApproval();
        });
    }

    processMonitorRejectKeyCommand = async (): Promise<void> => {
        if (!this.cachedMonitorMode) {
            this.logger.info("user pressed key command to reject the current action; but monitor mode is not enabled; ignoring");
            return;
        }
        await this.mutex.runExclusive(() => {
            if (this.state !== AgentControllerState.WAITING_FOR_MONITOR_RESPONSE) {
                this.logger.info("user pressed key command to reject the current action, but the controller is not waiting for monitor response; ignoring");
                return;
            }
            this.processMonitorRejection({feedback: ""});
        });
    }


    /**
     * @description Terminates the current task, resetting any state and cleaning up the page connection if it's still
     * open
     */
    terminateTask = (terminationReason: string): void => {
        const taskIdBeingTerminated = this.taskId;
        this.logger.info(`TERMINATING TASK ${this.taskId} which had specification: ${this.taskSpecification}; final this.state was ${AgentControllerState[this.state]}; termination reason: ${terminationReason}`);
        this.logger.info("action history for task: " + JSON.stringify(this.actionsSoFar));
        this.logger.info(`summary of actions in task: ${this.opsCount} operations, ${this.noopCount} no-ops, ${this.failureCount} failures; at end of task, the length of the failure-or-noop streak was ${this.failureOrNoopStreak} (this is not the length of the longest such streak during the task)`)
        if (taskIdBeingTerminated === undefined) {
            this.logger.warn("no task id stored, so not storing logs for terminated task");
        } else {
            this.logger.info("starting process of exporting task history to zip file download");
            this.exportTaskHistory(taskIdBeingTerminated, this.taskSpecification, this.actionsSoFar, this.opsCount,
                this.noopCount, this.failureCount, this.failureOrNoopStreak, this.initWebsiteForTask,
                this.predictionsInTask, terminationReason).then(() => {
                this.logger.debug(`for task ${taskIdBeingTerminated}, the process of trying to send task history to side panel (for export as downloaded file) concluded (possibly unsuccessfully but with a fully-handled error)`);
            }, (error) => {
                this.logger.error(`error while trying to export task history for task ${taskIdBeingTerminated}; error: ${renderUnknownValue(error)}`);
            });
        }
        this.taskId = undefined;
        taskIdHolder.currTaskId = undefined;

        this.taskSpecification = "";
        this.currTaskTabId = undefined;
        this.initWebsiteForTask = undefined;
        this.state = AgentControllerState.IDLE;
        this.pendingActionInfo = undefined;
        this.mightNextActionCausePageNav = false;
        this.actionsSoFar = [];
        this.predictionsInTask = [];
        this.opsCount = 0;
        this.noopCount = 0;
        this.failureCount = 0;
        this.failureOrNoopStreak = 0;
        this.wasPrevActionRejectedByMonitor = false;
        this.monitorFeedback = "";
        this.numPriorScreenshotsTakenForPromptingCurrentAction = 0;
        if (this.portToContentScript) {
            this.logger.info("terminating task while content script connection may still be open, attempting to close it")
            this.killPageConnection(this.portToContentScript);
            this.portToContentScript = undefined;
        }

        if (this.portToSidePanel !== undefined) {
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.TASK_ENDED, taskId: taskIdBeingTerminated,
                    details: terminationReason
                });
            } catch (error: any) {
                this.logger.error(`error while trying to inform side panel about agent controller having terminated the current task; error: ${renderUnknownValue(error)}`);
            }
        } else {this.logger.error(`no side panel available to notify about end of task ${taskIdBeingTerminated}`)}
        //todo if aiEngine ever has its own nontrivial bits of task-specific state, should probably somehow reset them here

        //todo if I use console.group elsewhere, should use console.groupEnd() here repeatedly (maybe 10 times) to be
        // ~completely certain that any nested groups get escaped when the task ends, even if things went really wrong with
        // exception handling and control flow expectations wrt group management
        // If groupEnd throws when there's no group to escape, use a try catch and the catch block would break the loop
        this.terminationSignal = false;
    }

    exportTaskHistory = async (
        givenTaskId: string, taskSpec: string, actionsHistory: ActionRecord[], numOps: number, numNoops: number,
        numFailures: number, failOrNoopStreakAtEnd: number, startingWebUrl: string | undefined,
        predictions: PredictionRecord[], terminationReason: string): Promise<void> => {
        if (!dbConnHolder.dbConn) {
            this.logger.error("no db connection available to export task history");
            return;
        }
        const zip = new JSZip();

        const logFileContents = await this.retrieveLogsForTaskId(dbConnHolder.dbConn, givenTaskId);
        if (logFileContents != undefined) {
            zip.file("agent.log", logFileContents);
        } else {
            return;//error message already logged in retrieveLogsForTaskId()
        }

        const taskResult = {
            task: taskSpec,
            website: startingWebUrl,
            num_operations: numOps,
            num_noops: numNoops,
            num_failures: numFailures,
            fail_or_noop_streak: failOrNoopStreakAtEnd,
            termination_reason: terminationReason,
            action_history: actionsHistory
        };
        const resultStr = JSON.stringify(taskResult, null, 4);
        this.logger.debug(`task history for task ${givenTaskId} has length: ${resultStr.length}`);
        zip.file("result.json", resultStr);

        const screenshotsFolder = zip.folder("screenshots") ?? zip;
        if (screenshotsFolder == zip) {//using referential equality intentionally here
            this.logger.error("while trying to make folder for screenshots in zip file for task history, JSZip misbehaved (returned null from zip.folder() call); defaulting to just adding the screenshots to the root of the zip file");
        }

        let screenshotsForTask: ScreenshotRecord[];
        try {
            screenshotsForTask = await dbConnHolder.dbConn.getAllFromIndex(SCREENSHOTS_OBJECT_STORE, "by-task", givenTaskId);
        } catch (error: any) {
            this.logger.error(`error while trying to get screenshots for task ${givenTaskId} from db for export to zip; error: ${renderUnknownValue(error)}`);
            return;
        }
        for (const screenshotRecord of screenshotsForTask) {
            this.logger.debug(`about to add screenshot to zip file for task with id ${screenshotRecord.screenshotId} and base64-data length: ${screenshotRecord.screenshot64.length}`);
            const screenshotBytes = base64ToByteArray(screenshotRecord.screenshot64);
            this.logger.debug(`after conversion from base64 to binary, screenshot bytes length: ${screenshotBytes.length}`);
            const fileSafeTimestampStr = screenshotRecord.timestamp.split(":").join("-").split(".").join("_");
            //note - if prof or users request, can add the Z's back in when exporting from db to screenshot downloads,
            // to make clear to consumers of those downloads that the timestamps in their file names are in UTC+0

            const screenshotFileName = `action-${screenshotRecord.numPriorActions}_promptingIndexForAction-${screenshotRecord.numPriorScreenshotsForPrompts}_type-${screenshotRecord.screenshotType}_ts-${fileSafeTimestampStr}.png`;
            screenshotsFolder.file(screenshotFileName, screenshotBytes);
        }

        function replaceUndefinedWithNull(key: any, value: any) {return value === undefined ? null : value;}

        const predictionsStr = JSON.stringify(predictions, replaceUndefinedWithNull, 4);
        zip.file("all_predictions.json", predictionsStr);

        this.sendZipToSidePanelForDownload(givenTaskId, zip);
    }

    retrieveLogsForTaskId = async (dbConnection: IDBPDatabase<AgentDb>, taskId: string): Promise<string | undefined> => {
        let logsForTask: LogMessage[];
        try {
            logsForTask = await dbConnection.getAllFromIndex(LOGS_OBJECT_STORE, "by-task", taskId);
        } catch (error: any) {
            this.logger.error(`error while trying to get logs for task ${taskId} from db for export to zip; error: ${renderUnknownValue(error)}`);
            return undefined;
        }
        logsForTask.sort((msg1, msg2) => {
            //Z timezone indicator was already trimmed off during storage in db to avoid screwing up ordering of
            // by-ts index; this was safe because all timestamps are in UTC+0
            if (msg1.timestamp < msg2.timestamp) return -1;
            if (msg1.timestamp > msg2.timestamp) return 1;
            return 0;
        });

        //note - if prof or users request, can add the Z's back in when exporting from db to log file, to make clear
        // that they're in UTC+0
        const logFileContents = logsForTask.map(log =>
            `${log.timestamp} ${log.loggerName} ${log.level.toUpperCase()}: ${log.msg}`)
            .join("\n");
        this.logger.debug(`log file contents has length ${logFileContents.length}`);
        return logFileContents;
    }


    private sendZipToSidePanelForDownload(givenTaskId: string, zip: JSZip, overrideZipFilename?: string) {
        this.logger.info(`about to compress task info into virtual zip file for task ${givenTaskId}`);
        zip.generateAsync(
            {type: "blob", compression: "DEFLATE", compressionOptions: {level: 5}}).then(async (content) => {
            this.logger.debug(`successfully generated virtual zip file for task ${givenTaskId}; about to send it to side panel so that it can be saved as a download`);
            if (!this.portToSidePanel) {
                this.logger.error(`no side panel connection available to send zip file to for download (for history of task ${givenTaskId})`);
                return;
            }
            this.logger.debug(`blob for virtual zip file for task ${givenTaskId} has byte length: ${content.size}`);
            const arrBuffForTraceZip = await content.arrayBuffer();
            this.logger.debug(`array buffer made from that blob has length: ${arrBuffForTraceZip.byteLength}`);
            const arrForTraceZip = Array.from(new Uint8Array(arrBuffForTraceZip));
            this.logger.debug(`array made from that buffer has length: ${arrForTraceZip.length}`);
            try {
                this.portToSidePanel.postMessage({
                    type: Background2PanelPortMsgType.HISTORY_EXPORT, data: arrForTraceZip,
                    fileName: overrideZipFilename ?? `task-${givenTaskId}-trace.zip`
                });
            } catch (error: any) {
                this.logger.error(`error while trying to send zip file for task ${givenTaskId} to side panel for download; error: ${renderUnknownValue(error)}`);
            }
            this.logger.debug(`sent zip file for task ${givenTaskId}'s history to side panel for download`);
        }, (error) => {
            this.logger.error(`error while trying to generate zip file for task ${givenTaskId}; error: ${renderUnknownValue(error)}`);
        });
    }

    //todo getActiveTab, sendEnterKeyPress, and hoverOnElem are good candidates for being moved out of AgentController (which is way too big)

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
            const errMsg = `error querying active tab; error: ${renderUnknownValue(error)}`;
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
        this.logger.debug(`chrome.debugger attached to the tab ${tabId} to send an Enter key press`);
        //thanks to @activeliang https://github.com/ChromeDevTools/devtools-protocol/issues/45#issuecomment-850953391
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent key-down keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "char", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent char keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent keyup keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after sending an Enter key press`);
    }

    /**
     * @description simulate the user hovering over an element (so that something will pop up or be displayed)
     * current impl: Sends a mouse 'moved' event to the tab with the given id to say that the mouse pointer is now at
     * the given coordinates.
     * @param tabId the id of the tab to hover over the element in
     * @param x the number of css pixels from the left edge of the viewport to the position on the element which
     *           the mouse pointer should be hovering over
     * @param y the number of css pixels from the top edge of the viewport to the position on the element which
     *           the mouse pointer should be hovering over
     */
    hoverOnElem = async (tabId: number, x: number, y: number): Promise<void> => {
        this.logger.debug(`chrome.debugger about to attach to the tab ${tabId} to hover over an element at ${x}, ${y}`);
        await this.chromeWrapper.attachDebugger({tabId: tabId}, "1.3");
        this.logger.debug(`chrome.debugger attached to the tab ${tabId} to hover over an element at ${x}, ${y}`);

        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mouseMoved", "x": x, "y": y});

        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after hovering over an element at ${x}, ${y}`);
    }


    /*
     * the below is sufficient for nearly-real clicking on an element via debugger (as opposed to js click)
     * await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1});
        await sleep(2000);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1});
     */


}








