import log, {LogLevelNames} from "loglevel";

export const origLoggerFactory = log.methodFactory;

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
                    reqType: 'log',
                    timestamp: timestampStr,
                    loggerName: loggerName,
                    level: methodName,
                    args: args
                }).catch((err) => {
                    console.error("error [<", err, ">] while sending log message [<", msg,
                        ">] to background script for persistence");
                });
            };
        };
    }

    //todo change this to info or warn before release, and ideally make it configurable from advanced part of options menu
    newLogger.setLevel("trace");
    newLogger.rebuild();


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

