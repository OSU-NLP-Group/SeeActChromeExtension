import log from "loglevel";
import {origLoggerFactory} from "../../src/utils/shared_logging_setup";
import {DomWrapper} from "../../src/utils/DomWrapper";
import {BrowserHelper} from "../../src/utils/BrowserHelper";
import {DOMWindow, JSDOM} from "jsdom";
import {ActionOutcome, PageActor} from "../../src/utils/PageActor";
import {createMockPort, fixHtmlElementContentEditable} from "../test_utils";
import {ChromeWrapper} from "../../src/utils/ChromeWrapper";
import {
    Action,
    AgentController2PagePortMsgType,
    buildGenericActionDesc, ElementData,
    expectedMsgForPortDisconnection,
    Page2AgentControllerPortMsgType,
    PageRequestType, SerializableElementData
} from "../../src/utils/misc";


const testLogger = log.getLogger("page-actor-test");
testLogger.methodFactory = origLoggerFactory;
testLogger.setLevel("warn");
testLogger.rebuild();

let testWindow: DOMWindow;
let testDom: Document;
let domWrapper: DomWrapper;
let browserHelper: BrowserHelper;
let chromeWrapper: ChromeWrapper;
let pageActor: PageActor;
let mockPort: chrome.runtime.Port;

let actionOutcome: ActionOutcome;

function resetGlobalVars() {
    testWindow = undefined as any;
    testDom = undefined as any;
    domWrapper = undefined as any;
    browserHelper = undefined as any;
    chromeWrapper = undefined as any;
    pageActor = undefined as any;
    mockPort = undefined as any;
    actionOutcome = undefined as any;
}


