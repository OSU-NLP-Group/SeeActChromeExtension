import {Logger} from "loglevel";

//todo consider breaking large parts of this off into 2 separate files, e.g. for options management in storage

//ms, how long to sleep (after editing an element for highlighting) before telling the service worker to take a
// screenshot; i.e. longest realistic amount of time the browser might take to re-render the modified element
export const elementHighlightRenderDelay = 15;

export enum ActionStateChangeSeverity {
    SAFE = "SAFE",
    LOW = "LOW",
    MEDIUM = "MEDIUM",
    HIGH = "HIGH"
}

export function isActionStateChangeSeverity(severity: unknown): severity is ActionStateChangeSeverity {
    return typeof severity === "string" && Object.values(ActionStateChangeSeverity)
        .includes(severity as ActionStateChangeSeverity);
}

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

export const storageKeyForAutoMonitorThreshold = "autoMonitorThreshold";


export const defaultIsMonitorMode = false;
export const defaultShouldWipeActionHistoryOnStart = true;

export const defaultMaxOps = 50;
export const defaultMaxNoops = 7;
export const defaultMaxFailures = 10;
export const defaultMaxFailureOrNoopStreak = 4;

export const defaultIsAnnotatorMode = true;

export const defaultAutoMonitorThreshold = ActionStateChangeSeverity.LOW;

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


export interface HTMLElementWithDocumentHost extends HTMLElement {
    /**
     * the sequence of <iframe> element(s) (progressing from the innermost one that directly contains the actual
     * element to the outermost one which is a direct child of the real page's Document)
     * which contain the document(s) that this element is nested inside of
     */
    documentHostChain?: HTMLIFrameElement[];
}

/**
 * tL: top-left corner and bR: bottom-right corner
 */
export type BoundingBox = {
    tLx: number;
    tLy: number;
    bRx: number;
    bRy: number
}

export type ElementData = {
    centerCoords: readonly [number, number],
    description: string,
    tagHead: string,

    boundingBox: BoundingBox,
    /**
     * index/identifier relative to the other interactable elements on the page
     */
    interactivesIndex?: number//populated after the full interactive elements list is created
    xpath: string
    width: number,
    height: number,
    tagName: string,
    element: HTMLElementWithDocumentHost
    //todo if element is inside a scrollable context (e.g. a div with overflow auto), this should have info about that
    // context
}
export type SerializableElementData = Omit<ElementData, 'element'>;
export const exampleSerializableElemData: SerializableElementData = {
    centerCoords: [0, 0], description: "example element", tagHead: "div", boundingBox: {tLx: 0, tLy: 0, bRx: 0, bRy: 0},
    width: 0, height: 0, tagName: "div", xpath: "example xpath", interactivesIndex: -1
}

export function isValidBoundingBox(boxVal: unknown): boxVal is BoundingBox {
    return typeof boxVal === "object" && boxVal !== null && "tLx" in boxVal && "tLy" in boxVal && "bRx" in boxVal && "bRy" in boxVal;
}

function getInternalClass(obj: any): string {return Object.prototype.toString.call(obj).slice(8, -1);}

export function isDocument(node: Node | null | undefined): node is Document {
    return node !== null && node != undefined && (
        node instanceof Document || getInternalClass(node) === "Document"
        || ('doctype' in node && 'implementation' in node && 'documentElement' in node)
        || ('defaultView' in node && typeof node.defaultView === "object" && node.defaultView !== null
            && 'document' in node.defaultView && node === node.defaultView.document));
}

export function isShadowRoot(node: Node | null | undefined): node is ShadowRoot {
    return node !== null && node != undefined && (
        node instanceof ShadowRoot || getInternalClass(node) === "ShadowRoot"
        || ((node instanceof DocumentFragment || getInternalClass(node) === "DocumentFragment")
            && 'host' in node && 'mode' in node));
}

const propsAlwaysAndOnlyInHtmlElements = ['style', 'innerText'];
const methodsAlwaysAndOnlyInHtmlElements = ['blur', 'click', 'focus'];
export function isHtmlElement(node: Node | null | undefined): node is HTMLElement {
    if (node === null || node === undefined) { return false; }
    if (node instanceof HTMLElement) { return true; }
    const nodeType = getInternalClass(node);
    if ((nodeType.startsWith("SVG") && nodeType.endsWith("Element")) || nodeType.startsWith("MathML")) { return false; }

    return (nodeType.startsWith("HTML") && nodeType.endsWith("Element"))
        || (propsAlwaysAndOnlyInHtmlElements.every(prop => prop in node)
            && methodsAlwaysAndOnlyInHtmlElements.every(method => typeof (node as any)[method] === "function"));
}

export function isIframeElement(element: HTMLElement): element is HTMLIFrameElement {
    if (element instanceof HTMLIFrameElement || element.tagName.toLowerCase() === "iframe") { return true; }
    const elemType = getInternalClass(element).toLowerCase();
    if (elemType.includes("iframe") && elemType.includes("element")) { return true;}
    try {
        //'data'/'type' checks are to rule out the element being an instance of HTMLObjectElement
        return 'contentDocument' in element && 'contentWindow' in element && !('data' in element || 'type' in element);
    } catch (e: any) {
        return e.name === "SecurityError";
    }
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

export function makeStrSafeForFilename(str: string): string {
    return Array.from(str).map(char => {
        let isCharSafe = true;
        if (char.charCodeAt(0) < 32) { isCharSafe = false}//for control characters and NUL byte
        //for ascii chars that're illegal in filenames in at least one OS, or that're sketchy in filenames, or that are just annoying in file names (i.e. the period)
        if (isCharSafe && [`/`, `<`, `>`, `:`, `"`, `\\`, `|`, `?`, `*`, `#`, `$`, `%`, `!`, `&`, `'`, `{`, `}`, `@`,
            `+`, "`", `=`, `.`, `’`].includes(char)) { isCharSafe = false}
        return isCharSafe ? char : "_";
    }).join("");
}

export function renderTs(tsVal: number|undefined|null): string {
    if (tsVal === undefined || tsVal === null) { return "undefined/null";}
    return new Date(tsVal).toISOString();
}

//todo idea- a number of methods implicitly assume/rely-on the enclosing context's mutex being acquired before they're
// called; this assumption could be made explicit and enforced by a helper method that took method name and mutex, then
// logged an error and returned true if the mutex wasn't acquired, or returned false if it was;
// then such sensitive methods would have a 1 line guard at the very start:
// if (guardMethod("someMethodName", this.mutex)) { return; }
export const scrollFractionOfViewport = 0.80;