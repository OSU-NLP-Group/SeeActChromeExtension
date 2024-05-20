import log, {LogLevelNames, LogLevel} from "loglevel";
import {PageRequestType} from "./misc";


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

const logLevelCache: {chosenLogLevel: keyof LogLevel} = { chosenLogLevel: defaultLogLevel}
const logLevelQuery = await chrome.storage.local.get("logLevel");
if (isLogLevelName(logLevelQuery.logLevel)) {
    logLevelCache.chosenLogLevel = logLevelQuery.logLevel;
} else if (logLevelQuery.logLevel !== undefined) {
    console.error(`invalid log level was stored: ${logLevelQuery.logLevel}, ignoring it when initializing logging script`)
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
            return function (...args: unknown[]) {
                rawMethod(augmentLogMsg(new Date().toISOString(), loggerName, methodName, args));
            };
        };
    } else {
        newLogger.methodFactory = function (methodName, logLevel, loggerName) {
            const rawMethod = origLoggerFactory(methodName, logLevel, loggerName);
            return function (...args: unknown[]) {
                const timestampStr = new Date().toISOString();
                const msg = augmentLogMsg(timestampStr, loggerName, methodName, undefined, args);
                rawMethod(msg);

                chrome.runtime.sendMessage({
                    reqType: PageRequestType.LOG, timestamp: timestampStr, loggerName: loggerName, level: methodName,
                    args: args
                }).catch((err) => {
                    console.error("error [<", err, ">] while sending log message [<", msg,
                        ">] to background script for persistence");
                });
            };
        };
    }

    newLogger.setLevel(logLevelCache.chosenLogLevel);
    newLogger.rebuild();

    if (chrome?.storage?.local) {
        chrome.storage.local.get("logLevel", (items) => {
            const storedLevel: string = items.logLevel;
            if (storedLevel) {
                if (isLogLevelName(storedLevel)) {
                    newLogger.setLevel(storedLevel);
                    newLogger.rebuild();
                    logLevelCache.chosenLogLevel = storedLevel;
                } else {
                    newLogger.error(`invalid log level was inserted into local storage: ${storedLevel}, ignoring it when initializing a logger`)
                }
            }
        });

        //todo unit testing this? maybe create a function that takes a logger and returns a "local storage changes handler" function, then just unit test that
        chrome.storage.local.onChanged.addListener((changes: {[p: string]: chrome.storage.StorageChange}) => {
            if (changes.logLevel) {
                const newLogLevel: string = changes.logLevel.newValue;
                if (isLogLevelName(newLogLevel)) {
                    const existingLogLevel = LogLevelDict[newLogger.getLevel()];
                    if (newLogLevel !== existingLogLevel) {
                        newLogger.debug(`log level changed from ${existingLogLevel} to ${newLogLevel}`)
                        newLogger.setLevel(newLogLevel);
                        newLogger.rebuild();
                        logLevelCache.chosenLogLevel = newLogLevel;
                    }
                } else {
                    newLogger.error(`invalid log level was inserted into local storage: ${newLogLevel}, ignoring it when processing a possible update to the log level setting`)
                }
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
