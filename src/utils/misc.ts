import {SerializableElementData} from "./BrowserHelper";


export const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";

/**
 * types of one-off messages that might be sent to the service worker, either from the content script or the popup
 */
export enum PageRequestType {
    LOG = "log",
    START_TASK = "startTask",
    END_TASK = "endTask",
    PRESS_ENTER = "pressEnter"
}

/**
 * types of messages that the content script (mostly the page actor in the content script) might send to the agent
 * controller in the service worker (in the 'background') over their persistent connection
 */
export enum Page2BackgroundPortMsgType {
    READY = "contentScriptInitializedAndReady",
    TERMINAL = "terminalPageSideError",
    PAGE_STATE = "sendingPageState",
    ACTION_DONE = "actionPerformed"
}

/**
 * types of messages that the agent controller in the service worker (in the 'background') might send to the content
 * script over their persistent connection
 */
export enum Background2PagePortMsgType {
    REQ_PAGE_STATE = "requestPageState",
    REQ_ACTION = "requestAction"
}

/**
 * types of actions that the web agent might choose to take
 */
export enum Action {
    CLICK = "CLICK",
    SELECT = "SELECT",
    TYPE = "TYPE",
    PRESS_ENTER = "PRESS_ENTER",
    SCROLL_UP = "SCROLL_UP",
    SCROLL_DOWN = "SCROLL_DOWN",
    HOVER = "HOVER",
    TERMINATE = "TERMINATE",
    NONE = "NONE"
}

/**
 * @description Builds a description of an action (which may have been performed on an element)
 * @param action name of the action
 * @param elementData optional data of the element on which the action was performed
 *                      (undefined if action didn't target an element)
 * @param value optional value of the action (e.g. text to be typed)
 * @return description of an action
 */
export function buildGenericActionDesc(action: Action, elementData?: SerializableElementData, value?: string): string {
    if (elementData) {
        const valueDesc = value ? ` with value: ${(value)}` : "";
        return `[${elementData?.tagHead}] ${elementData?.description} -> ${action}${valueDesc}`;
    } else {
        return `Performed element-independent action ${action}`;
    }
}//todo 2 unit tests


export async function sleep(numMs: number) {
    await new Promise(resolve => setTimeout(resolve, numMs));
}