describe("PageActor.getPageInfoForController", () => {

    let interactElems: ElementData[];
    let sampleSerializableElements: SerializableElementData[];

    beforeEach(() => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div class="c-form-item c-form-item--text c-form-item--id-keyword js-form-item js-form-type-textfield js-form-item-keyword">
            <label for="edit-keyword" class="c-form-item__label">Search</label>
            <input placeholder="Search (by City/Location, Zip Code or Name)" data-drupal-selector="edit-keyword" 
            type="text" id="edit-keyword" name="keyword" value="" size="30" maxlength="128" class="c-form-item__text">
            <button id="submit_search" type="submit">Submit</button>
        </div></body>`);
        domWrapper = new DomWrapper(window);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        mockPort = createMockPort();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);

        const inputElement = domWrapper.grabElementByXpath("//input") as HTMLElement;
        const buttonElement = domWrapper.grabElementByXpath("//button") as HTMLElement;
        interactElems = [{
            centerCoords: [150, 20],
            description: 'INPUT_VALUE="" parent_node: [<Search>] name="keyword" placeholder="Search (by City/Location, Zip Code or Name)" value=""',
            tagHead: 'input type="text"', boundingBox: {tLx: 50, tLy: 5, bRx: 250, bRy: 35}, tagName: "input",
            element: inputElement
        }, {
            centerCoords: [140, 60], description: "Submit", tagHead: 'button type="submit"',
            boundingBox: {tLx: 120, tLy: 50, bRx: 160, bRy: 70}, tagName: "button", element: buttonElement
        }];
        //doing the copy-serializable-properties-one-by-one approach here b/c test will fail if I forget to add a copy step for a new serializable property
        sampleSerializableElements = [{
            centerCoords: interactElems[0].centerCoords, description: interactElems[0].description, tagHead:
            interactElems[0].tagHead, boundingBox: interactElems[0].boundingBox, tagName: interactElems[0].tagName
        }, {
            centerCoords: interactElems[1].centerCoords, description: interactElems[1].description, tagHead:
            interactElems[1].tagHead, boundingBox: interactElems[1].boundingBox, tagName: interactElems[1].tagName
        }];

    });

    afterEach(() => {resetGlobalVars();});

    it("should send interactive elements to controller when they can be found", () => {
        browserHelper.getInteractiveElements = jest.fn().mockReturnValue(interactElems);

        pageActor.getPageInfoForController();

        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {msg: Page2AgentControllerPortMsgType.PAGE_STATE, interactiveElements: sampleSerializableElements});
    });

    it("should not send interactive elements to controller when they already exist", () => {
        pageActor.interactiveElements = interactElems;

        pageActor.getPageInfoForController();

        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {msg: Page2AgentControllerPortMsgType.TERMINAL, error: "interactive elements already exist"});
    });

    it("should handle routine error when sending interactive elements to controller", () => {
        browserHelper.getInteractiveElements = jest.fn().mockReturnValue(interactElems);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- message is irrelevant to mock implementation
        mockPort.postMessage = jest.fn().mockImplementation((message: any) => {
            throw new Error(expectedMsgForPortDisconnection);
        });
        jest.spyOn(testLogger, 'info');

        pageActor.getPageInfoForController();

        expect(testLogger.info)
            .toHaveBeenCalledWith("service worker disconnected from content script while content script was gathering interactive elements (task was probably terminated by user)");
    });

    it("should handle unexpected error when sending interactive elements to controller", () => {
        browserHelper.getInteractiveElements = jest.fn().mockReturnValue([interactElems]);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- message is irrelevant to mock implementation
        mockPort.postMessage = jest.fn().mockImplementation((message: any) => {
            throw new Error("some strange chrome error");
        });
        jest.spyOn(testLogger, 'error');

        pageActor.getPageInfoForController();

        expect(testLogger.error)
            .toHaveBeenCalledWith("unexpected error in content script while sending interactive elements to service worker; error: Error: some strange chrome error, jsonified: {}");
    });
});

describe('PageActor.typeIntoElement', () => {

    const testStr = "some input string";

    beforeEach(() => {
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        fixHtmlElementContentEditable(testWindow);
        testDom = testWindow.document;
        mockPort = createMockPort();
        domWrapper = new DomWrapper(testWindow);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);

        actionOutcome = {success: false, result: ""};
    });

    afterEach(() => {resetGlobalVars();});

    it('should type into an input element', () => {
        const inputElem = testDom.createElement('input');
        jest.spyOn(inputElem, 'focus');
        const baseActResult = "[input] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(inputElem, testStr, actionOutcome)).toEqual(testStr);
        expect(inputElem.value).toBe(testStr);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult);
        expect(inputElem.focus).toHaveBeenCalled();
    });

    it('should type into a textarea element', () => {
        const textareaElem: HTMLTextAreaElement = testDom.createElement('textarea');
        jest.spyOn(textareaElem, 'focus');
        const baseActResult = "[textarea] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(textareaElem, testStr, actionOutcome)).toEqual(testStr);
        expect(textareaElem.value).toBe(testStr);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult);
        expect(textareaElem.focus).toHaveBeenCalled();
    });

    it('should type into a contenteditable element', () => {
        testWindow = new JSDOM(`<!DOCTYPE html><body>
        <div contenteditable="true" id="editableField">
            some initial text
        </div></body>`).window;
        fixHtmlElementContentEditable(testWindow);
        domWrapper = new DomWrapper(testWindow);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);
        const divElem = domWrapper.grabElementByXpath("//div") as HTMLElement;

        jest.spyOn(divElem, 'focus');
        const baseActResult = "[div] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(divElem, testStr, actionOutcome)).toEqual(testStr);
        expect(divElem.textContent).toBe(testStr);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult);
        expect(divElem.focus).toHaveBeenCalled();
    });

    it('should report its inability to type into a non-input, non-textarea, non-contenteditable element', () => {
        const divElem = testDom.createElement('div');
        jest.spyOn(divElem, 'click');
        const baseActResult = "[div] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(divElem, "test", actionOutcome)).toBeNull();
        expect(divElem.textContent).toBe("");
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActResult + "; element is not an input, textarea, or contenteditable element; can't type in it. Tried clicking with js instead");
        expect(divElem.click).toHaveBeenCalled();
    });

    it('should handle undefined value for TYPE action', () => {
        const inputElem = testDom.createElement('input');
        inputElem.value = "some initial value";
        jest.spyOn(inputElem, 'focus');
        const baseActResult = "[input] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(inputElem, undefined, actionOutcome)).toEqual("");
        expect(inputElem.value).toBe("");
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult + "; used empty string as default for 'value'");
        expect(inputElem.focus).toHaveBeenCalled();
    });

    it('should handle element already having the desired text', () => {
        const inputElem = testDom.createElement('input');
        jest.spyOn(inputElem, 'focus');
        inputElem.value = testStr;
        const baseActResult = "[input] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(inputElem, testStr, actionOutcome)).toEqual(testStr);
        expect(inputElem.value).toBe(testStr);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult + "; element already has the desired text");
        expect(inputElem.focus).toHaveBeenCalled();
    });

    it('should handle element text not being changed by typing', () => {
        const textareaElem = testDom.createElement('textarea');
        const initialValue = "some existing text";
        textareaElem.value = initialValue;
        jest.spyOn(textareaElem, 'focus');
        browserHelper.getElementText = jest.fn().mockReturnValueOnce(initialValue).mockReturnValueOnce(initialValue);
        const baseActResult = "[textarea] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(textareaElem, testStr, actionOutcome)).toEqual(initialValue);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(`${baseActResult}; element text [<${initialValue}>] not changed by typing`);
        expect(textareaElem.focus).toHaveBeenCalled();
    });

    it('should handle element text after typing not exactly matching requested value', () => {
        const inputElem = testDom.createElement('input');
        inputElem.type = "number";
        inputElem.value = "8";
        jest.spyOn(inputElem, 'focus');
        const crazyInputStr = "inappropriate input string 9";
        const actualResultStr = "";
        browserHelper.getElementText = jest.fn().mockReturnValueOnce("8").mockReturnValueOnce(actualResultStr);
        const baseActResult = "[input] some description -> TYPE with value: " + crazyInputStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(inputElem, crazyInputStr, actionOutcome)).toEqual(actualResultStr);
        expect(inputElem.value).toEqual(actualResultStr);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(`${baseActResult}; after typing, element text: [<${actualResultStr}>] still doesn't match desired value`);
        expect(inputElem.focus).toHaveBeenCalled();
    });
});

