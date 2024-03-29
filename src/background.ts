console.log("successfully loaded background script in browser");

const LOGS_OBJECT_STORE = "logs";


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
});


// if microsecond precision timestamps are needed for logging, can use this
// https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#performance.now_vs._date.now

chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
        console.log("request received by service worker", sender.tab ?
            "from a content script:" + sender.tab.url :
            "from the extension");
        if (request.reqType === "takeScreenshot") {
            const screenshotPromise = chrome.tabs.captureVisibleTab();

            console.log("screenshot promise created; time is", new Date().toISOString());
            screenshotPromise.then((screenshotDataUrl) => {
                console.log("screenshot created; about to send screenshot back to content script at time", new Date().toISOString(), "truncated data url:", "; length:", screenshotDataUrl.length, screenshotDataUrl.slice(0, 100));
                sendResponse({screenshot: screenshotDataUrl});
                console.log("screen shot sent back to content script; time is", new Date().toISOString());
            });
        } else {
            console.error("unrecognized request type:", request.reqType);
        }
        return true;
    }
);


//todo before official release, make mechanism to trigger once every 14 days and purge logs older than 14 days from
// the extension's indexeddb