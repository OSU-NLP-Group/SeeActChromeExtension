import {assertIsValidLogLevelName, augmentLogMsg, createNamedLogger} from "./utils/shared_logging_setup";
import {v4 as uuidV4} from 'uuid';
import {OpenAiEngine} from "./utils/OpenAiEngine";
import {SerializableElementData} from "./utils/BrowserHelper";
import {formatChoices, generatePrompt, postProcessActionLlm, StrTriple} from "./utils/format_prompts";
import {getIndexFromOptionName} from "./utils/format_prompt_utils";
import {expectedMsgForPortDisconnection, buildGenericActionDesc, sleep} from "./utils/misc";
import {Mutex} from "async-mutex";
import log = require("loglevel");
import Port = chrome.runtime.Port;
import MessageSender = chrome.runtime.MessageSender;
import {AgentController} from "./utils/AgentController";


console.log("successfully loaded background script in browser");

//initially, unified/relatively-persistent logging is achieved simply by having content script and popup's js
// send messages to the background script, which will print to the console in the extension's devtools window
let centralLogger = createNamedLogger('service-worker', true);

centralLogger.trace("central logger created in background script");

//todo? later add indexeddb logging via the background script, i.e. the part of the message listener which handles
// 'log'-type requests will write them to db rather than solely the extension's console
// if this is done, it will require changes to how loggers are created for code that's running in the service worker
/*const LOGS_OBJECT_STORE = "logs";

chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason == "install") {
        console.log("This is a first install! initializing indexeddb for logging");

        const openRequest: IDBOpenDBRequest = indexedDB.open("Browser_LLM_Agent_Logging", 1);

        openRequest.onupgradeneeded = function (e: IDBVersionChangeEvent) {
            const db = (e.target as IDBOpenDBRequest).result;
            console.log("handling upgrade of logging db during initial install of extension");
            if (!db.objectStoreNames.contains(LOGS_OBJECT_STORE)) {
                console.log("creating object store for logs during initial install of extension");
                db.createObjectStore(LOGS_OBJECT_STORE, {autoIncrement: true});
            }
        };
        openRequest.onsuccess = function (e) {
            console.log("logging db successfully opened during initial install of extension");
            const db = (e.target as IDBOpenDBRequest).result;
            db.close();
            console.log("logging db successfully closed after creating/opening during initial install of extension");
        };
        openRequest.onerror = function (e) {
            // Handle errors
            console.log("failure during opening of logging db during initial install of extension!");
            console.dir(e);
        };
    }
});*/
//todo before official release, if indexeddb persistent logging was implemented, make mechanism to trigger
// once every 14 days and purge logs older than 14 days from the extension's indexeddb

//todo experiment with console.group() and console.groupEnd() at start and end of code blocks which contain a bunch of
// logging statements, to make the console log easier to parse
//  Only do this at the start of a try catch, and do console.groupEnd() in a finally
//  ?Or in a very simple case where no methods are being called that might throw something between the group() call and the groupEnd() call? risks someone missing this and adding risky statements within the group's scope later :(

//todo semi-relatedly, look out for cases where console.dir() could be used for examining objects with complex internal state when there's a problem, e.g. html elements

// if microsecond precision timestamps are needed for logging, can use this (only ~5usec precision, but still better than 1msec precision)
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now

enum AgentControllerState {
    IDLE,//i.e. no active task
    WAITING_FOR_CONTENT_SCRIPT_INIT,//there's an active task, but injection of content script hasn't completed yet
    ACTIVE,//partway through an event handler function
    WAITING_FOR_ELEMENTS,// waiting for content script to retrieve interactive elements from page
    WAITING_FOR_ACTION,//waiting for content script to perform an action on an element
    PENDING_RECONNECT//content script disconnected, but waiting for new connection to be established when the onDisconnect listener gets to run
}

//todo once this is working, move all of these globals and the functions that rely on them into an AgentController class,
// otherwise almost all of this code will be impossible to unit test
//GLOBALS FOR TASK
const mutex = new Mutex();

let taskId: string | undefined = undefined;
let taskSpecification: string = "";
let currTaskTabId: number | undefined;

