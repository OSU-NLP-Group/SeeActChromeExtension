import {createNamedLogger} from "./shared_logging_setup";
import {ChromeWrapper} from "./ChromeWrapper";
import log from "loglevel";
import {renderUnknownValue} from "./misc";
import JSZip from "jszip";

/**
 * the non-error parts of an object of this type should be disregarded if the error field is defined
 */
export interface ScreenshotCapture {
    screenshotBase64: string;
    screenshotDataUrl: string;
    error?: string;
}

export class ServiceWorkerHelper {
    //for dependency injection in unit tests
    private chromeWrapper: ChromeWrapper;
    readonly logger;

    constructor(chromeWrapper?: ChromeWrapper, loggerToUse?: log.Logger) {
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = loggerToUse ?? createNamedLogger('service-worker-helper', true);
    }

    captureScreenshot = async (screenshotType: string): Promise<ScreenshotCapture> => {
        const dummyResult: ScreenshotCapture = {screenshotBase64: "fake", screenshotDataUrl: "fake"};
        let screenshotDataUrl: string|undefined;
        try {
            screenshotDataUrl = await this.chromeWrapper.fetchVisibleTabScreenshot();
        } catch (error: any) {
            const termReason = `error while trying to get screenshot of current tab; error: ${renderUnknownValue(error)}`;
            return { ...dummyResult, error: termReason };
        }
        this.logger.debug(`${screenshotType} screenshot data url (truncated): ${screenshotDataUrl.slice(0, 100)}...`);
        const startIndexForBase64Data = screenshotDataUrl.indexOf(';base64,') + 8;
        if (startIndexForBase64Data <= 7) {//if indexOf returns -1
            const termReason = "error while trying to extract base64-encoded data from screenshot data url: screenshot data url does not contain expected prefix";
            return { ...dummyResult, error: termReason };
        } else if (startIndexForBase64Data >= screenshotDataUrl.length) {
            const termReason = "error while trying to extract base64-encoded data from screenshot data url: screenshot data url does not contain any data after the prefix";
            return { ...dummyResult, error: termReason };
        }
        return { screenshotBase64: screenshotDataUrl.substring(startIndexForBase64Data), screenshotDataUrl: screenshotDataUrl };
    }

    sendZipToSidePanelForDownload(
        zipDescription: string, zip: JSZip, sidePanelPort: chrome.runtime.Port, zipFilename: string,
        sidePanelDownloadMsgType: string, sidePanelAbortDownloadMsgType: string) {
        this.logger.info(`about to compress info into virtual zip file for ${zipDescription}`);
        zip.generateAsync({type: "blob", compression: "DEFLATE", compressionOptions: {level: 7}}
        ).then(async (content) => {
            this.logger.debug(`successfully generated virtual zip file for ${zipDescription}; about to send it to side panel so that it can be saved as a download`);

            this.logger.debug(`blob for virtual zip file for ${zipDescription} has byte length: ${content.size}`);
            const arrBuffForTraceZip = await content.arrayBuffer();
            this.logger.debug(`array buffer made from that blob has length: ${arrBuffForTraceZip.byteLength}`);
            const arrForTraceZip = Array.from(new Uint8Array(arrBuffForTraceZip));
            this.logger.debug(`array made from that buffer has length: ${arrForTraceZip.length}`);
            const maxMessageByteLen = 15_000_000;//conservative estimate of the limit for message size in Chrome

            if (arrForTraceZip.length <= maxMessageByteLen) {
                try {
                    sidePanelPort.postMessage({type: sidePanelDownloadMsgType, data: arrForTraceZip, fileName: zipFilename});
                    this.logger.debug(`sent zip file for ${zipDescription} to side panel for download`);
                } catch (error: any) {
                    this.logger.error(`error while trying to send zip file for ${zipDescription} to side panel for download; error: ${renderUnknownValue(error)}`);
                }
            } else {
                const numChunks = Math.ceil(arrForTraceZip.length / maxMessageByteLen);
                this.logger.info(`zip file for ${zipDescription} is too large to send in one message; will split it up into ${numChunks} chunks`);
                for (let i = 0; i < numChunks; i++) {
                    const chunkStart = i * maxMessageByteLen;
                    const chunkEnd = Math.min((i + 1) * maxMessageByteLen, arrForTraceZip.length);
                    const chunk = arrForTraceZip.slice(chunkStart, chunkEnd);
                    try {
                        sidePanelPort.postMessage({type: sidePanelDownloadMsgType, data: chunk, fileName: zipFilename, chunkIndex: i, numChunks: numChunks});
                        this.logger.debug(`sent chunk ${i} of zip file for ${zipDescription} to side panel for download`);
                    } catch (error: any) {
                        this.logger.error(`error while trying to send chunk ${i} of zip file for ${zipDescription} to side panel for download; error: ${renderUnknownValue(error)}`);
                        try {
                            sidePanelPort.postMessage({type: sidePanelAbortDownloadMsgType, error: `error while trying to send chunk ${i} of zip file for ${zipDescription} to side panel for download; error: ${renderUnknownValue(error)}`});
                        } catch (error: any) {
                            this.logger.error(`error while trying to tell side panel to abort chunked download after error occurred during the sending of chunk ${i} of zip file for ${zipDescription} to side panel for download; error: ${renderUnknownValue(error)}`);
                        }
                        break;
                    }
                }
            }
        }, (error) => {
            this.logger.error(`error while trying to generate zip file for ${zipDescription}; error: ${renderUnknownValue(error)}`);
        });
    }


