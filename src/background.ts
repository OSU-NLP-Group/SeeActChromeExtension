import {
    AgentDb,
    assertIsValidLogLevelName,
    augmentLogMsg,
    createNamedLogger,
    DB_NAME,
    dbConnHolder,
    initializeDbConnection,
    LogMessage,
    LOGS_OBJECT_STORE,
    logsNotYetSavedToDb,
    mislaidLogsQueueMutex,
    saveLogMsgToDb,
    SCREENSHOTS_OBJECT_STORE,
} from "./utils/shared_logging_setup";

import log from "loglevel";
import {AgentController, AgentControllerState} from "./utils/AgentController";
import {renderUnknownValue, sleep, storageKeyForEulaAcceptance} from "./utils/misc";
import {openDB} from "idb";
import {AiEngine} from "./utils/AiEngine";
import {createSelectedAiEngine} from "./utils/ai_misc";
import {ActionAnnotationCoordinator} from "./utils/ActionAnnotationCoordinator";
import {Mutex} from "async-mutex";
import {ServiceWorkerHelper} from "./utils/ServiceWorkerHelper";
import {
    PageRequestType,
    pageToAnnotationCoordinatorPort,
    pageToControllerPort,
    panelToAnnotationCoordinatorPort,
    panelToControllerPort
} from "./utils/messaging_defs";
import Port = chrome.runtime.Port;
import MessageSender = chrome.runtime.MessageSender;
import {getBuildConfig} from "./utils/build_config";


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

const serviceWorkerStateMutex = new Mutex();

console.log("successfully loaded background script in browser");

//initially, unified/relatively-persistent logging is achieved simply by having content script and popup's js
// send messages to the background script, which will print to the console in the extension's devtools window
let centralLogger = createNamedLogger('service-worker', true);
centralLogger.trace("central logger created in background script");

chrome.sidePanel
    .setPanelBehavior({openPanelOnActionClick: true})
    .catch((error) => centralLogger.error(error));

let isOnInstalledRunning = false;
chrome.runtime.onInstalled.addListener(async function (details) {
    isOnInstalledRunning = true;
    centralLogger.info("starting of 'onInstalled' handler being executed in background script");

    if (details.reason == "install") {
        centralLogger.info("This is a first install! initializing indexeddb for logging");
        const initErrMsgs: string[] = [];

        try {
            getBuildConfig();
        } catch (error: any) {
            initErrMsgs.push(`build-time configs were not correctly stored in the bundle's source code by webpack: ${renderUnknownValue(error)}`);
        }

        try {
            dbConnHolder.dbConn = await openDB<AgentDb>(DB_NAME, 1, {
                upgrade(db) {
                    centralLogger.info(`during initial install of extension, db ${DB_NAME} has object stores: ${JSON.stringify(db.objectStoreNames)}`);
                    if (!db.objectStoreNames.contains(LOGS_OBJECT_STORE)) {
                        centralLogger.info("creating object store for logs during initial install of extension");
                        const logsObjStore = db.createObjectStore(LOGS_OBJECT_STORE,
                            {keyPath: "key", autoIncrement: true});
                        logsObjStore.createIndex("by-ts", "timestamp", {unique: false});
                        logsObjStore.createIndex("by-task", "taskId", {unique: false});
                    }
                    if (!db.objectStoreNames.contains(SCREENSHOTS_OBJECT_STORE)) {
                        centralLogger.info("creating object store for screenshots during initial install of extension");
                        const screenshotsObjStore = db.createObjectStore(SCREENSHOTS_OBJECT_STORE,
                            {keyPath: "screenshotId"});
                        screenshotsObjStore.createIndex("by-ts", "timestamp", {unique: false});
                        screenshotsObjStore.createIndex("by-task", "taskId", {unique: false});
                    }
                }
            });
            dbConnHolder.dbConn.onerror = (event) => {
                console.error("error occurred on db connection", event);
            }
        } catch (error: any) {
            const dbInitErrMsg = `error occurred during initialization of indexeddb for logging: ${renderUnknownValue(error)}`;
            console.error(dbInitErrMsg);
            initErrMsgs.push(dbInitErrMsg);
            initErrMsgs.push("--------------");
        }

        chrome.storage.local.set({[storageKeyForEulaAcceptance]: false}, () => {
            if (chrome.runtime.lastError) {
                centralLogger.error("error setting eulaAccepted to false in local storage on install:", chrome.runtime.lastError);
            } else {centralLogger.info("set eulaAccepted to false in local storage on install");}
        });

        centralLogger.info("This is a first install! checking keyboard shortcuts");
        await checkCommandShortcutsOnInstall(initErrMsgs);

        const greetingUrlSearchParams = new URLSearchParams({});
        if (initErrMsgs.length > 0) {
            greetingUrlSearchParams.set("warnings", JSON.stringify(initErrMsgs));
        }
        const greetingUrl = chrome.runtime.getURL("src/installation_greeting.html") + "?" + greetingUrlSearchParams.toString();

        chrome.tabs.create({url: greetingUrl}, (tab) => {
            if (chrome.runtime.lastError) {
                centralLogger.error("error opening installation greeting page:", chrome.runtime.lastError);
            } else {
                centralLogger.info("opened installation greeting page in tab:", JSON.stringify(tab));
            }
        });
    } else if (details.reason === "update") {
        centralLogger.info(`chrome.runtime.onInstalled listener fired for "update" reason`);
        //todo what would be needed here?
    } else if (details.reason === "chrome_update") {
        centralLogger.info(`chrome.runtime.onInstalled listener fired for "chrome_update" reason`);
        //todo what would be needed here?
    } else {
        centralLogger.error("chrome.runtime.onInstalled listener fired with unexpected reason ", details.reason);
    }
    isOnInstalledRunning = false;
});