describe('PageActor.performSelectAction', () => {


    beforeEach(() => {
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        testDom = testWindow.document;
        mockPort = createMockPort();
        domWrapper = new DomWrapper(testWindow);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);

        actionOutcome = {success: false, result: ""};
    });

    afterEach(() => {resetGlobalVars();});

    it('should reject if value undefined', () => {
        const selectElem = testDom.createElement('select');
        const baseActResult = "[select] some description -> SELECT with value: undefined";
        actionOutcome.result = baseActResult;
        expect(pageActor.performSelectAction(undefined, selectElem, actionOutcome)).toBeUndefined();
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActResult + "; no value provided for SELECT action, so cannot perform it");
    });

    it('should reject if element is not a select element', () => {
        const divElem = testDom.createElement('div');
        const baseActResult = "[div] some description -> SELECT with value: test";
        actionOutcome.result = baseActResult;
        expect(pageActor.performSelectAction("test", divElem, actionOutcome)).toBeUndefined();
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActResult + "; SELECT action given for non <select> element, so cannot perform it");
    });

    it('should report success if exact match between value and some option', () => {
        const selectElem = testDom.createElement('select');
        const optionElem = testDom.createElement('option');
        optionElem.value = "test";
        selectElem.appendChild(optionElem);
        browserHelper.selectOption = jest.fn().mockReturnValue("test");
        const baseActResult = "[select] some description -> SELECT with value: test";
        actionOutcome.result = baseActResult;
        expect(pageActor.performSelectAction("test", selectElem, actionOutcome)).toEqual("test");
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult + "; select succeeded");
    });

    it('should report success if partial match between value and some option', () => {
        const selectElem = testDom.createElement('select');
        const optionElem = testDom.createElement('option');
        optionElem.value = "test";
        selectElem.appendChild(optionElem);
        browserHelper.selectOption = jest.fn().mockReturnValue("test");
        const baseActResult = "[select] some description -> SELECT with value: te";
        actionOutcome.result = baseActResult;
        expect(pageActor.performSelectAction("te", selectElem, actionOutcome)).toEqual("test");
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActResult + "; selected most-similar option [<test>]");
    });

    it('should reject if no match between value and any option', () => {
        const selectElem = testDom.createElement('select');
        browserHelper.selectOption = jest.fn().mockReturnValue(undefined);
        const baseActResult = "[select] some description -> SELECT with value: wrong";
        actionOutcome.result = baseActResult;
        expect(pageActor.performSelectAction("wrong", selectElem, actionOutcome)).toBeUndefined();
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActResult + "; failed to select any option similar to the given value");
    });
})