    /**
     * @description Get the active tab in the current window (but with id set to undefined if the active tab is a chrome:// URL)
     * @return The active tab, with the id member undefined if the active tab is a chrome:// URL
     *                                          (which scripts can't be injected into for safety reasons)
     * @throws Error If the active tab is not found or doesn't have an id
     */
    getActiveTab = async (): Promise<chrome.tabs.Tab> => {
        let tabs;
        try {
            tabs = await this.chromeWrapper.fetchTabs({active: true, currentWindow: true});
        } catch (error) {
            const errMsg = `error querying active tab; error: ${renderUnknownValue(error)}`;
            this.logger.error(errMsg);
            throw new Error(errMsg);
        }
        const tab: chrome.tabs.Tab | undefined = tabs[0];
        if (!tab) throw new Error('Active tab not found');
        const id = tab.id;
        if (!id) throw new Error('Active tab id not found');
        if (tab.url?.startsWith('chrome://')) {
            this.logger.warn('Active tab is a chrome:// URL: ' + tab.url);
            tab.id = undefined;
        }
        return tab;
    }

    injectContentScript = async (
        contentScriptDesc: string, contentScriptPath: string,
        preInjectChecksAndStateUpdates: (tabId: number, url?: string, title?: string) => string | undefined,
        newTab?: chrome.tabs.Tab): Promise<string|undefined> => {
        let tabId: number | undefined = undefined;
        let tab: chrome.tabs.Tab | undefined = newTab;
        if (!tab) {
            try {
                tab = await this.getActiveTab();
            } catch (error) {
                return `error getting active tab id, cannot inject content script; error: ${renderUnknownValue(error)}`;
            }
        }
        tabId = tab.id;
        if (!tabId) {
            return `Can't inject content script into chrome:// URLs for security reasons`;
        } else {
            this.logger.trace(`injecting ${contentScriptDesc} script into page; in tab ${tabId} with title ${tab.title} and url ${tab.url}`);

            const errMsg = preInjectChecksAndStateUpdates(tabId, tab.url, tab.title);
            if (errMsg) { return errMsg; }
            try {
                await this.chromeWrapper.runScript({files: [contentScriptPath], target: {tabId: tabId}});
                this.logger.trace(`${contentScriptDesc} script injected into page`);
            } catch (error) {
                return `error injecting ${contentScriptDesc} script into page; error: ${renderUnknownValue(error)}`;
            }
        }
        return undefined;
    }

    /**
     * @description Sends an Enter key press to the tab with the given id
     * @param tabId the id of the tab to send the Enter key press to
     */
    sendEnterKeyPress = async (tabId: number): Promise<void> => {
        //todo if/when adding support for press_sequentially for TYPE action, will want this helper method to flexibly
        // handle strings of other characters; in that case, want to do testing to see if windowsVirtualKeyCode is needed or
        // if text (and?/or? unmodifiedText) is enough (or something else)
        await this.chromeWrapper.attachDebugger({tabId: tabId}, "1.3");
        this.logger.debug(`chrome.debugger attached to the tab ${tabId} to send an Enter key press`);
        //thanks to @activeliang https://github.com/ChromeDevTools/devtools-protocol/issues/45#issuecomment-850953391
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "rawKeyDown", "windowsVirtualKeyCode": 13});
        this.logger.debug(`chrome.debugger sent key-down keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "char", "text": "\r"});
        this.logger.debug(`chrome.debugger sent char keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "keyUp", "windowsVirtualKeyCode": 13});
        this.logger.debug(`chrome.debugger sent keyup keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after sending an Enter key press`);
    }

    typeSequentially = async (tabId: number, textToType: string): Promise<void> => {
        await this.chromeWrapper.attachDebugger({tabId: tabId}, "1.3");
        this.logger.debug(`chrome.debugger attached for typing`);

        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "rawKeyDown", "key": textToType.charAt(0)});
        for (const charToSend of textToType) {
            await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
                {"type": "char", "text": charToSend});
        }
        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after typing the text ${textToType} one character at a time`);
    }

    /**
     * @description simulate the user hovering over an element (so that something will pop up or be displayed)
     * current impl: Sends a mouse 'moved' event to the tab with the given id to say that the mouse pointer is now at
     * the given coordinates.
     * @param tabId the id of the tab to hover over the element in
     * @param x the number of css pixels from the left edge of the viewport to the position on the element which
     *           the mouse pointer should be hovering over
     * @param y the number of css pixels from the top edge of the viewport to the position on the element which
     *           the mouse pointer should be hovering over
     */
    hoverOnElem = async (tabId: number, x: number, y: number): Promise<void> => {
        this.logger.debug(`chrome.debugger about to attach to the tab ${tabId} to hover over an element at ${x}, ${y}`);
        await this.chromeWrapper.attachDebugger({tabId: tabId}, "1.3");
        this.logger.debug(`chrome.debugger attached to the tab ${tabId} to hover over an element at ${x}, ${y}`);

        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mouseMoved", "x": x, "y": y});

        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after hovering over an element at ${x}, ${y}`);
    }


    /*
     * the below is sufficient for nearly-real clicking on an element via debugger (as opposed to js click)
     * await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1});
        await sleep(2000);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchMouseEvent",
            {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1});
     */

}