type ActionInfo = { elementIndex?: number, elementData?: SerializableElementData, action: string, value?: string };
let tentativeActionInfo: ActionInfo | undefined;
let mightNextActionCausePageNav: boolean = false;

let actionsSoFar: { actionDesc: string, success: boolean }[] = [];

let state: AgentControllerState = AgentControllerState.IDLE;

let currPortToContentScript: Port | undefined;

//todo to avoid the user having to keep the extension's devtools window open whenever they want to use the web agent,
// the aiengine/agentcontroller initialization will probably need to go in the handleMsgFromPage() function in the
// "startTask" else-if block

//eventually allow other api's/model-providers
const modelName: string = "gpt-4-turbo";
//REMINDER - DO NOT COMMIT ANY NONTRIVIAL EDITS OF THE FOLLOWING LINE
const apiKey: string = "PLACEHOLDER";

//this won't need to be a script-global variable after the rework, just local variable in the piece of message handling
// code that initializes the agent controller
const aiEngine = new OpenAiEngine(modelName, apiKey);

//this will still need to be a script-global variable after the rework, but it'll have to have type signature AgentController|undefined
let agentController = new AgentController(aiEngine);


//todo jsdoc
async function injectContentScript(isStartOfTask: boolean, sendResponse?: (response?: any) => void, newTab?: chrome.tabs.Tab): Promise<void> {
    let tabId: number | undefined = undefined;
    let tab: chrome.tabs.Tab | undefined = newTab;
    if (!tab) {
        try {
            tab = await getActiveTabId();
        } catch (error) {
            centralLogger.error(`error ${error} getting active tab id, cannot inject content script; full error object:${JSON.stringify(error)}`);
            terminateTask();
            sendResponse?.({success: false, message: `Can't get tab id because of error: ${error}`});
            return;
        }
    }
    tabId = tab.id;
    if (!tabId) {
        centralLogger.error("Can't inject agent script into chrome:// URLs for security reasons; " + isStartOfTask ? "please only try to start the agent on a regular web page." : "please don't switch to a chrome:// URL while the agent is running");
        terminateTask();
        sendResponse?.({success: false, message: "Can't inject script in a chrome:// URL"});
    } else {
        const toStartTaskStr = isStartOfTask ? " to start a task" : "";

        if (isStartOfTask) {
            currTaskTabId = tabId;
        } else if (currTaskTabId !== tabId) {
            if (mightNextActionCausePageNav) {
                currTaskTabId = tabId;
            } else {
                const errMsg = `The active tab changed unexpectedly to ${tab.title}. Terminating task.`;
                centralLogger.error(errMsg);
                terminateTask();
                sendResponse?.({success: false, message: errMsg});
                return;
            }
        }
        centralLogger.trace("injecting agent script into page" + toStartTaskStr + "; in tab " + tabId);

        state = AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT;
        try {
            await chrome.scripting.executeScript({files: ['./src/page_interaction.js'], target: {tabId: tabId}});
            centralLogger.trace('agent script injected into page' + toStartTaskStr);
            sendResponse?.({success: true, taskId: taskId, message: "Started content script in current tab"});
        } catch (error) {
            centralLogger.error(`error injecting agent script into page${toStartTaskStr}; error: ${error}; jsonified error: ${JSON.stringify(error)}`);
            terminateTask();
            sendResponse?.({success: false, message: "Error injecting agent script into page" + toStartTaskStr});
        }
    }
}

async function sendEnterKeyPress(tabId: number): Promise<void> {
    //todo if/when adding support for press_sequentially for TYPE action, will want this helper method to flexibly
    // handle strings of other characters; in that case, want to do testing to see if windowsVirtualKeyCode is needed or
    // if text (and?/or? unmodifiedText) is enough (or something else)
    await chrome.debugger.attach({tabId: tabId}, "1.3");
    centralLogger.debug(`chrome.debugger attached to the tab ${tabId} to send an Enter key press`)
    //thanks to @activeliang https://github.com/ChromeDevTools/devtools-protocol/issues/45#issuecomment-850953391
    await chrome.debugger.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent", {
        "type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"
    });
    centralLogger.debug(`chrome.debugger sent key-down keyevent for Enter/CR key to tab ${tabId}`)
    await chrome.debugger.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent", {
        "type": "char", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"
    });
    centralLogger.debug(`chrome.debugger sent char keyevent for Enter/CR key to tab ${tabId}`)
    await chrome.debugger.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent", {
        "type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"
    });
    centralLogger.debug(`chrome.debugger sent keyup keyevent for Enter/CR key to tab ${tabId}`)
    await chrome.debugger.detach({tabId: tabId});
    centralLogger.debug(`chrome.debugger detached from the tab ${tabId} after sending an Enter key press`)
}


