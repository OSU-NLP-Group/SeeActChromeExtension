import {createNamedLogger} from "./shared_logging_setup";
import {ChromeWrapper} from "./ChromeWrapper";
import log from "loglevel";
import {renderUnknownValue} from "./misc";

export class ServiceWorkerHelper {
    //for dependency injection in unit tests
    private chromeWrapper: ChromeWrapper;
    readonly logger;

    constructor(chromeWrapper?: ChromeWrapper, loggerToUse?: log.Logger) {
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = loggerToUse ?? createNamedLogger('service-worker-helper', true);
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
            {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent key-down keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "char", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent char keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.sendCommand({tabId: tabId}, "Input.dispatchKeyEvent",
            {"type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"});
        this.logger.debug(`chrome.debugger sent keyup keyevent for Enter/CR key to tab ${tabId}`);
        await this.chromeWrapper.detachDebugger({tabId: tabId});
        this.logger.debug(`chrome.debugger detached from the tab ${tabId} after sending an Enter key press`);
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

