import {
    assertIsValidLogLevelName,
    augmentLogMsg,
    createNamedLogger
} from "./utils/shared_logging_setup";
import {v4 as uuidV4} from 'uuid';
import {OpenAiEngine} from "./utils/OpenAiEngine";
import {SerializableElementData} from "./utils/BrowserHelper";
import {formatChoices, generatePrompt, postProcessActionLlm, StrTriple} from "./utils/format_prompts";
import {getIndexFromOptionName} from "./utils/format_prompt_utils";
import MessageSender = chrome.runtime.MessageSender;
import Port = chrome.runtime.Port;
import {Mutex} from "async-mutex";


const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";

console.log("successfully loaded background script in browser");

//initially, unified/relatively-persistent logging is achieved simply by having content script and popup's js
// send messages to the background script, which will print to the console in the extension's devtools window
const centralLogger = createNamedLogger('service-worker', true);

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

let actionsSoFar: { actionDesc: string, success: boolean }[] = [];

let state: AgentControllerState = AgentControllerState.IDLE;

let currPortToContentScript: Port | undefined;

const modelName: string = "gpt-4-vision-preview";
//REMINDER- DO NOT COMMIT ANY NONTRIVIAL EDITS OF THE FOLLOWING LINE
const apiKey: string = "PLACEHOLDER";

const aiEngine = new OpenAiEngine(modelName, apiKey);

//todo jsdoc
async function injectContentScript(isStartOfTask: boolean, sendResponse?: (response?: any) => void) {
    let tabId: number | undefined;
    try {
        tabId = await getActiveTabId();
    } catch (error) {
        centralLogger.error(`error ${error} getting active tab id, cannot inject content script; full error object:`, JSON.stringify(error));
        terminateTask();
        sendResponse?.({
            success: false, message: `Can't get tab id because of error: ${error}, jsonified: ${JSON.stringify(error)}`
        });
    }
    if (!tabId) {
        centralLogger.error("Can't inject agent script into chrome:// URLs for security reasons; " + isStartOfTask ? "please only try to start the agent on a regular web page." : "please don't switch to a chrome:// URL while the agent is running");
        terminateTask();
        sendResponse?.({success: false, message: "Can't inject script in a chrome:// URL"});
    } else {
        const toStartTaskStr = isStartOfTask ? " to start a task" : "";

        if (isStartOfTask) {
            currTaskTabId = tabId;
        } else if (currTaskTabId !== tabId) {
            centralLogger.error("Can't inject agent script into a different tab than the one the task was started in");
            terminateTask();
            sendResponse?.({
                success: false, message: "Can't inject script in a different tab than the one the task was started in"
            });
            return;
        }
        centralLogger.trace("injecting agent script into page" + toStartTaskStr + "; in tab " + tabId);

        state = AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT;
        try {
            await chrome.scripting.executeScript({
                files: ['./src/page_interaction.js'],
                target: {tabId: tabId}
            });
            centralLogger.trace('agent script injected into page' + toStartTaskStr);
            sendResponse?.({success: true, taskId: taskId, message: "Started content script in current tab"});
        } catch (error) {
            centralLogger.error(`error injecting agent script into page${toStartTaskStr}; error: ${error}; jsonified error: ${JSON.stringify(error)}`);
            terminateTask();
            sendResponse?.({success: false, message: "Error injecting agent script into page" + toStartTaskStr});
        }
    }
}


/**
 * @description Handle messages sent from the content script or popup script
 * @param request the message sent from the content script or popup script
 * @param sender the sender of the message
 * @param sendResponse the function to call to send a response back to the sender
 * @return true to indicate to chrome that the requester's connection should be held open to wait for a response
 */