async function checkCommandShortcutsOnInstall(initErrorMessages: string[]) {
    centralLogger.info("starting to check command shortcuts on install");
    const commands = await chrome.commands.getAll();
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

        initErrorMessages.push(...missingShortcuts)
        initErrorMessages.push("--------------");
    }
}

chrome.runtime.onSuspend.addListener(() => {
    if (dbConnHolder.dbConn) {
        dbConnHolder.dbConn.close();
    }
});


//todo experiment with console.group() and console.groupEnd() at start and end of code blocks which contain a bunch of
// logging statements, to make the console log easier to parse
//  Only do this at the start of a try catch, and do console.groupEnd() in a finally
//  ?Or in a very simple case where no methods are being called that might throw something between the group() call and the groupEnd() call? risks someone missing this and adding risky statements within the group's scope later :(

//todo semi-relatedly, look out for cases where console.dir() could be used for examining objects with complex internal state when there's a problem, e.g. html elements

// if microsecond precision timestamps are needed for logging, can use this (only ~5usec precision, but still better than 1msec precision)
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now

//sleep for 20ms to give time for onInstalled listener to start running (and set the flag)
sleep(20).then(() => {
    if (!isOnInstalledRunning && !dbConnHolder.dbConn) {
        initializeDbConnection().then(() => {
            console.debug("db connection initialized in background script");
        }, (error) => {
            console.error("error initializing db connection in background script:", renderUnknownValue(error));
        });
    }
});

async function initializeAgentController(): Promise<AgentController> {
    const aiEngine: AiEngine = await createSelectedAiEngine();
    return new AgentController(aiEngine);
}

