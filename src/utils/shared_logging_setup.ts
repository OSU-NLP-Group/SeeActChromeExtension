import log, {LogLevel, LogLevelNames} from "loglevel";
import {
    renderUnknownValue, storageKeyForLogLevel
} from "./misc";
import {DBSchema, IDBPDatabase, openDB} from 'idb';
import {Mutex} from "async-mutex";
import {
    expectedMsgForSendingRuntimeRequestFromDisconnectedContentScript,
    PageRequestType
} from "./messaging_defs";


// Create an object that maps the names of the log levels to their numeric values
const LogLevelValues = {
    TRACE: log.levels.TRACE,
    DEBUG: log.levels.DEBUG,
    INFO: log.levels.INFO,
    WARN: log.levels.WARN,
    ERROR: log.levels.ERROR,
    SILENT: log.levels.SILENT,
};
export const origLoggerFactory = log.methodFactory;


export const defaultLogLevel: keyof LogLevel = "TRACE";//todo change this to warn before release

const logLevelCache: { chosenLogLevel: keyof LogLevel } = {chosenLogLevel: defaultLogLevel}
chrome.storage.local.get(storageKeyForLogLevel).then((items) => {
    const logLevelVal = items[storageKeyForLogLevel]
    if (isLogLevelName(logLevelVal)) {
        logLevelCache.chosenLogLevel = logLevelVal;
    } else if (logLevelVal !== undefined) {
        console.error(`invalid log level was stored: ${logLevelVal}, ignoring it when initializing logging script`)
    }
});

export const taskIdHolder: { currTaskId: string | undefined } = {currTaskId: undefined};
export const taskIdPlaceholderVal = "UNAFFILIATED";

export const DB_NAME = "Browser_LMM_Agent";
export const LOGS_OBJECT_STORE = "logs";
export const SCREENSHOTS_OBJECT_STORE = "screenshots";

// timestamps in this db are _implicitly_ (no time zone indicator at the end) in UTC+0 time zone;
// They follow ISO-8601 format _except_ for the missing final Z and except that sometimes it'll have microseconds
// (6 digits after decimal point) instead of milliseconds (3 digits after decimal point)
// The omission of the Z allows sorting in the by-ts indexes to work properly when some timestamps have milliseconds
// and some have microseconds
export interface AgentDb extends DBSchema {
    logs: {
        key: number;
        value: {
            timestamp: string;
            loggerName: string;
            level: LogLevelNames;
            taskId: string;
            msg: string;
        };
        indexes: { 'by-ts': string, 'by-task': string };
    };
    screenshots: {
        key: string;
        value: {
            timestamp: string;
            taskId: string;
            numPriorActions: number;
            //this is just for when monitor rejection causes a new screenshot to be taken for the next prompting
            numPriorScreenshotsForPrompts: number;
            //"initial" for the one going into the prompt, "targeted" for the screenshot after the target element has
            // been highlighted ("targeted" is not created for element-independent actions)
            screenshotType: string,
            //comma-separated-list of taskId, numPriorActions, numPriorPromptings, screenshotType; serves as key for
            // the object store
            screenshotId: string;
            screenshot64: string;
        };
        indexes: { 'by-ts': string, 'by-task': string };
    };
}

export interface LogMessage {
    timestamp: string;
    loggerName: string;
    level: LogLevelNames;
    taskId: string;
    msg: string;
}

export interface ScreenshotRecord {
    timestamp: string;
    taskId: string;
    numPriorActions: number;
    numPriorScreenshotsForPrompts: number;
    screenshotType: string;
    screenshotId: string;
    screenshot64: string;
}

export const dbConnHolder: { dbConn: IDBPDatabase<AgentDb> | null } = {dbConn: null};

export const logsNotYetSavedToDb: LogMessage[] = [];
export const mislaidLogsQueueMutex = new Mutex();


export const initializeDbConnection = async () => {
    try {
        dbConnHolder.dbConn = await openDB<AgentDb>(DB_NAME, 1);
    } catch (error: any) {
        console.error("error occurred while opening db connection", error)
    }
    if (dbConnHolder.dbConn) {
        dbConnHolder.dbConn.onerror = (event) => {
            console.error("error occurred on db connection", event);
        }
    }
}

