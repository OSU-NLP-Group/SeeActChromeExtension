import {Logger} from "loglevel";

//todo consider breaking large parts of this off into 2 separate files, for inter-component communications and for options management in storage

export const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";
export const pageToControllerPort = `page-actor-2-agent-controller`;
export const pageToAnnotationCoordinatorPort = `page-data-collector-2-annotation-coordinator`;
export const panelToControllerPort = "side-panel-2-agent-controller";
export const panelToAnnotationCoordinatorPort = "side-panel-2-annotation-coordinator";
export const expectedMsgForSendingRuntimeRequestFromDisconnectedContentScript = "Extension context invalidated.";

//ms, how long to sleep (after editing an element for highlighting) before telling the service worker to take a
// screenshot; i.e. longest realistic amount of time the browser might take to re-render the modified element
export const elementHighlightRenderDelay = 5;

export const storageKeyForEulaAcceptance = "eulaAccepted";

export const storageKeyForAiProviderType = "aiProviderType";

export const storageKeyForLogLevel = "logLevel";
export const storageKeyForMonitorMode = "isMonitorMode";
export const storageKeyForShouldWipeHistoryOnTaskStart = "shouldWipeHistoryOnTaskStart";
export const storageKeyForMaxOps = "maxOps";
export const storageKeyForMaxNoops = "maxNoops";
export const storageKeyForMaxFailures = "maxFailures";
export const storageKeyForMaxFailureOrNoopStreak = "maxFailureOrNoopStreak";

export const storageKeyForAnnotatorMode = "isAnnotatorMode";


export const defaultIsMonitorMode = false;
export const defaultShouldWipeActionHistoryOnStart = true;

export const defaultMaxOps = 50;
export const defaultMaxNoops = 7;
export const defaultMaxFailures = 10;
export const defaultMaxFailureOrNoopStreak = 4;

export const defaultIsAnnotatorMode = false;

export const validateIntegerLimitUpdate = (newLimitVal: unknown, min: number = 0): newLimitVal is number => {
    return typeof newLimitVal === "number" && Number.isInteger(newLimitVal) && newLimitVal >= min;
}


export interface ViewportDetails {
    scrollX: number;
    scrollY: number;
    width: number;
    height: number;
    /**
     * warning that this is rounded to the nearest integer
     */
    pageScrollWidth: number;
    /**
     * warning that this is rounded to the nearest integer
     */
    pageScrollHeight: number;
}

export const exampleViewportDetails: ViewportDetails =
    {scrollX: 0, scrollY: 0, width: 0, height: 0, pageScrollWidth: 0, pageScrollHeight: 0}

/**
 * types of one-off messages that might be sent to the service worker, either from the content script or the popup
 */
export enum PageRequestType {
    LOG = "log",
    PRESS_ENTER = "pressEnter",
    HOVER = "hover",
    SCREENSHOT_WITH_TARGET_HIGHLIGHTED = "screenshotWithTargetElementHighlighted",
    EULA_ACCEPTANCE = "eulaAcceptance",
}

/**
 * types of messages that the service worker might send to the side panel (for adding entries to history list, but
 * also for things like monitor mode)
 */
export enum AgentController2PanelPortMsgType {
    AGENT_CONTROLLER_READY = "agentControllerReady",
    TASK_STARTED = "taskStarted",
    ACTION_CANDIDATE = "actionCandidate",
    TASK_HISTORY_ENTRY = "taskHistoryEntry",
    TASK_ENDED = "taskEnded",
    ERROR = "error",//cases where the agent controller wants to tell the side panel about a problem with some message from the side panel which was identified before a task id was generated
    NOTIFICATION = "notification",//for agent notifying side panel of non-critical problem that will delay progress on the task (so the side panel can display that to user in status field and avoid user giving up on system)
    HISTORY_EXPORT = "historyExport"//for when the controller has assembled a Blob for a zip file containing logs and/or screenshots and needs to send it to the side panel so that it can be downloaded to the user's computer
}

/**
 * types of messages that the side panel might send to the service worker
 */
export enum Panel2AgentControllerPortMsgType {
    //specific to agent controller
    START_TASK = "mustStartTask",
    KILL_TASK = "mustKillTask",
    MONITOR_APPROVED = "monitorApproved",
    MONITOR_REJECTED = "monitorRejected",
    //doesn't have to be specific to controller? handling these might be split off from AgentController later
    KEEP_ALIVE = "keepAlive",
    EXPORT_UNAFFILIATED_LOGS = "exportUnaffiliatedLogs"//i.e. logs not affiliated with any task (and so not included in any task's history export zip file)
}

/**
 * types of messages that the content script (mostly the page actor in the content script) might send to the agent
 * controller in the service worker (in the 'background') over their persistent connection
 */
export enum Page2AgentControllerPortMsgType {
    READY = "pageActorContentScriptInitializedAndReady",
    TERMINAL = "pageActorTerminalPageSideError",
    PAGE_STATE = "sendingPageState",
    ACTION_DONE = "actionPerformed"
}