let agentController: AgentController | undefined;
const serviceWorkerHelper = new ServiceWorkerHelper()
const actionAnnotationCoordinator: ActionAnnotationCoordinator = new ActionAnnotationCoordinator();

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
    if (!centralLogger) {
        centralLogger = createNamedLogger('service-worker', true);
    }
    if (request.reqType !== PageRequestType.LOG) {
        centralLogger.trace("request received by service worker", sender.tab ?
            `from a content script:${sender.tab.url}` : "from the extension");
    }
    if (request.reqType === PageRequestType.LOG) {

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
        saveLogMsgToDb(timestamp, loggerName, level, args);
        sendResponse({success: true});
    } else if (request.reqType === PageRequestType.PRESS_ENTER) {
        if (!agentController) {
            sendResponse({success: false, message: "Cannot press enter when agent controller is not initialized"});
        } else if (agentController.currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to press Enter for"});
        } else {
            serviceWorkerHelper.sendEnterKeyPress(agentController.currTaskTabId).then(() => {
                sendResponse({success: true, message: "Sent Enter key press"});
            }, (error) => {
                const errMsg = `error sending Enter key press; error: ${renderUnknownValue(error)}`;
                centralLogger.error(errMsg);
                sendResponse({success: false, message: errMsg});
            });
        }
    } else if (request.reqType === PageRequestType.TYPE_SEQUENTIALLY) {
        const text: unknown = request.textToType
        if (!agentController) {
            sendResponse(
                {success: false, message: "Cannot type sequentially when agent controller is not initialized"});
        } else if (agentController.currTaskTabId === undefined) {
            sendResponse({success: false, message: "No active tab to type sequentially into"});
        } else if (typeof text !== "string") {
            const errMsg = `Cannot type sequentially with invalid text input ${renderUnknownValue(text)}`;
            centralLogger.error(errMsg);
            sendResponse({success: false, message: errMsg});
        } else {
            serviceWorkerHelper.typeSequentially(agentController.currTaskTabId, text).then(() => {
                sendResponse({success: true, message: `Typed ${text} sequentially`});
            }, (error) => {
                const errMsg = `error typing ${text} sequentially; error: ${renderUnknownValue(error)}`;
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
            serviceWorkerHelper.hoverOnElem(agentController.currTaskTabId, request.x, request.y).then(() => {
                sendResponse({success: true, message: `Hovered over element at ${request.x}, ${request.y}`});
            }, (error) => {
                const errMsg = `error performing mouse hover; error: ${renderUnknownValue(error)}`;
                centralLogger.error(errMsg);
                sendResponse({success: false, message: errMsg});
            });
        }
    } else if (request.reqType === PageRequestType.SCREENSHOT_WITH_TARGET_HIGHLIGHTED) {
        if (!agentController) {
            sendResponse({
                success: false,
                message: "Cannot take screenshot of highlighted element when agent controller is not initialized"
            });
        } else {
            if (agentController.state === AgentControllerState.WAITING_FOR_ACTION) {
                centralLogger.warn("received request for screenshot with target element highlighted when agent controller has already sent the action command to the content script- NEED TO INCREASE HOW LONG AGENT CONTROLLER SLEEPS BEFORE PERFORMING ELEMENT-SPECIFIC ACTIONS");
            }

            agentController.captureAndStoreScreenshot("targeted", request.promptingIndexForAction).then(() => {
                    centralLogger.info("took screenshot of page with target element highlighted");
                    sendResponse({success: true, message: "Took screenshot with target element highlighted"});
                }, (error) => {
                    const errMsg = `error taking screenshot of highlighted element; error: ${renderUnknownValue(error)}`;
                    centralLogger.error(errMsg);
                    sendResponse({success: false, message: errMsg});
                }
            );
        }
        //idea for later space-efficiency refinement - when saving a "targeted" screenshot, maybe could reduce its
        // quality drastically b/c you only care about an indication of which element in the screen was being targeted,
        // and you can consult the corresponding "initial" screenshot for more detail?
    } else if (request.reqType === PageRequestType.GENERAL_SCREENSHOT_FOR_SAFE_ELEMENTS) {
        actionAnnotationCoordinator.captureAndStoreGeneralScreenshot().then(() => {
                centralLogger.info("took general screenshot of page (to ensure all safe elements are covered in a screenshot)");
                sendResponse({success: true, message: "Took general screenshot of page"});
            }, (error) => {
                const errMsg = `error taking general screenshot of page; error: ${renderUnknownValue(error)}`;
                centralLogger.error(errMsg);
                sendResponse({success: false, message: errMsg});
            }
        );
    } else if (request.reqType === PageRequestType.EULA_ACCEPTANCE) {
        chrome.storage.local.set({[storageKeyForEulaAcceptance]: true}, () => {
            if (chrome.runtime.lastError) {
                centralLogger.error("error setting eulaAccepted to true in local storage:", renderUnknownValue(chrome.runtime.lastError));
            } else {centralLogger.info("set eulaAccepted to true in local storage");}
        });

    } else {
        centralLogger.error("unrecognized request type:", request.reqType);
    }
    return true;
}

chrome.runtime.onMessage.addListener(handleMsgFromPage);


let numSidePanelPortsOpen = 0;

async function updateServiceWorkerOnNewSidePanelConnection(newPort: Port, disconnectHandler: (port: Port) => Promise<void>): Promise<void> {
    await serviceWorkerStateMutex.acquire()
    numSidePanelPortsOpen++;
    centralLogger.info(`service worker now has ${numSidePanelPortsOpen} side panel ports open`);
    if (numSidePanelPortsOpen === 1) {
        serviceWorkerStateMutex.release();
        chrome.alarms.create(serviceWorkerKeepaliveAlarmName, {periodInMinutes: 0.5}).catch((error) =>
            centralLogger.error(`error while trying to set up service worker keepalive alarm; error: ${renderUnknownValue(error)}`));
        setTimeout(() => {
            centralLogger.debug("setting up secondary keepalive alarm in service worker");
            chrome.alarms.create(serviceWorker2ndaryKeepaliveAlarmName, {periodInMinutes: 0.5}).catch((error) =>
                centralLogger.error(`error while trying to set up secondary service worker keepalive alarm; error: ${renderUnknownValue(error)}`));
        }, 15_000);
    } else { serviceWorkerStateMutex.release() }
    newPort.onDisconnect.addListener((port: Port) => {
        serviceWorkerStateMutex.acquire();
        numSidePanelPortsOpen--;
        if (numSidePanelPortsOpen === 0) {
            serviceWorkerStateMutex.release();
            centralLogger.debug("clearing keep-alive alarms so that service worker will be shut down");
            chrome.alarms.clear(serviceWorkerKeepaliveAlarmName).catch((error) =>
                centralLogger.warn("error while trying to clear keep-alive alarm; error: ", renderUnknownValue(error)));
            chrome.alarms.clear(serviceWorker2ndaryKeepaliveAlarmName).catch((error) =>
                centralLogger.warn("error while trying to clear secondary keep-alive alarm; error: ", renderUnknownValue(error)));
        } else { serviceWorkerStateMutex.release() }

        disconnectHandler(port).catch((error) => {
            centralLogger.error(`error handling side panel disconnection in service worker: ${renderUnknownValue(error)}`);
        });
    });
}

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
    if (port.name.startsWith(pageToControllerPort)) {
        if (!agentController) {
            centralLogger.error(`agentController not initialized when page actor ${port.name} tried to connect to agent controller in service worker`);
            return;
        }
        agentController.addPageConnection(port).then(
            () => centralLogger.trace("page actor connected to agent controller in service worker"));
    } else if (port.name === panelToControllerPort) {
        centralLogger.trace("side panel opened new connection to service worker for agent controller");
        if (!agentController) {
            centralLogger.debug("have to initialize agent controller to handle connection from side panel");
            agentController = await initializeAgentController();
            centralLogger.trace("finished initializing agent controller to handle connection from side panel");
        }
        await updateServiceWorkerOnNewSidePanelConnection(port, agentController.handlePanelDisconnectFromController);

        agentController.addSidePanelConnection(port).catch((error) =>
            centralLogger.error(`error adding side panel connection to agent controller: ${renderUnknownValue(error)}`));
    } else if (port.name === panelToAnnotationCoordinatorPort) {
        centralLogger.trace("side panel opened new connection to service worker for annotation coordinator");
        await updateServiceWorkerOnNewSidePanelConnection(port, actionAnnotationCoordinator.handlePanelDisconnectFromCoordinator);
        actionAnnotationCoordinator.addSidePanelConnection(port).catch((error) =>
            centralLogger.error(`error adding side panel connection to annotation coordinator: ${renderUnknownValue(error)}`));
    } else if (port.name.startsWith(pageToAnnotationCoordinatorPort)) {
        actionAnnotationCoordinator.addPageConnection(port).catch((error) =>
            centralLogger.error(`error adding page connection to annotation coordinator: ${renderUnknownValue(error)}`));
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
    } else if (command === "capture_annotation") {
        actionAnnotationCoordinator.initiateActionAnnotationCapture().catch((error) =>
            centralLogger.error(`error initiating action annotation capture: ${renderUnknownValue(error)}`));
    }
    // relatedly, idea- separate class from AgentController for this, maybe ActionAnnotationCoordinator
    else {
        centralLogger.error(`unrecognized key command: ${command} from tab: ${JSON.stringify(tab)}`);
    }
}