describe('PageActor.performScrollAction', () => {

    beforeEach(() => {
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        testDom = testWindow.document;
        mockPort = createMockPort();
        domWrapper = new DomWrapper(testWindow);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);
        const fakeDocumentElement = {
            ...testDom.documentElement,
            clientHeight: 500,
            scrollHeight: 1500
        }
        domWrapper.getDocumentElement = jest.fn().mockReturnValue(fakeDocumentElement);

        actionOutcome = {success: false, result: ""};
    });

    afterEach(() => {resetGlobalVars();});

    it('should report failure if SCROLL_UP but already at top of window', async () => {
        domWrapper.getVertScrollPos = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(0);
        domWrapper.scrollBy = jest.fn();
        const baseActionResult = "Performed element-independent action SCROLL_UP";
        actionOutcome.result = baseActionResult;
        await pageActor.performScrollAction(Action.SCROLL_UP, actionOutcome);
        expect(domWrapper.scrollBy).toHaveBeenCalledWith(0, -375);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActionResult + "; scroll action failed to move the viewport's vertical position from 0px");
    });

    it('should report success if SCROLL_UP and not at top of window', async () => {
        domWrapper.getVertScrollPos = jest.fn().mockReturnValueOnce(374).mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        domWrapper.scrollBy = jest.fn();
        const baseActionResult = "Performed element-independent action SCROLL_UP";
        actionOutcome.result = baseActionResult;
        await pageActor.performScrollAction(Action.SCROLL_UP, actionOutcome);
        expect(domWrapper.scrollBy).toHaveBeenCalledWith(0, -375);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActionResult + "; scrolled page by 374px up");
    });

    it('should report failure if SCROLL_DOWN but already at bottom of window', async () => {
        domWrapper.getVertScrollPos = jest.fn().mockReturnValueOnce(1500).mockReturnValueOnce(1500);
        domWrapper.scrollBy = jest.fn();
        const baseActionResult = "Performed element-independent action SCROLL_DOWN";
        actionOutcome.result = baseActionResult;
        await pageActor.performScrollAction(Action.SCROLL_DOWN, actionOutcome);
        expect(domWrapper.scrollBy).toHaveBeenCalledWith(0, 375);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toEqual(baseActionResult + "; scroll action failed to move the viewport's vertical position from 1500px");
    });

    it('should report success if SCROLL_DOWN and not at bottom of window', async () => {
        domWrapper.getVertScrollPos = jest.fn().mockReturnValueOnce(1125).mockReturnValueOnce(1500)
            .mockReturnValueOnce(1500);
        domWrapper.scrollBy = jest.fn();
        const baseActionResult = "Performed element-independent action SCROLL_DOWN";
        actionOutcome.result = baseActionResult;
        await pageActor.performScrollAction(Action.SCROLL_DOWN, actionOutcome);
        expect(domWrapper.scrollBy).toHaveBeenCalledWith(0, 375);
        expect(actionOutcome.success).toBe(true);
        expect(actionOutcome.result).toEqual(baseActionResult + "; scrolled page by 375px down");
    });
});

