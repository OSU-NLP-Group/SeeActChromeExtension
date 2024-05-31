import {assertIsValidLogLevelName, augmentLogMsg, createNamedLogger} from "./utils/shared_logging_setup";
import {OpenAiEngine} from "./utils/OpenAiEngine";
import log from "loglevel";
import Port = chrome.runtime.Port;
import MessageSender = chrome.runtime.MessageSender;
import {AgentController} from "./utils/AgentController";
import {PageRequestType, pageToControllerPort, panelToControllerPort, renderUnknownValue} from "./utils/misc";


console.log("successfully loaded background script in browser");

//initially, unified/relatively-persistent logging is achieved simply by having content script and popup's js
// send messages to the background script, which will print to the console in the extension's devtools window
let centralLogger = createNamedLogger('service-worker', true);

centralLogger.trace("central logger created in background script");

chrome.sidePanel
    .setPanelBehavior({openPanelOnActionClick: true})
    .catch((error) => console.error(error));


//todo? later add indexeddb logging via the background script, i.e. the part of the message listener which handles
// 'log'-type requests will write them to db rather than solely the extension's console
// if this is done, it will require changes to how loggers are created for code that's running in the service worker
const LOGS_OBJECT_STORE = "logs";

centralLogger.warn("about to try to set up onInstalled listener in background script");
console.error("basic- about to try to set up onInstalled listener in background script");
chrome.runtime.onInstalled.addListener(function (details) {
    console.error("basic- starting of 'onInstalled' handler being executed in background script")
    centralLogger.warn("start of 'onInstalled' handler being executed in background script");
    if (details.reason == "install") {
        centralLogger.warn("This is a first install! checking keyboard shortcuts and initializing database for logging");

        checkCommandShortcutsOnInstall();



        centralLogger.warn("This is a first install! initializing indexeddb for logging");


        const openRequest: IDBOpenDBRequest = indexedDB.open("Browser_LLM_Agent_Logging", 1);

        openRequest.onupgradeneeded = function (e: IDBVersionChangeEvent) {
            const db = (e.target as IDBOpenDBRequest).result;
            centralLogger.warn("handling upgrade of logging db during initial install of extension");
            if (!db.objectStoreNames.contains(LOGS_OBJECT_STORE)) {
                centralLogger.warn("creating object store for logs during initial install of extension");
                db.createObjectStore(LOGS_OBJECT_STORE, {autoIncrement: true});
            }
        };
        openRequest.onsuccess = function (e) {
            centralLogger.warn("logging db successfully opened during initial install of extension");
            const db = (e.target as IDBOpenDBRequest).result;
            db.close();
            centralLogger.warn("logging db successfully closed after creating/opening during initial install of extension");
        };
        openRequest.onerror = function (e) {
            // Handle errors
            centralLogger.error("failure during opening of logging db during initial install of extension!");
            console.dir(e);
            //todo maybe do something here like with the missing shortcuts
        };
    }
});

function populateInstallPageWarnings(warnings: string[]) {
    const warningList = document.getElementById("install-warnings");
    if (warningList) {
        for (const warning of warnings) {
            const li = document.createElement("li");
            li.textContent = warning;
            warningList.appendChild(li);
        }
    } else {
        console.error("unable to find warning list element in installation greeting page for alerting the user about the following: \n", warnings.join("\n"));
    }
}

function checkCommandShortcutsOnInstall() {
    centralLogger.warn("starting to check command shortcuts on install");
    chrome.commands.getAll((commands) => {
        centralLogger.warn("query for chrome commands completed, analyzing results");
        const missingShortcuts: string[] = [];

        for (const {name, shortcut, description} of commands) {
            if (shortcut === '') {
                if (name === undefined) {
                    centralLogger.error(`a chrome extension command's name is undefined (description: ${description})`);
                } else {missingShortcuts.push(`Shortcut name: ${name}; description: ${description}`);}
            }
        }

        //todo confirm that the below works (e.g. temporarily tweak manifest so that it uses alt-shift-L)
        // why didn't this work with alt-shift-k? need to add tracing messages and/or comb over the logs for this warning message
        //  in any case, the greeting page thing didn't work (does that generally not work when loading unpacked extension??)
        if (missingShortcuts.length > 0) {
            //todo try using notifications if I can't see console messages from background script's install invocation
            // https://developer.chrome.com/docs/extensions/reference/api/notifications
            centralLogger.error("the following commands are missing keyboard shortcuts:", missingShortcuts.join("\n"));
            missingShortcuts.unshift("The following commands are missing keyboard shortcuts:");
            chrome.tabs.create({url: "src/installation_greeting.html"}, (tab) => {
                if (tab.id === undefined) {
                    centralLogger.error("unable to get tab id after creating tab for installation greeting page");
                    return;
                }
                chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    world: 'MAIN',
                    func: populateInstallPageWarnings,
                    args: [missingShortcuts]
                }).catch((error) => {
                    centralLogger.error("error populating installation greeting page with missing shortcuts info:", renderUnknownValue(error));
                });
            });
        }
    });
}