//todo jsdoc
async function startTask(request: any, sendResponse: (response?: any) => void) {
    if (taskId !== undefined) {
        const taskRejectMsg = `Task ${taskId} already in progress; not starting new task`;
        centralLogger.warn(taskRejectMsg);
        sendResponse({success: false, message: taskRejectMsg});
    } else {
        taskId = uuidV4();
        taskSpecification = request.taskSpecification;
        centralLogger.info(`STARTING TASK ${taskId} with specification: ${taskSpecification}`);
        try {
            await injectContentScript(true, sendResponse)
        } catch (error: any) {
            centralLogger.error(`error injecting content script to start task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            terminateTask();
            sendResponse({success: false, message: `Error injecting content script to start task: ${error}`});
        }
    }
}

/**
 * @description Handle messages sent from the content script or popup script
 * Cannot be in AgentController because a service worker's main listeners must be at the top level of the background
 * script, and we can't guarantee that, when a message arrives, the script-global variables like agentController will
 * be initialized
 * @param request the message sent from the content script or popup script
 * @param sender the sender of the message
 * @param sendResponse the function to call to send a response back to the sender
 * @return true to indicate to chrome that the requester's connection should be held open to wait for a response
 */
function handleMsgFromPage(request: any, sender: MessageSender, sendResponse: (response?: any) => void): boolean {
    if (request.reqType !== "log") {
        centralLogger.trace("request received by service worker", sender.tab ?
            "from a content script:" + sender.tab.url : "from the extension");
    }
    //todo enum for ephemeral messages' reqType values
    if (request.reqType === "log") {
        if (!centralLogger) {
            centralLogger = createNamedLogger('service-worker', true);
        }

        const timestamp = String(request.timestamp);
        const loggerName = String(request.loggerName);
        const level = request.level;
        const args = request.args as unknown[];
        assertIsValidLogLevelName(level);
        let consoleMethodNm: log.LogLevelNames = level;
        if (level === "trace") {
            consoleMethodNm = "debug";
        }
        console[consoleMethodNm](augmentLogMsg(timestamp, loggerName, level, args));
        sendResponse({success: true});
    } else if (request.reqType === "startTask") {
        //todo check whether agentController script global variable is initialized for this session; if not, initialize it
        // same check for logger
        mutex.runExclusive(async () => await startTask(request, sendResponse));
    } else if (request.reqType === "endTask") {
        //todo check whether agentController script global variable is initialized for this session; if not, throw error
        mutex.runExclusive(() => {
            if (taskId === undefined) {
                centralLogger.warn("No task in progress to end");
                sendResponse({success: false, message: "No task in progress to end"});
            } else {
                const terminatedTaskId = taskId;
                terminateTask();
                sendResponse({success: true, taskId: terminatedTaskId});
            }
        });
    } else if (request.reqType === "pressEnter") {
        //todo?? check whether agentController script global variable is initialized for this session; if not, throw error
        if (currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to press Enter for"});
        } else {
            sendEnterKeyPress(currTaskTabId).then(() => {
                sendResponse({success: true, message: "Sent Enter key press"});
            }, (error) => {
                centralLogger.error(`error sending Enter key press; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                sendResponse({success: false, message: `Error sending Enter key press: ${error}`});
            });
        }
    } else {
        centralLogger.error("unrecognized request type:", request.reqType);
    }
    return true;
}

chrome.runtime.onMessage.addListener(handleMsgFromPage);