function handleMsgFromPage(request: any, sender: MessageSender, sendResponse: (response?: any) => void) {
    if (request.reqType !== "log") {
        centralLogger.trace("request received by service worker", sender.tab ?
            "from a content script:" + sender.tab.url : "from the extension");
    }
    if (request.reqType === "log") {
        const timestamp = String(request.timestamp);
        const loggerName = String(request.loggerName);
        const level = request.level;
        const args = request.args as unknown[];
        assertIsValidLogLevelName(level);

        console[level](augmentLogMsg(timestamp, loggerName, level, taskId, args));
        sendResponse({success: true});
    } else if (request.reqType === "startTask") {
        mutex.runExclusive(() => {
            if (taskId !== undefined) {
                const taskRejectMsg = `Task ${taskId} already in progress; not starting new task`;
                centralLogger.warn(taskRejectMsg);
                sendResponse({success: false, message: taskRejectMsg});
            } else {
                taskId = uuidV4();
                taskSpecification = request.taskSpecification;
                centralLogger.info(`STARTING TASK ${taskId} with specification: ${taskSpecification}`);
                injectContentScript(true, sendResponse).catch((error) => {
                    centralLogger.error(`error injecting content script to start task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
                    terminateTask();
                    sendResponse({success: false, message: "Error injecting content script to start task"});
                });
            }
        });
    } else if (request.reqType === "endTask") {
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
    } else {
        centralLogger.error("unrecognized request type:", request.reqType);
    }
    return true;
}//todo consider unit tests for the above

chrome.runtime.onMessage.addListener(handleMsgFromPage);

//todo jsdoc, and preferably also break this up into sub-methods
async function handlePageMsgToAgentController(message: any, port: Port): Promise<void> {
    if (message.msg === "content script initialized and ready") {
        await mutex.runExclusive(() => {
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
        });
    } else if (message.msg === "sending interactive elements") {
        await mutex.runExclusive(async () => {
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
            centralLogger.debug("screenshot data url (truncated): " + screenshotDataUrl.slice(0, 100));
            let planningOutput: string;
            let groundingOutput: string;
            const aiApiBaseDelay = 75_000;//todo eventually make this configurable (needs to be increased a lot for people with new/untested api keys)
            try {
                planningOutput = await aiEngine.generateWithRetry(prompts, 0, screenshotDataUrl, undefined, undefined, undefined, undefined, aiApiBaseDelay);
                centralLogger.info("planning output: " + planningOutput);
                //todo add prompt details and logic here to skip element selection part of grounding step if the ai suggests a scroll, terminate, or press-enter-without-specific-element action

                await new Promise(resolve => setTimeout(resolve, aiApiBaseDelay));//todo remove this temp hacky patch once my api key is no longer quite so acutely limited
                groundingOutput = await aiEngine.generateWithRetry(prompts, 1, screenshotDataUrl, planningOutput, undefined, undefined, undefined, aiApiBaseDelay);
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
            }

            const chosenCandidateIndex = getIndexFromOptionName(elementName);
            if (chosenCandidateIndex === candidateIds.length && actionName !== "SCROLL_UP"
                && actionName !== "SCROLL_DOWN") {
                //todo remove this temp hacky patch
                centralLogger.warn("ai selected 'none of the above' option, terminating task as dead-ended");
                terminateTask();
                return;

                //todo increment noop counter
                //todo how to handle this?
            } else if (chosenCandidateIndex > candidateIds.length) {
                //todo remove this temp hacky patch
                centralLogger.warn(`ai selected invalid option ${elementName} (corresponds to candidate index ${chosenCandidateIndex}, but the candidates list only had ${candidateIds.length} entries), terminating task as dead-ended`);
                terminateTask();
                return;

                //todo increment noop counter
                //todo reprompt the ai??
            }

            const chosenElementIndex = candidateIds[chosenCandidateIndex];
            centralLogger.debug(`acting on the ${chosenCandidateIndex} entry from the candidates list; which is the ${chosenElementIndex} element of the original interactiveElements list`);

            tentativeActionInfo = {
                elementIndex: chosenElementIndex, elementData: interactiveElements[chosenElementIndex],
                action: actionName, value: value
            };
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
        });
    } else if (message.msg === "action performed") {
        await mutex.runExclusive(() => {
            if (state !== AgentControllerState.WAITING_FOR_ACTION) {
                centralLogger.error("received 'action performed' message from content script while not waiting for action, but rather in state " + AgentControllerState[state]);
                terminateTask();
                return;
            }
            centralLogger.trace("controller notified that action was performed by content script");
            state = AgentControllerState.ACTIVE;

            const wasSuccessful: boolean = message.success;
            const actionDesc: string = message.result ? message.result : buildGenericActionDesc(tentativeActionInfo);

            actionsSoFar.push({actionDesc: actionDesc, success: wasSuccessful});
            tentativeActionInfo = undefined;

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
        });
    } else if (message.msg === "terminal page-side error") {
        await mutex.runExclusive(() => {
            centralLogger.error("something went horribly wrong in the content script, so terminating the task; details: ", message.error);
            terminateTask();
        });
    } else {
        centralLogger.warn("unknown message from content script:", message);
    }
}

//todo jsdoc
function buildGenericActionDesc(actionInfo?: ActionInfo): string {
    if (!actionInfo) {
        return "no information stored about the action";
    }
    const valueDesc = actionInfo.value ? ` with value: ${(actionInfo.value)}` : "";
    return `[${actionInfo.elementData?.tagHead}] ${actionInfo.elementData?.description} -> ${actionInfo.action}${valueDesc}`;
}


//todo jsdoc
async function handlePageDisconnectFromAgentController(port: Port) {
    await mutex.runExclusive(async () => {
        centralLogger.debug("content script disconnected from service worker; port name:", port.name);
        currPortToContentScript = undefined;

        if (state === AgentControllerState.WAITING_FOR_ACTION) {
            if (!tentativeActionInfo) {
                centralLogger.error("service worker's connection to content script was lost while performing an action, " +
                    "but no tentative action was stored; terminating current task");
                terminateTask();
                return;
            }
            state = AgentControllerState.ACTIVE;
            centralLogger.info("service worker's connection to content script was lost while performing an action, " +
                "which most likely means that the action has caused page navigation");

            const actionDesc = "Page navigation occurred from: " + buildGenericActionDesc(tentativeActionInfo);

            actionsSoFar.push({actionDesc: actionDesc, success: true});
            tentativeActionInfo = undefined;

            await injectContentScript(false);
        } else if (state === AgentControllerState.PENDING_RECONNECT) {
            centralLogger.info("service worker's connection to content script was lost partway through the controller's processing of some step; reestablishing connection")
            await injectContentScript(false);
        } else {
            centralLogger.error("service worker's connection to content script was lost while not waiting for action, " +
                "but rather in state " + AgentControllerState[state] + "; terminating current task " + taskSpecification);
            terminateTask();
            //todo Boyuan may eventually want recovery logic here for the user accidentally closing the tab or for the tab/page crashing
            //reloading or reopening the tab might require adding more permissions to the manifest.json
        }
    });
}

//todo jsdoc; this is for persistent connection that allows interaction between agent control loop in service worker
// and dom data-collection/actions in content script
function handleConnectionFromPage(port: Port) {
    if (port.name === "content-script-2-agent-controller") {
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


function terminateTask() {
    centralLogger.info(`TERMINATING TASK ${taskId} which had specification: ${taskSpecification}; final state was ${AgentControllerState[state]}`);
    taskId = undefined;
    taskSpecification = "";
    currTaskTabId = undefined;
    state = AgentControllerState.IDLE;
    tentativeActionInfo = undefined;
    actionsSoFar = [];
    if (currPortToContentScript) {
        centralLogger.info("terminating task while content script connection may still be open, attempting to close it")
        try {
            currPortToContentScript.onDisconnect.removeListener(handlePageDisconnectFromAgentController);
            currPortToContentScript.disconnect();
            centralLogger.info("successfully cleaned up connection to content script as part of terminating task");
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                centralLogger.info("unable to clean up content script while terminating task because the connection to the content script was already closed");
            } else {
                centralLogger.error(`unexpected error while cleaning up content script as part of terminating task; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }
        currPortToContentScript = undefined;
    }
    //todo before release, the end of this method should create an alert popup so user is informed about task failure
    // even if they don't have extension's dev console open
}

/**
 * @description Get the id of the active tab in the current window
 * @returns {Promise<number|undefined>} The id of the active tab, or undefined if the active tab is a chrome:// URL
 *                                          (which scripts can't be injected into for safety reasons)
 * @throws {Error} If the active tab is not found or doesn't have an id
 */
const getActiveTabId = async (): Promise<number | undefined> => {
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
    let id = tab.id;
    if (!id) throw new Error('Active tab id not found');
    if (tab.url?.startsWith('chrome://')) {
        centralLogger.warn('Active tab is a chrome:// URL: ' + tab.url);
        id = undefined;
    }
    return id;
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