describe('PageActor.performPressEnterAction', () => {
    let targetElementDesc: string;

    beforeEach(() => {
        actionOutcome = {success: false, result: ""};
        targetElementDesc = "some description";
        chromeWrapper = new ChromeWrapper();
        const mockPort = createMockPort();
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        const domWrapper = new DomWrapper(testWindow);
        const browserHelper = new BrowserHelper(domWrapper, testLogger);
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);
    });

    afterEach(() => {resetGlobalVars();});

    it('should report success if service worker responds with success', async () => {
        chromeWrapper.sendMessageToServiceWorker = jest.fn().mockResolvedValue({success: true});
        await pageActor.performPressEnterAction(actionOutcome, targetElementDesc);
        expect(actionOutcome.success).toBe(true);
    });

    it('should report failure if service worker responds with failure', async () => {
        const errorMessage = "service worker failure";
        chromeWrapper.sendMessageToServiceWorker = jest.fn().mockResolvedValue({success: false, message: errorMessage});
        await pageActor.performPressEnterAction(actionOutcome, targetElementDesc);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result).toContain(errorMessage);
    });

    it('should handle error when asking service worker to press enter', async () => {
        const errorMessage = "some error";
        chromeWrapper.sendMessageToServiceWorker = jest.fn().mockRejectedValue(new Error(errorMessage));
        await pageActor.performPressEnterAction(actionOutcome, targetElementDesc);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result)
            .toContain(`error while asking service worker to press enter: Error: ${errorMessage}`);
    });
});