chrome.commands.onCommand.addListener(handleKeyCommand);

const recordsClearingAlarmName = "records_clearing_alarm";//logs and screenshots
const numDaysToKeepRecords = 14;//maybe make this user-configurable if requested

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === serviceWorkerKeepaliveAlarmName) {
        centralLogger.trace("service worker keepalive alarm fired");

        if (dbConnHolder.dbConn && logsNotYetSavedToDb.length > 0) {
            mislaidLogsQueueMutex.runExclusive(() => {
                let shouldAbortCurrLogSavingRun = false;
                while (logsNotYetSavedToDb.length > 0 && dbConnHolder.dbConn && !shouldAbortCurrLogSavingRun) {
                    //shift result can't be undefined b/c previous line confirmed array isn't empty
                    const logMsg = logsNotYetSavedToDb.shift() as LogMessage;
                    dbConnHolder.dbConn.add(LOGS_OBJECT_STORE, logMsg).catch((error) => {
                        console.error(`error ${renderUnknownValue(error)} adding log message ${JSON.stringify(logMsg)} to indexeddb:`);
                        logsNotYetSavedToDb.push(logMsg);
                        shouldAbortCurrLogSavingRun = true;
                    });
                }
            }).catch((error) =>
                centralLogger.error(`error occurred while trying to deal with mislaid log messages that hadn't been saved to the database yet: ${renderUnknownValue(error)}`));
        }
    } else if (alarm.name === serviceWorker2ndaryKeepaliveAlarmName) {
        centralLogger.trace("service worker secondary keepalive alarm fired");
    } else if (alarm.name === recordsClearingAlarmName) {
        const newestRecordTsToDelete = new Date(Date.now() - 1000 * 60 * 60 * 24 * numDaysToKeepRecords)
            .toISOString().slice(0, -1);//remove Z because it throws off string-based ordering
        centralLogger.info(`deleting logs/screenshots from before ${newestRecordTsToDelete} from indexeddb because they are older than ${numDaysToKeepRecords} days`);

        if (!dbConnHolder.dbConn) {
            centralLogger.warn(`cannot delete old logs/screenshots from indexeddb because db connection is not initialized`);
            return;
            //if it's a problem that this leads to occasionally skipping one log clearing (and so max log storage usage
            // being double the normal peak), then we can add something here to make the alarm fire again in 5 minutes
            // instead of 14 days
        }

        //if a third store is added, the below should be refactored to use a helper method

        dbConnHolder.dbConn.transaction(LOGS_OBJECT_STORE, "readwrite").objectStore(LOGS_OBJECT_STORE).index("by-ts")
            .openCursor(IDBKeyRange.upperBound(newestRecordTsToDelete)).then(
            async (cursor) => {
                if (cursor) {
                    let numLogsDeleted = 0;
                    while (cursor) {
                        cursor.delete().catch((error) => {
                            centralLogger.error(`error deleting an old log from indexeddb: ${renderUnknownValue(error)}`);
                        });
                        numLogsDeleted++;
                        cursor = await cursor.continue();
                    }
                    centralLogger.info(`finished deleting old logs from indexeddb (total deleted: ${numLogsDeleted})`);
                } else {
                    centralLogger.info(`detected no logs older than ${numDaysToKeepRecords} days in indexeddb, so no logs were deleted`);
                }
            }, (error) => {
                centralLogger.error(`error deleting old logs from indexeddb: ${renderUnknownValue(error)}`);
            }
        );

        dbConnHolder.dbConn.transaction(SCREENSHOTS_OBJECT_STORE, "readwrite").objectStore(SCREENSHOTS_OBJECT_STORE)
            .index("by-ts").openCursor(IDBKeyRange.upperBound(newestRecordTsToDelete)).then(
            async (cursor) => {
                if (cursor) {
                    let numScreenshotsDeleted = 0;
                    while (cursor) {
                        cursor.delete().catch((error) => {
                            centralLogger.error(`error deleting an old screenshot from indexeddb: ${renderUnknownValue(error)}`);
                        });
                        numScreenshotsDeleted++;
                        cursor = await cursor.continue();
                    }
                    centralLogger.info(`finished deleting old screenshots from indexeddb (total deleted: ${numScreenshotsDeleted})`);
                } else {
                    centralLogger.info(`detected no screenshots older than ${numDaysToKeepRecords} days in indexeddb, so no screenshots were deleted`);
                }
            }, (error) => {
                centralLogger.error(`error deleting old screenshots from indexeddb: ${renderUnknownValue(error)}`);
            }
        );
        centralLogger.info("finished launching jobs/transactions for clearing out old logs/screenshots from indexeddb");

    } else {
        centralLogger.error(`unrecognized alarm name: ${alarm.name}`);
    }
});


(async () => {
    const logClearAlarm = await chrome.alarms.get(recordsClearingAlarmName);
    if (!logClearAlarm) {
        try {
            await chrome.alarms.create(recordsClearingAlarmName, {
                periodInMinutes: 60 * 24 * numDaysToKeepRecords
            });
            centralLogger.info(`started up a recurring alarm for clearing logs/screenshots outside a rolling window of ${numDaysToKeepRecords} days`);
        } catch (error: any) {
            centralLogger.error(`error creating alarm for clearing old logs/screenshots: ${renderUnknownValue(error)}`);
        }
    }
})()