function processPageActorInitialized(port: Port) {
    if (state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
        centralLogger.error("received 'content script initialized and ready' message from content script while not waiting for content script initialization, but rather in state " + AgentControllerState[state]);
        terminateTask();
        return;
    }
    centralLogger.trace("content script initialized and ready; requesting interactive elements")

    state = AgentControllerState.WAITING_FOR_ELEMENTS
    try {
        port.postMessage({msg: "get interactive elements"});
    } catch (error: any) {
        if ('message' in error && error.message === expectedMsgForPortDisconnection) {
            centralLogger.info("content script disconnected from service worker while processing initial message and before trying to request interactive elements; task will resume after new content script connection is established");
            state = AgentControllerState.PENDING_RECONNECT;
        } else {
            centralLogger.error(`unexpected error while processing initial message and before trying to request interactive elements; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            terminateTask();
        }
    }
}

//todo later, look for ways to break this up
// !! before sending to Prof Su!
async function processPageStateFromActor(message: any, port: Port) {
    if (state !== AgentControllerState.WAITING_FOR_ELEMENTS) {
        centralLogger.error("received 'sending interactive elements' message from content script while not waiting for elements, but rather in state " + AgentControllerState[state]);
        terminateTask();
        return;
    }
    centralLogger.trace("received interactive elements from content script")

    state = AgentControllerState.ACTIVE;
    const interactiveElements = message.interactiveElements as SerializableElementData[];

    const interactiveChoiceDetails = interactiveElements.map<StrTriple>((element) => {
        return [element.description, element.tagHead, element.tagName];
    });
    const candidateIds = interactiveElements.map((element, index) => {
        return (element.centerCoords[0] != 0 && element.centerCoords[1] != 0) ? index : undefined;
    }).filter(Boolean) as number[];//ts somehow too dumb to realize that filter(Boolean) removes undefined elements
    const interactiveChoices = formatChoices(interactiveChoiceDetails, candidateIds);
    //todo maybe also include the prior actions' success/failure in the prompt
    const prompts = generatePrompt(taskSpecification, actionsSoFar.map(entry => entry.actionDesc), interactiveChoices);
    centralLogger.debug("prompts:", prompts);
    //todo? try catch for error when trying to get screenshot, if that fails, then terminate task
    const screenshotDataUrl: string = await chrome.tabs.captureVisibleTab();
    centralLogger.debug("screenshot data url (truncated): " + screenshotDataUrl.slice(0, 100) + "...");
    let planningOutput: string;
    let groundingOutput: string;
    const aiApiBaseDelay = 1_000;
    try {
        planningOutput = await aiEngine.generateWithRetry(prompts, 0, screenshotDataUrl, undefined, undefined, undefined, undefined, aiApiBaseDelay);
        centralLogger.info("planning output: " + planningOutput);
        //todo add prompt details and logic here to skip element selection part of grounding step if the ai suggests a scroll, terminate, or press-enter-without-specific-element action
        // feedback- Boyuan thinks this is good idea

        groundingOutput = await aiEngine.generateWithRetry(prompts, 1, screenshotDataUrl, planningOutput, undefined, undefined, undefined, aiApiBaseDelay);
        //todo low priority per Boyuan, but experiment with json output mode specifically for the grounding api call
    } catch (error) {
        centralLogger.error(`error getting next step from ai; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
        terminateTask();
        return;
    }
    centralLogger.info("grounding output: " + groundingOutput);
    const [elementName, actionName, value] = postProcessActionLlm(groundingOutput);
    centralLogger.debug(`suggested action: ${actionName}; value: ${value}`);

    if (actionName === "TERMINATE") {
        centralLogger.info("Task completed!");
        terminateTask();
        return;
    } else if (actionName === "NONE") {
        //todo remove this temp hacky patch
        centralLogger.warn("ai selected NONE action, terminating task as dead-ended");
        terminateTask();
        return;
        //todo need to properly handle NONE actionName (which means the AI couldn't come up with a valid action)
        // not simply kill the task
        // maybe increase temperature on next api call? and/or add more to prompt
    }
    const actionNeedsNoElement = actionName === "SCROLL_UP" || actionName === "SCROLL_DOWN" || actionName === "PRESS_ENTER";

    let chosenCandidateIndex = getIndexFromOptionName(elementName);

    if ((!chosenCandidateIndex || chosenCandidateIndex > candidateIds.length) && !actionNeedsNoElement) {
        //todo remove this temp hacky patch
        centralLogger.warn(`ai selected invalid option ${elementName} ` + (chosenCandidateIndex
            ? `(was parsed as candidate index ${chosenCandidateIndex}, but the candidates list only had ${candidateIds.length} entries)`
            : `(cannot be parsed into an index)`) + ", terminating task as dead-ended");
        terminateTask();
        return;

        //todo increment noop counter
        //todo reprompt the ai??

    } else if (chosenCandidateIndex === candidateIds.length && !actionNeedsNoElement) {
        //todo remove this temp hacky patch
        centralLogger.warn("ai selected 'none of the above' option, terminating task as dead-ended");
        terminateTask();
        return;

        //todo increment noop counter
        //todo how to handle this?
    }
    if (chosenCandidateIndex && chosenCandidateIndex >= candidateIds.length && actionNeedsNoElement) {
        chosenCandidateIndex = undefined;
    }

    const chosenElementIndex: number | undefined = chosenCandidateIndex ? candidateIds[chosenCandidateIndex] : undefined;
    centralLogger.debug(`acting on the ${chosenCandidateIndex} entry from the candidates list; which is the ${chosenElementIndex} element of the original interactiveElements list`);

    tentativeActionInfo = {
        elementIndex: chosenElementIndex, action: actionName, value: value,
        elementData: chosenElementIndex ? interactiveElements[chosenElementIndex] : undefined
    };
    //todo add TYPE and SELECT here if I ever see or get reports of such actions causing page navigation
    mightNextActionCausePageNav = (actionName === "PRESS_ENTER" || actionName === "CLICK");

    state = AgentControllerState.WAITING_FOR_ACTION;
    try {
        port.postMessage({
            msg: "perform action", elementIndex: chosenElementIndex, action: actionName, value: value
        });
    } catch (error: any) {
        if ('message' in error && error.message === expectedMsgForPortDisconnection) {
            centralLogger.info("content script disconnected from service worker while processing interactive elements and before trying to request an action; task will resume after new content script connection is established");
            state = AgentControllerState.PENDING_RECONNECT;
            tentativeActionInfo = undefined;
        } else {
            centralLogger.error(`unexpected error while processing interactive elements and before trying to request an action; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            terminateTask();
        }
    }
}

async function processActionPerformedConfirmation(message: any, port: Port) {
    if (state !== AgentControllerState.WAITING_FOR_ACTION) {
        centralLogger.error("received 'action performed' message from content script while not waiting for action, but rather in state " + AgentControllerState[state]);
        terminateTask();
        return;
    }
    centralLogger.trace("controller notified that action was performed by content script");
    state = AgentControllerState.ACTIVE;

    const wasSuccessful: boolean = message.success;
    let actionDesc: string = message.result ? message.result :
        (tentativeActionInfo ?
                buildGenericActionDesc(tentativeActionInfo?.action, tentativeActionInfo?.elementData,
                    tentativeActionInfo?.value)
                : "no information stored about the action"
        );

    let wasPageNav = false;
    let tab: chrome.tabs.Tab | undefined;
    if (mightNextActionCausePageNav) {
        await sleep(500);//make sure that, if the browser is opening a new tab, there's time for browser to
        // make the new tab the active tab before we check for active tab change
        tab = await getActiveTabId();
        const tabId = tab.id;
        if (tabId !== currTaskTabId) {
            wasPageNav = true;
            actionDesc += `; opened ${tab.title} in new tab`;
        }
    }

    //todo keep track of number of unsuccessful operations
    // maybe terminate task after too many (total or in a row) unsuccessful operations
    // maaaybe also add more feedback or warnings to prompt after unsuccessful operation

    actionsSoFar.push({actionDesc: actionDesc, success: wasSuccessful});
    tentativeActionInfo = undefined;

    if (wasPageNav) {
        centralLogger.info("tab id changed after action was performed, so killing connection to " +
            "old tab and injecting content script in new tab " + tab?.title);
        killPageConnection(port);
        await injectContentScript(false, undefined, tab);
        //only resetting this after script injection because script injection needs to know whether it's ok
        // that the tab id might've changed
        mightNextActionCausePageNav = false;
    } else {
        mightNextActionCausePageNav = false;
        state = AgentControllerState.WAITING_FOR_ELEMENTS
        try {
            port.postMessage({msg: "get interactive elements"});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                centralLogger.info("content script disconnected from service worker while processing completed action and before trying to request more interactive elements; task will resume after new content script connection is established");
                state = AgentControllerState.PENDING_RECONNECT;
            } else {
                centralLogger.error(`unexpected error while processing completed action and before trying to request more interactive elements; terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                terminateTask();
            }
        }
    }
}

//todo jsdoc
async function handlePageMsgToAgentController(message: any, port: Port): Promise<void> {
    //todo enum for page actor to agent controller message types
    if (message.msg === "content script initialized and ready") {
        await mutex.runExclusive(() => {processPageActorInitialized(port);});
    } else if (message.msg === "sending interactive elements") {
        await mutex.runExclusive(async () => {await processPageStateFromActor(message, port);});
    } else if (message.msg === "action performed") {
        await mutex.runExclusive(async () => {await processActionPerformedConfirmation(message, port);});
    } else if (message.msg === "terminal page-side error") {
        await mutex.runExclusive(() => {
            centralLogger.error("something went horribly wrong in the content script, so terminating the task; details: ", message.error);
            terminateTask();
        });
    } else {
        centralLogger.warn("unknown message from content script:", message);
    }
}


async function processActorDisconnectDuringAction(): Promise<void> {
    if (!tentativeActionInfo) {
        centralLogger.error("service worker's connection to content script was lost while performing an " +
            "action, but no tentative action was stored; terminating current task");
        terminateTask();
        return;
    }
    state = AgentControllerState.ACTIVE;
    centralLogger.info("service worker's connection to content script was lost while performing an action, " +
        "which most likely means that the action has caused page navigation");
    if (mightNextActionCausePageNav) {
        //give the browser time to ensure that the new page is ready for scripts to be injected into it
        await sleep(500);
    }//todo consider whether there should be an else block here that logs a warning or even terminates task

    const tab = await getActiveTabId();
    if (tab.id !== currTaskTabId) {
        centralLogger.warn("tab changed after page navigation and yet the connection to the old tab's " +
            "content script was lost; this is unexpected")
    }
    const actionDesc = buildGenericActionDesc(tentativeActionInfo.action, tentativeActionInfo.elementData,
        tentativeActionInfo.value) + `; this caused page navigation to ${tab.title}`;

    actionsSoFar.push({actionDesc: actionDesc, success: true});
    tentativeActionInfo = undefined;

    await injectContentScript(false);
    //only resetting this after script injection because script injection needs to know whether it's ok that the
    // tab id might've changed
    mightNextActionCausePageNav = false;
}

//todo jsdoc
async function handlePageDisconnectFromAgentController(port: Port): Promise<void> {
    await mutex.runExclusive(async () => {
        centralLogger.debug("content script disconnected from service worker; port name:", port.name);
        currPortToContentScript = undefined;

        if (state === AgentControllerState.WAITING_FOR_ACTION) {
            await processActorDisconnectDuringAction();
        } else if (state === AgentControllerState.PENDING_RECONNECT) {
            centralLogger.info("service worker's connection to content script was lost partway through the controller's processing of some step; reestablishing connection")
            await injectContentScript(false);
        } else {
            centralLogger.error("service worker's connection to content script was lost while not waiting for action, " +
                "but rather in state " + AgentControllerState[state] + "; terminating current task " + taskSpecification);
            terminateTask();
            //todo Boyuan may eventually want recovery logic here for the user accidentally closing the tab or for the tab/page crashing
            // reloading or reopening the tab might require adding even more permissions to the manifest.json
        }
    });
}

//reminder- I think this shouldn't go in AgentController either
//todo jsdoc; this is for persistent connection that allows interaction between agent control loop in service worker
// and dom data-collection/actions in content script
function handleConnectionFromPage(port: Port): void {
    //todo if make port names unique (for each injected content script), change this to a "starts with" check
    if (port.name === "page-actor-2-agent-controller") {
        //todo check whether agentController script global variable is initialized for this session; if not, throw error

        mutex.runExclusive(() => {
            if (state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
                centralLogger.error("received connection from content script while not waiting for content script initialization, but rather in state " + AgentControllerState[state]);
                terminateTask();
                return;
            }
            centralLogger.trace("content script connected to agent controller in service worker");
            port.onMessage.addListener(handlePageMsgToAgentController);
            port.onDisconnect.addListener(handlePageDisconnectFromAgentController);
            currPortToContentScript = port;
        });
    } else {
        centralLogger.warn("unrecognized port name:", port.name);
    }
}

chrome.runtime.onConnect.addListener(handleConnectionFromPage);

function killPageConnection(pageConn: Port): void {
    try {
        pageConn.onDisconnect.removeListener(handlePageDisconnectFromAgentController);
        if (pageConn.onDisconnect.hasListeners()) {
            centralLogger.error("something went wrong when removing the onDisconnect listener for the port "
                + pageConn.name + "between service worker and content script. the onDisconnect event of that port " +
                "still has one or more listeners");
        }
        pageConn.disconnect();
        centralLogger.info(`successfully cleaned up content script connection ${pageConn.name}`);
    } catch (error: any) {
        if ('message' in error && error.message === expectedMsgForPortDisconnection) {
            centralLogger.info(`unable to clean up content script connection ${pageConn.name} because the connection to the content script was already closed`);
        } else {
            centralLogger.error(`unexpected error while cleaning up content script connection ${pageConn.name}; error: ${error}, jsonified: ${JSON.stringify(error)}`);
        }
    }
}


//todo jsdoc
//todo b4 release, make this take an error message param and make it show an alert so the user doesn't need to look
// at the extension's dev console to see why the actions stopped (if param null, alert would just say task completed)
function terminateTask(): void {
    centralLogger.info(`TERMINATING TASK ${taskId} which had specification: ${taskSpecification}; final state was ${AgentControllerState[state]}`);
    //most of the below will become simply a call to AgentController.reset()
    taskId = undefined;
    taskSpecification = "";
    currTaskTabId = undefined;
    state = AgentControllerState.IDLE;
    tentativeActionInfo = undefined;
    mightNextActionCausePageNav = false;
    actionsSoFar = [];
    if (currPortToContentScript) {
        centralLogger.info("terminating task while content script connection may still be open, attempting to close it")
        killPageConnection(currPortToContentScript);
        currPortToContentScript = undefined;
    }
    //todo if aiEngine ever has its own nontrivial bits of state, should probably somehow reset them here

    //todo if I use console.group elsewhere, should use console.groupEnd() here repeatedly (maybe 10 times) to be
    // completely certain that any nested groups get escaped when the task ends, even if things went really wrong with
    // exception handling and control flow expectations wrt group management
    // If groupEnd throws when there's no group to escape, use a try catch and the catch block would break the loop
}

/**
 * @description Get the id of the active tab in the current window
 * @returns {Promise<chrome.tabs.Tab>} The id of the active tab, or undefined if the active tab is a chrome:// URL
 *                                          (which scripts can't be injected into for safety reasons)
 * @throws {Error} If the active tab is not found or doesn't have an id
 */
const getActiveTabId = async (): Promise<chrome.tabs.Tab> => {
    let tabs;
    try {
        tabs = await chrome.tabs.query({active: true, currentWindow: true});
    } catch (error) {
        const errMsg = `error querying active tab; error: ${error}, jsonified: ${JSON.stringify(error)}`;
        centralLogger.error(errMsg);
        throw new Error(errMsg);
    }
    const tab: chrome.tabs.Tab | undefined = tabs[0];
    if (!tab) throw new Error('Active tab not found');
    const id = tab.id;
    if (!id) throw new Error('Active tab id not found');
    if (tab.url?.startsWith('chrome://')) {
        centralLogger.warn('Active tab is a chrome:// URL: ' + tab.url);
        tab.id = undefined;
    }
    return tab;
}
//todo unit test above helper? how hard is it to mock chrome api calls?
// worst case, could make ChromeHelper in utils/ with thing like DomWrapper for chrome api's, then unit test ChromeHelper
// with an injected mock of the chrome api wrapper object


//todo once basic prototype is fully working (i.e. can complete a full multi-step task),
// need to do negative e2e tests of user screwing with the system
// to ensure that the system can recover from such situations and then be useful again for future tasks
// without the user having to restart chrome or uninstall/reinstall the extension
// (e.g. user closes tab while agent is running, user navigates away from page while agent is running, etc.)
// or user inputs a new task and clicks the start button while the agent is still running the previous task