export function saveLogMsgToDb(timestampStr: string, actualLoggerName: string, methodName: log.LogLevelNames,
                               msgArgs: unknown[]) {
    const taskIdForMsg = taskIdHolder.currTaskId ?? taskIdPlaceholderVal;
    const renderedMsg = msgArgs.join(" ");
    //remove the trailing 'Z' from the timestamp string to make it work as a key in a browser db index (because
    // otherwise comparisons-between/ordering-of ts values in the index would be thrown off by some ending with
    // milliseconds and a Z while others ended with microseconds and a Z)
    const dbSafeTsStr = timestampStr.slice(0, -1);
    if (dbConnHolder.dbConn) {
        dbConnHolder.dbConn.add(LOGS_OBJECT_STORE, {
            timestamp: dbSafeTsStr, loggerName: actualLoggerName, level: methodName,
            taskId: taskIdForMsg, msg: renderedMsg
        }).catch((error) =>
            console.error("error adding log message to indexeddb:", renderUnknownValue(error)));
    } else {
        mislaidLogsQueueMutex.runExclusive(() => {
            logsNotYetSavedToDb.push({
                timestamp: dbSafeTsStr, loggerName: actualLoggerName, level: methodName,
                taskId: taskIdForMsg, msg: renderedMsg
            })
        }).catch((error) =>
            console.error("error when trying to add log message to buffer (because db connection temporarily unavailable:", renderUnknownValue(error)));
    }
}

/**
 * Create a logger with the given name, using the 'plugin' functionality which was added to loglevel in
 * shared_logging_setup.ts to centralize the extension's logging in the background script's console and add more detail
 * @param loggerName the name of the logger (a class or module name)
 * @param inServiceWorker whether the logger is being created in a service worker; if not, it needs to send log
 *                         messages to the service worker for persistence in a unified location
 */
export const createNamedLogger = (loggerName: string, inServiceWorker: boolean): log.Logger => {
    const newLogger = log.getLogger(loggerName);

    if (inServiceWorker) {
        newLogger.methodFactory = function (methodName, logLevel, loggerName) {
            const rawMethod = origLoggerFactory(methodName, logLevel, loggerName);
            const actualLoggerName: string = typeof loggerName === "string" ? loggerName :
                (Symbol.keyFor(loggerName) ?? loggerName.toString());
            return function (...args: unknown[]) {
                //if chrome ever supports cross-origin isolation in service workers, this can use performance precise timestamps too
                const timestampStr = new Date().toISOString();
                rawMethod(augmentLogMsg(timestampStr, actualLoggerName, methodName, args));
                saveLogMsgToDb(timestampStr, actualLoggerName, methodName, args);
            };
        };
    } else {
        newLogger.methodFactory = function (methodName, logLevel, loggerName) {
            const rawMethod = origLoggerFactory(methodName, logLevel, loggerName);
            return function (...args: unknown[]) {
                let timestampStr = new Date().toISOString();
                if (window?.crossOriginIsolated) {
                    const preciseTimestamp = performance.timeOrigin + performance.now();
                    const fractionOfMs = preciseTimestamp % 1;
                    timestampStr = new Date(preciseTimestamp).toISOString();
                    timestampStr = timestampStr.slice(0, timestampStr.length - 1)
                        + fractionOfMs.toFixed(3).slice(2) + "Z";
                }
                const msg = augmentLogMsg(timestampStr, loggerName, methodName, args);
                rawMethod(msg);

                try {
                    chrome.runtime.sendMessage({
                        reqType: PageRequestType.LOG, timestamp: timestampStr, loggerName: loggerName,
                        level: methodName, args: args
                    }).catch((err) =>
                        console.error(`error [<${err}>] while sending log message [<${msg}>] to background script for persistence`));
                } catch (error: any) {
                    if ('message' in error && error.message === expectedMsgForSendingRuntimeRequestFromDisconnectedContentScript) {
                        console.warn(`lost ability to send messages/requests to service-worker/agent-controller (probably page is being unloaded) while trying to send log message to background script for persistence;\n log message: ${msg};\nerror: ${renderUnknownValue(error)}`);
                    } else {
                        console.error(`error encountered while trying to send log message to background script for persistence;\n log message: ${msg};\nerror: ${renderUnknownValue(error)}`);
                        throw error;
                    }
                }
            };
        };
    }

    newLogger.setLevel(logLevelCache.chosenLogLevel);
    newLogger.rebuild();

    if (chrome?.storage?.local) {
        chrome.storage.local.get(storageKeyForLogLevel, (items) => {
            const storedLevel: unknown = items[storageKeyForLogLevel];
            if (isLogLevelName(storedLevel)) {
                newLogger.setLevel(storedLevel);
                newLogger.rebuild();
                logLevelCache.chosenLogLevel = storedLevel;
            } else if (storedLevel !== undefined) {newLogger.error(`invalid log level was detected in local storage: ${storedLevel}, ignoring it when initializing a logger`)}
        });

        chrome.storage.local.onChanged.addListener((changes: { [p: string]: chrome.storage.StorageChange }) => {
            if (changes[storageKeyForLogLevel]) {
                const newLogLevel: unknown = changes[storageKeyForLogLevel].newValue;
                if (isLogLevelName(newLogLevel)) {
                    const existingLogLevel = LogLevelDict[newLogger.getLevel()];
                    if (newLogLevel !== existingLogLevel) {
                        newLogger.debug(`log level changed from ${existingLogLevel} to ${newLogLevel}`)
                        newLogger.setLevel(newLogLevel);
                        newLogger.rebuild();
                        logLevelCache.chosenLogLevel = newLogLevel;
                    }
                } else if (newLogLevel !== undefined) {newLogger.error(`invalid log level was detected in local storage: ${newLogLevel}, ignoring it when processing a possible update to the log level setting`)}
            }
        });
    }

    return newLogger;
}

