console.log("successfully loaded background script in browser");


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