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
    .catch((error) => centralLogger.error(error));


//todo? later add indexeddb logging via the background script, i.e. the part of the message listener which handles
// 'log'-type requests will write them to db rather than solely the extension's console
// if this is done, it will require changes to how loggers are created for code that's running in the service worker
const LOGS_OBJECT_STORE = "logs";

//Also, it uses error rather than debug/info/warn because the devtools window/console won't/can't be open when the installation is first happening, so
// the only way to see those log messages is to look at the "Errors" view for the extension in chrome://extensions
// right after the install/update and then clear them from the "Errors" view.
// todo comment out those error() calls (that are actually for info/debug-level messages) before official release
//  Maybe, once db log persistence is working, this will no longer even be necessary for the messages which occur after db has been set up?
//   that might be overly-optimistic, db initialization seems weird/non-promise based, so can't simply await for db to be ready before using db-persistent logging for rest of onInstalled activity
//    However, https://web.dev/articles/indexeddb#open indicates you can open an indexeddb database in a promise-based way
chrome.runtime.onInstalled.addListener(async function (details) {
    centralLogger.info("starting of 'onInstalled' handler being executed in background script");

    if (details.reason == "install") {
        centralLogger.info("This is a first install! initializing indexeddb for logging");

        const openRequest: IDBOpenDBRequest = indexedDB.open("Browser_LMM_Agent_Logging", 1);

        openRequest.onupgradeneeded = function (event: IDBVersionChangeEvent) {
            const db = (event.target as IDBOpenDBRequest).result;
            centralLogger.info("handling upgrade of logging db during initial install of extension");
            if (!db.objectStoreNames.contains(LOGS_OBJECT_STORE)) {
                centralLogger.info("creating object store for logs during initial install of extension");
                db.createObjectStore(LOGS_OBJECT_STORE, {autoIncrement: true});
            }
        };
        openRequest.onsuccess = function (event) {
            centralLogger.info("logging db successfully opened during initial install of extension");
            const db = (event.target as IDBOpenDBRequest).result;
            db.close();
            centralLogger.info("logging db successfully closed after creating/opening during initial install of extension");
        };
        openRequest.onerror = function (event) {
            // Handle errors
            centralLogger.error("failure during opening of logging db during initial install of extension!");
            console.dir(event);
            //todo maybe do something here like with the missing shortcuts
        };

        centralLogger.info("This is a first install! checking keyboard shortcuts and initializing database for logging");

        checkCommandShortcutsOnInstall();
    } else if (details.reason === "update") {
        centralLogger.warn(`chrome.runtime.onInstalled listener fired for "update" reason`);
        //todo what would be needed here?
    } else {
        centralLogger.error("chrome.runtime.onInstalled listener fired with unexpected reason ", details.reason);
    }
});

function checkCommandShortcutsOnInstall() {
    centralLogger.info("starting to check command shortcuts on install");
    chrome.commands.getAll(async (commands) => {
        centralLogger.info("query for chrome commands completed, analyzing results");
        const missingShortcuts: string[] = [];

        for (const {name, shortcut, description} of commands) {
            if (shortcut === '') {
                if (name === undefined) {
                    centralLogger.error(`a chrome extension command's name is undefined (description: ${description})`);
                } else if (name === "_execute_action") {
                    centralLogger.info("as intended, the _execute_action command has no keyboard shortcut");
                } else {missingShortcuts.push(`Shortcut name: ${name}; description: ${description}`);}
            }
        }

        if (missingShortcuts.length > 0) {
            centralLogger.error("the following commands are missing keyboard shortcuts:", missingShortcuts.join("\n"));
            missingShortcuts.unshift("The following commands are missing keyboard shortcuts:");

            const greetingUrlSearchParams = new URLSearchParams({
                warnings: JSON.stringify(missingShortcuts)
            });
            const greetingUrl = chrome.runtime.getURL("src/installation_greeting.html") + "?" + greetingUrlSearchParams.toString();

            chrome.tabs.create({url: greetingUrl}, (tab) => {
                if (chrome.runtime.lastError) {
                    centralLogger.error("error opening installation greeting page:", chrome.runtime.lastError);
                } else {
                    centralLogger.info("opened installation greeting page in tab:", tab);
                }
            });
        }
    });
}

//todo before official release, if indexeddb persistent logging was implemented, make mechanism to trigger
// once every 14 days and purge logs older than 14 days from the extension's indexeddb
// option 1) get day-of-year, then wipe logs older than 14 days if day-of-year is divisible by 14?
// option 2) when install (or when wipe old logs), store the current date in chrome.local.storage; then, when background starts up,
//  check if the current date is at least 14 days after the stored date, and if so, wipe old logs and update the stored date

//todo experiment with console.group() and console.groupEnd() at start and end of code blocks which contain a bunch of
// logging statements, to make the console log easier to parse
//  Only do this at the start of a try catch, and do console.groupEnd() in a finally
//  ?Or in a very simple case where no methods are being called that might throw something between the group() call and the groupEnd() call? risks someone missing this and adding risky statements within the group's scope later :(

//todo semi-relatedly, look out for cases where console.dir() could be used for examining objects with complex internal state when there's a problem, e.g. html elements

// if microsecond precision timestamps are needed for logging, can use this (only ~5usec precision, but still better than 1msec precision)
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now


//eventually allow other api's/model-providers? depends on how much we rely on audio modality of gpt-4o and how quickly others catch up there
const modelName: string = "gpt-4o-2024-05-13";


//todo need to e2e test whether getting rid of top-level await causes problems
async function initializeAgentController(): Promise<AgentController> {
    const apiKeyQuery = await chrome.storage.local.get("openAiApiKey");
    const apiKey: string = apiKeyQuery.openAiApiKey ?? "PLACEHOLDER_API_KEY";
    const aiEngine: OpenAiEngine = new OpenAiEngine(modelName, apiKey);
    return new AgentController(aiEngine);
}

let agentController: AgentController | undefined;
// let controllerIsInitializing = false; todo remove this chunk of commented-out code if not needed in practice
// if this immediate initialization is kept, might want to rewrite this so a promise is stored by the async initializer method, then the promise can be awaited by the side panel connection-establishment handler
//  then the initializeAgentController() method would have the side effect of setting the agentController variable instead of returning an AgentController?
// (async () => {
//     controllerIsInitializing = true;
//     agentController = await initializeAgentController();
//     controllerIsInitializing = false;
// })().then(() => {
//     console.trace("agent controller initialized")
//     }, (error) => {
//     console.error("problem when initializing agent controller:", renderUnknownValue(error));
//     }
// );



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
async function handleConnectionFromPage(port: Port): Promise<void> {
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
            // if (controllerIsInitializing) { todo remove this chunk of commented-out code if not needed in practice
            // todo do what? sleep and then check the boolean again, in a loop with maximum number of iterations?
            //  see comments above about how this could use await if I revised the lazy initialization code
            // } else {
            agentController = await initializeAgentController();
            //}
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