export enum PanelToAnnotationCoordinatorPortMsgType {
    ANNOTATION_DETAILS = "annotationDetails",
}

export enum AnnotationCoordinator2PanelPortMsgType {
    REQ_ANNOTATION_DETAILS = "annotationDetailsRequest",
    ANNOTATED_ACTION_EXPORT = "annotatedActionExport",
    NOTIFICATION = "annotationNotification",
}

export enum Page2AnnotationCoordinatorPortMsgType {
    READY = "dataCollectorContentScriptInitializedAndReady",
    TERMINAL = "dataCollectorTerminalPageSideError",
    PAGE_INFO = "sendingActionInfoAndContext",
}

export enum AnnotationCoordinator2PagePortMsgType {
    REQ_ACTION_DETAILS_AND_CONTEXT = "requestActionDetailsAndContext",
}

/**
 * types of messages that the agent controller in the service worker (in the 'background') might send to the content
 * script over their persistent connection
 */
export enum AgentController2PagePortMsgType {
    REQ_PAGE_STATE = "requestPageState",
    REQ_ACTION = "requestAction",
    HIGHLIGHT_CANDIDATE_ELEM = "highlightCandidateElement",
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

export enum ActionStateChangeSeverity {
    LOW = "LOW",
    MEDIUM = "MEDIUM",
    HIGH = "HIGH"
}


export type ElementData = {
    centerCoords: readonly [number, number],
    description: string,
    tagHead: string,
    /**
     * tL: top-left corner and bR: bottom-right corner
     */
    boundingBox: {
        tLx: number;
        tLy: number;
        bRx: number;
        bRy: number
    },
    /**
     * index/identifier relative to the other interactable elements on the page
     */
    interactivesIndex?: number//populated after the full interactive elements list is created
    xpath: string
    width: number,
    height: number,
    tagName: string,
    element: HTMLElement
}
export type SerializableElementData = Omit<ElementData, 'element'>;
export const exampleSerializableElemData: SerializableElementData = {
    centerCoords: [0, 0], description: "example element", tagHead: "div", boundingBox: {tLx: 0, tLy: 0, bRx: 0, bRy: 0},
    width: 0, height: 0, tagName: "div", xpath: "example xpath"
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
        const valueDesc = value ? ` with value: ${value}` : "";
        return `[${elementData?.tagHead}] ${elementData?.description} -> ${action}${valueDesc}`;
    } else {
        return `Perform element-independent action ${action}`;
    }
}//todo 2 unit tests


export async function sleep(numMs: number) {
    await new Promise(resolve => setTimeout(resolve, numMs));
}

export function renderUnknownValue(val: unknown): string {
    if (val === null) {
        return 'ACTUAL_js_null';
    } else if (val === undefined) {
        return "ACTUAL_js_undefined";
    } else if (typeof val === 'object') {
        if (val instanceof Error) {
            let stackString = val.stack ? val.stack : "no stack available";
            const firstNewlineIndex = stackString.indexOf("\n");
            if (firstNewlineIndex !== -1) {
                stackString = stackString.substring(firstNewlineIndex);
            }//get rid of annoying thing where the error message is repeated at the start of the stack trace string
            return `error type: ${val.name}; message: ${val.message}; stack: ${stackString}`;
        } else {
            return JSON.stringify(val);
        }
    } else {
        return String(val);
    }
}

function processUpdateToModeCache(modeName: string, storedModeValue: unknown, cacheUpdater: (newVal: boolean) => void, logger: Logger) {
    if (typeof storedModeValue === "boolean") {
        cacheUpdater(storedModeValue);
    } else if (typeof storedModeValue !== "undefined") {
        logger.error(`invalid ${modeName} value was inserted into local storage: ${storedModeValue}, ignoring it`);
    }
}

export function setupModeCache(cacheUpdater: (newVal: boolean) => void, modeName: string, storageKeyForMode: string, logger: Logger) {
    if (chrome?.storage?.local) {
        chrome.storage.local.get(storageKeyForMode, (items) => {
            processUpdateToModeCache(modeName, items[storageKeyForMode], cacheUpdater, logger);
        });
        chrome.storage.local.onChanged.addListener((changes: { [p: string]: chrome.storage.StorageChange }) => {
            processUpdateToModeCache(modeName, changes[storageKeyForMode]?.newValue, cacheUpdater, logger);
        });
    }
}

export function base64ToByteArray(base64Data: string): Uint8Array {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

//todo idea- a number of methods implicitly assume/rely-on the enclosing context's mutex being acquired before they're
// called; this assumption could be made explicit and enforced by a helper method that took method name and mutex, then
// logged an error and returned true if the mutex wasn't acquired, or returned false if it was;
// then such sensitive methods would have a 1 line guard at the very start:
// if (guardMethod("someMethodName", this.mutex)) { return; }