//todo before official release, if indexeddb persistent logging was implemented, make mechanism to trigger
// once every 14 days and purge logs older than 14 days from the extension's indexeddb

//todo experiment with console.group() and console.groupEnd() at start and end of code blocks which contain a bunch of
// logging statements, to make the console log easier to parse
//  Only do this at the start of a try catch, and do console.groupEnd() in a finally
//  ?Or in a very simple case where no methods are being called that might throw something between the group() call and the groupEnd() call? risks someone missing this and adding risky statements within the group's scope later :(

//todo semi-relatedly, look out for cases where console.dir() could be used for examining objects with complex internal state when there's a problem, e.g. html elements

// if microsecond precision timestamps are needed for logging, can use this (only ~5usec precision, but still better than 1msec precision)
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now


//eventually allow other api's/model-providers? depends on how much we rely on audio modality of gpt-4o and how quickly others catch up there
const modelName: string = "gpt-4o-2024-05-13";

const apiKeyQuery = await chrome.storage.local.get("openAiApiKey");
const apiKey: string = apiKeyQuery.openAiApiKey ?? "PLACEHOLDER_API_KEY";


function initializeAgentController(): AgentController {
    const aiEngine: OpenAiEngine = new OpenAiEngine(modelName, apiKey);
    return new AgentController(aiEngine);
}

let agentController: AgentController | undefined = initializeAgentController();


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
            `from a content script:${sender.tab.url}` : "from the extension");
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
        const finalLogMsg = augmentLogMsg(timestamp, loggerName, level, args);
        console[consoleMethodNm](finalLogMsg);
        //todo also interact with indexeddb
        sendResponse({success: true});
    } else if (request.reqType === PageRequestType.PRESS_ENTER) {
        if (!agentController) {
            sendResponse({success: false, message: "Cannot press enter when agent controller is not initialized"});
        } else if (agentController.currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to press Enter for"});
        } else {
            agentController.sendEnterKeyPress(agentController.currTaskTabId).then(() => {
                sendResponse({success: true, message: "Sent Enter key press"});
            }, (error) => {
                const errMsg = `error sending Enter key press; error: ${renderUnknownValue(error)}`;
                centralLogger.error(errMsg);
                sendResponse({success: false, message: errMsg});
            });
        }
    } else if (request.reqType === PageRequestType.HOVER) {
        if (!agentController) {
            sendResponse({success: false, message: "Cannot hover when agent controller is not initialized"});
        } else if (agentController.currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to hover in"});
        } else {
            agentController.hoverOnElem(agentController.currTaskTabId, request.x, request.y).then(() => {
                sendResponse({success: true, message: `Hovered over element at ${request.x}, ${request.y}`});
            }, (error) => {
                const errMsg = `error performing mouse hover; error: ${renderUnknownValue(error)}`;
                centralLogger.error(errMsg);
                sendResponse({success: false, message: errMsg});
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
    if (port.name === pageToControllerPort) {
        if (!agentController) {
            centralLogger.error(`agentController not initialized when page actor ${port.name} tried to connect to agent controller in service worker`);
            return;
        }
        agentController.addPageConnection(port).then(
            () => centralLogger.trace("page actor connected to agent controller in service worker"));
    } else if (port.name === panelToControllerPort) {
        if (!agentController) {
            agentController = initializeAgentController();
        }
        agentController.addSidePanelConnection(port).then(
            () => centralLogger.trace("side panel connected to agent controller in service worker"));
    } else {
        centralLogger.warn("unrecognized port name:", port.name);
    }
}

chrome.runtime.onConnect.addListener(handleConnectionFromPage);

function handleKeyCommand(command: string, tab: chrome.tabs.Tab): void {
    if (command === "monitor_approve") {
        if (!agentController) {
            centralLogger.warn(`agentController not initialized when user tried to press the monitor-mode approve key command from tab: ${JSON.stringify(tab)}`);
            return;
        }
        agentController.processMonitorApproveKeyCommand().then(() => {
            centralLogger.trace("monitor mode approval key command was successfully processed")
        }, (error) => {
            centralLogger.error(`error processing monitor-mode approval key command: ${renderUnknownValue(error)}`);
        });
    } else if (command === "monitor_reject") {
        if (!agentController) {
            centralLogger.warn(`agentController not initialized when user tried to press the monitor-mode reject key command from tab: ${JSON.stringify(tab)}`);
            return;
        }
        agentController.processMonitorRejectKeyCommand().then(() => {
            centralLogger.trace("monitor mode rejection key command was successfully processed")
        }, (error) => {
            centralLogger.error(`error processing monitor-mode rejection key command: ${renderUnknownValue(error)}`);
        });
    } else {
        centralLogger.error(`unrecognized key command: ${command} from tab: ${JSON.stringify(tab)}`);
    }
}

chrome.commands.onCommand.addListener(handleKeyCommand);