describe('PageActor.performActionFromController', () => {
    let interactiveElems: ElementData[] = [];

    beforeEach(() => {
        actionOutcome = {success: false, result: ""};
        chromeWrapper = new ChromeWrapper();
        mockPort = createMockPort();
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        testDom = testWindow.document;
        domWrapper = new DomWrapper(testWindow);
        domWrapper.scrollBy = jest.fn();
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);

        const inputElem = testDom.createElement('input');
        inputElem.dispatchEvent = jest.fn();//jsdom doesn't support
        const selectElem = testDom.createElement('select');
        selectElem.dispatchEvent = jest.fn();//jsdom doesn't support
        const optionElem = testDom.createElement('option');
        optionElem.value = "option1";
        selectElem.appendChild(optionElem);
        domWrapper.getInnerText = jest.fn().mockReturnValue("option1");
        const linkElem = testDom.createElement("a");
        interactiveElems = [
            {
                element: inputElem, tagHead: "input", description: "some input elem",
                centerCoords: [15, 100],
                boundingBox: {tLx: 10, tLy: 85, bRx: 20, bRy: 115},
                tagName: "input"
            },
            {
                element: selectElem, tagHead: "select", description: "some select elem",
                centerCoords: [325, 460],
                boundingBox: {tLx: 300, tLy: 410, bRx: 350, bRy: 510},
                tagName: "select"
            },
            {
                element: linkElem, tagHead: "a", description: "some link elem",
                centerCoords: [150, 20],
                boundingBox: {tLx: 100, tLy: 5, bRx: 200, bRy: 35},
                tagName: "a"
            }
        ];

    });

    afterEach(() => {resetGlobalVars();});

    it('should handle currInteractiveElements being undefined', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.CLICK, elementIndex: 0};
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {msg: Page2AgentControllerPortMsgType.TERMINAL, error: "no interactive elements stored to be acted on"});
    });

    it('should type into a specific element', async () => {
        const typingVal = "test";
        const message =
            {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.TYPE, elementIndex: 0, value: typingVal};
        pageActor.interactiveElements = interactiveElems;
        await pageActor.performActionFromController(message);
        expect((interactiveElems[0].element as HTMLInputElement).value).toEqual(typingVal);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: buildGenericActionDesc(Action.TYPE, interactiveElems[0], typingVal)
            });
    });

    it('should click a specific element', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.CLICK, elementIndex: 2};
        pageActor.interactiveElements = interactiveElems;
        const clickSpy = jest.spyOn(interactiveElems[2].element, 'click');
        await pageActor.performActionFromController(message);
        expect(clickSpy).toHaveBeenCalled();
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: buildGenericActionDesc(Action.CLICK, interactiveElems[2]) + "; clicked element with js"
            });
    });

    it('should select a specific option in a select element', async () => {
        const selectVal = "option1";
        const message =
            {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.SELECT, elementIndex: 1, value: selectVal};
        pageActor.interactiveElements = interactiveElems;
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: buildGenericActionDesc(Action.SELECT, interactiveElems[1], selectVal) + "; select succeeded"
            });
    });

    it('should press enter on a specific element', async () => {
        const message =
            {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.PRESS_ENTER, elementIndex: 0};
        pageActor.interactiveElements = interactiveElems;
        const mockOfSendMsgToServWorker = jest.fn().mockResolvedValue({success: true});
        chromeWrapper.sendMessageToServiceWorker = mockOfSendMsgToServWorker;
        await pageActor.performActionFromController(message);
        expect(mockOfSendMsgToServWorker).toHaveBeenCalledWith({reqType: PageRequestType.PRESS_ENTER});
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: buildGenericActionDesc(Action.PRESS_ENTER, interactiveElems[0])
            });
    });

    it('should handle unknown action for a specific element', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.SCROLL_DOWN, elementIndex: 0};
        pageActor.interactiveElements = interactiveElems;
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: false,
                result: buildGenericActionDesc(Action.SCROLL_DOWN, interactiveElems[0]) + "; action type not supported for a specific element: SCROLL_DOWN"
            });
    });

    it('should handle SCROLL_UP action without a specific element', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.SCROLL_UP};
        pageActor.interactiveElements = interactiveElems;
        domWrapper.getVertScrollPos = jest.fn().mockReturnValueOnce(374).mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: "Performed element-independent action SCROLL_UP; scrolled page by 374px up"
            });
    });

    it('should handle PRESS_ENTER action without a specific element', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.PRESS_ENTER};
        pageActor.interactiveElements = interactiveElems;
        chromeWrapper.sendMessageToServiceWorker = jest.fn().mockResolvedValue({success: true});
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: true,
                result: "Performed element-independent action PRESS_ENTER"
            });
    });

    it('should handle unknown action without a specific element', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.SELECT};
        pageActor.interactiveElements = interactiveElems;
        await pageActor.performActionFromController(message);
        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {
                msg: Page2AgentControllerPortMsgType.ACTION_DONE, success: false,
                result: buildGenericActionDesc(Action.SELECT) + "; no element index provided in message from background script; can't perform action SELECT"
            }
        );
    });

    it('should handle standard port disconnected error when sending confirmation to controller', async () => {
        const message =
            {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.TYPE, elementIndex: 0, value: "some string"};
        pageActor.interactiveElements = interactiveElems;
        mockPort.postMessage = jest.fn().mockImplementation(
            () => {throw new Error(expectedMsgForPortDisconnection);});
        jest.spyOn(testLogger, 'info');
        await pageActor.performActionFromController(message);
        expect(testLogger.info)
            .toHaveBeenCalledWith("service worker disconnected from content script while content script was performing action (task was probably terminated by user)");
    });

    it('should handle unexpected error when sending confirmation to controller', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.CLICK, elementIndex: 2};
        pageActor.interactiveElements = interactiveElems;
        mockPort.postMessage = jest.fn().mockImplementation(
            () => {throw new Error("some strange chrome error");});
        jest.spyOn(testLogger, 'error');
        await pageActor.performActionFromController(message);
        expect(testLogger.error)
            .toHaveBeenCalledWith("unexpected error in content script while notifying service worker about performed action; error: Error: some strange chrome error, jsonified: {}");
    });


});

describe('PageActor.handleRequestFromAgentController', () => {

    beforeEach(() => {
        mockPort = createMockPort();
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        domWrapper = new DomWrapper(testWindow);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper, domWrapper);
    });

    afterEach(() => {resetGlobalVars();});

    it('should handle request for page state', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_PAGE_STATE};
        pageActor.getPageInfoForController = jest.fn();
        await pageActor.handleRequestFromAgentController(message);
        expect(pageActor.getPageInfoForController).toHaveBeenCalled();
    });

    it('should handle request for a specific action', async () => {
        const message = {msg: AgentController2PagePortMsgType.REQ_ACTION, action: Action.CLICK, elementIndex: 0};
        pageActor.performActionFromController = jest.fn();
        await pageActor.handleRequestFromAgentController(message);
        expect(pageActor.performActionFromController).toHaveBeenCalledWith(message);
    });

    it('should handle request with unrecognized message type', async () => {
        const message = {msg: 'UNRECOGNIZED'};
        jest.spyOn(testLogger, 'warn');
        await pageActor.handleRequestFromAgentController(message);
        expect(testLogger.warn)
            .toHaveBeenCalledWith("unknown message from background script: " + JSON.stringify(message));
    });
});


