import {assertIsValidLogLevelName, augmentLogMsg, createNamedLogger} from "./utils/shared_logging_setup";
import {OpenAiEngine} from "./utils/OpenAiEngine";
import log from "loglevel";
import Port = chrome.runtime.Port;
import MessageSender = chrome.runtime.MessageSender;
import {AgentController, AgentControllerState} from "./utils/AgentController";
import {PageRequestType} from "./utils/misc";


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


//eventually allow other api's/model-providers
const modelName: string = "gpt-4-turbo";
//REMINDER - DO NOT COMMIT ANY NONTRIVIAL EDITS OF THE FOLLOWING LINE
const apiKey: string = "PLACEHOLDER";

let aiEngine: OpenAiEngine | undefined = new OpenAiEngine(modelName, apiKey);
let agentController: AgentController | undefined = new AgentController(aiEngine);


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
    if (request.reqType !== PageRequestType.LOG) {
        centralLogger.trace("request received by service worker", sender.tab ?
            "from a content script:" + sender.tab.url : "from the extension");
    }
    if (request.reqType === PageRequestType.LOG) {
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
    } else if (request.reqType === PageRequestType.START_TASK) {
        if (!agentController) {
            aiEngine = new OpenAiEngine(modelName, apiKey);
            agentController = new AgentController(aiEngine);
        }
        if (!centralLogger) {centralLogger = createNamedLogger('service-worker', true);}
        agentController.mutex.runExclusive(async () => await agentController?.startTask(request, sendResponse));
    } else if (request.reqType === PageRequestType.END_TASK) {
        if (!agentController) {
            sendResponse({
                success: false,
                message: "Agent controller is not initialized; please do not press 'Terminate Task' unless there is an ongoing task "
            });
        } else {
            agentController.mutex.runExclusive(() => {
                if (agentController?.taskId === undefined) {
                    centralLogger.warn("No task in progress to end");
                    sendResponse({success: false, message: "No task in progress to end"});
                } else {
                    const terminatedTaskId = agentController.taskId;
                    agentController.terminateTask();
                    sendResponse({success: true, taskId: terminatedTaskId});
                }
            });
        }
    } else if (request.reqType === PageRequestType.PRESS_ENTER) {
        if (!agentController) {
            sendResponse({success: false, message: "Cannot press enter when agent controller is not initialized"});
        } else if (agentController.currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to press Enter for"});
        } else {
            agentController.sendEnterKeyPress(agentController.currTaskTabId).then(() => {
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


/**
 * @description Handle a connection being opened from a content script (page actor) to the agent controller in the
 * service worker
 * Cannot be in AgentController because a service worker's main listeners must be at the top level of the background
 * script, and we can't guarantee that, when a message arrives, the script-global variables like agentController will
 * be initialized
 * @param port the new connection opened from the content script
 */
function handleConnectionFromPage(port: Port): void {
    if (!centralLogger) { centralLogger = createNamedLogger("service-worker", true)}
    //todo if make port names unique (for each injected content script), change this to a "starts with" check
    if (port.name === "page-actor-2-agent-controller") {
        if (!agentController) {
            throw new Error(`agentController not initialized when page actor ${port.name} tried to connect to agent controller in service worker`);
        }
        agentController.mutex.runExclusive(() => {
            if (agentController?.state !== AgentControllerState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
                centralLogger.error("received connection from content script while not waiting for content script initialization, but rather in state " + AgentControllerState[agentController!.state]);
                agentController?.terminateTask();
                return;
            }
            centralLogger.trace("content script connected to agent controller in service worker");
            port.onMessage.addListener(agentController.handlePageMsgToAgentController);
            port.onDisconnect.addListener(agentController.handlePageDisconnectFromAgentController);
            agentController.currPortToContentScript = port;
        });
    } else {
        centralLogger.warn("unrecognized port name:", port.name);
    }
}

chrome.runtime.onConnect.addListener(handleConnectionFromPage);


//todo once basic prototype is fully working (i.e. can complete a full multi-step task),
// need to do negative e2e tests of user screwing with the system
// to ensure that the system can recover from such situations and then be useful again for future tasks
// without the user having to restart chrome or uninstall/reinstall the extension
// (e.g. user closes tab while agent is running, user navigates away from page while agent is running, etc.)
// or user inputs a new task and clicks the start button while the agent is still running the previous task




