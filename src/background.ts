import winston, {createLogger} from "winston";
import {format} from "logform"
import {WinstonInfo} from "./utils/BrowserBackgroundTransport";

console.log("successfully loaded background script in browser");


//initially, unified/relatively-persistent logging will be achieved simply by having content script and popup's js
// send messages to the background script, which will print to the console in the extension's devtools window
const centralLogger = createLogger({
    //todo before release, if this is still here, change level to info,
    // preferably with a way for the user to control this via advanced section of options menu
    level: 'debug',
    transports: [new winston.transports.Console()],
    format: winston.format.combine(
        format((info) => {
            info.service ??= "background";
            return info;
        })(),
        winston.format.json(),
        winston.format.colorize({all: true})
    )
});
centralLogger.verbose("central logger created in background script");
//todo later add indexeddb logging via the background script
// unclear whether that should be a winston custom transport attached to the above logger or if it should just be code
// in the onMessage listener which directly writes to indexeddb (latter avoids infinite recursion possibility)
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


// if microsecond precision timestamps are needed for logging, can use this
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        centralLogger.verbose("request received by service worker", sender.tab ?
            "from a content script:" + sender.tab.url :
            "from the extension");
        if (request.reqType === "takeScreenshot") {
            const screenshotPromise = chrome.tabs.captureVisibleTab();

            centralLogger.verbose("screenshot promise created; time is", new Date().toISOString());
            screenshotPromise.then((screenshotDataUrl) => {
                centralLogger.debug("screenshot created; about to send screenshot back to content script at " +
                    "time", new Date().toISOString(), "; length:", screenshotDataUrl.length,
                    "truncated data url:", screenshotDataUrl.slice(0, 100));
                sendResponse({screenshot: screenshotDataUrl});
                centralLogger.verbose("screen shot sent back to content script; time is", new Date().toISOString());
            });
        } else if (request.reqType === "log") {
            const {level, message, ...meta} = request.payload as WinstonInfo;
            centralLogger.log(level, message, meta);
        } else {
            centralLogger.error("unrecognized request type:", request.reqType);
        }
        return true;
    }
);


//todo before official release, if indexeddb persistent logging was implemented, make mechanism to trigger
// once every 14 days and purge logs older than 14 days from the extension's indexeddb