/**
 * Augment a log message with a timestamp, logger name, and log level
 * @param timestampStr the timestamp string to use
 * @param loggerName the name of the logger (usually a module or class name)
 * @param levelName the log level name
 * @param args the arguments to the logger call
 *              this might just be 0 or more objects/strings/other-primitives to concatenate together with spaces
 *              in between, or it might be a format string containing placeholder patterns followed by some number of
 *              substitution strings; latter scenario is not yet supported
 * @return a single augmented log message
 */
export function augmentLogMsg(timestampStr: string, loggerName: string | symbol, levelName: LogLevelNames,
                              ...args: unknown[]) {
    let msg: string = "";
    if (typeof args[0] === "string" && args[0].includes("%s")) {
        console.warn("log message contains %s, which is a placeholder for substitution strings. " +
            "This is not supported by this logging feature yet; please use string concatenation instead.");
        //todo maybe add logic here to support an initial arg which contains substitution string(s)
        // could use this https://github.com/sevensc/typescript-string-operations#stringformat
        // Only need to support placeholders that console.log already supported:
        //  https://developer.mozilla.org/en-US/docs/Web/API/console#using_string_substitutions

        //for now, just supporting the simple "one or more objects get concatenated together" approach
        msg = [timestampStr, loggerName, levelName.toUpperCase(), ...args].join(" ");
    } else {
        //for now, just supporting the simple "one or more objects get concatenated together" approach
        msg = [timestampStr, loggerName, levelName.toUpperCase(), ...args].join(" ");
    }
    return msg;
}

/**
 * Assert that the given value is a valid log level name (i.e. one of the method names in loglevel's logger)
 * @param logLevelName the value to check
 */
export function assertIsValidLogLevelName(logLevelName: unknown | undefined): asserts logLevelName is log.LogLevelNames {
    const badLevelErr = new Error(`Invalid log level name: ${logLevelName}`);
    if (typeof logLevelName !== "string") {
        throw badLevelErr;
    }
    const capitalizedLevelName = logLevelName.toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(log.levels, capitalizedLevelName) || capitalizedLevelName === "SILENT"
        || logLevelName.toLowerCase() !== logLevelName) {
        throw badLevelErr;
    }
}

export function isLogLevelName(logLevelName: unknown): logLevelName is keyof LogLevel {
    return typeof logLevelName === "string" && logLevelName in LogLevelValues;
}

// Create a mapping object that maps from the numeric values of the log levels to their names
export const LogLevelDict: { [K in typeof LogLevelValues[keyof typeof LogLevelValues]]: keyof LogLevel } = {
    [LogLevelValues.TRACE]: "TRACE",
    [LogLevelValues.DEBUG]: "DEBUG",
    [LogLevelValues.INFO]: "INFO",
    [LogLevelValues.WARN]: "WARN",
    [LogLevelValues.ERROR]: "ERROR",
    [LogLevelValues.SILENT]: "SILENT",
};
