import log from "loglevel";
import {origLoggerFactory} from "../../src/utils/shared_logging_setup";
import {DomWrapper} from "../../src/utils/DomWrapper";
import {BrowserHelper, ElementData, SerializableElementData} from "../../src/utils/BrowserHelper";
import {JSDOM, DOMWindow} from "jsdom";
import {ActionOutcome, PageActor} from "../../src/utils/PageActor";
import {createMockPort, fixHtmlElementContentEditable} from "../test_utils";
import {ChromeWrapper} from "../../src/utils/ChromeWrapper";
import {expectedMsgForPortDisconnection, Page2BackgroundPortMsgType} from "../../src/utils/misc";


const testLogger = log.getLogger("page-actor-test");
testLogger.methodFactory = origLoggerFactory;
testLogger.setLevel("warn");
testLogger.rebuild();

describe("PageActor.getPageInfoForController", () => {
    let domWrapper: DomWrapper;
    let browserHelper: BrowserHelper;
    let chromeWrapper: ChromeWrapper;
    let pageActor: PageActor;
    let mockPort: chrome.runtime.Port;

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
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper);

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

    it("should send interactive elements to controller when they can be found", () => {
        browserHelper.getInteractiveElements = jest.fn().mockReturnValue(interactElems);

        pageActor.getPageInfoForController();

        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {msg: Page2BackgroundPortMsgType.PAGE_STATE, interactiveElements: sampleSerializableElements});
    });

    it("should not send interactive elements to controller when they already exist", () => {
        pageActor.currInteractiveElements = interactElems;

        pageActor.getPageInfoForController();

        expect(mockPort.postMessage).toHaveBeenCalledWith(
            {msg: Page2BackgroundPortMsgType.TERMINAL, error: "interactive elements already exist"});
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
    let pageActor: PageActor;
    let domWrapper: DomWrapper;
    let browserHelper: BrowserHelper;
    let chromeWrapper: ChromeWrapper;
    let testWindow: DOMWindow;
    let document: Document;
    let mockPort: chrome.runtime.Port;

    const testStr = "some input string";
    let actionOutcome: ActionOutcome;

    beforeEach(() => {
        testWindow = new JSDOM(`<!DOCTYPE html><body></body>`).window;
        fixHtmlElementContentEditable(testWindow);
        document = testWindow.document;
        mockPort = createMockPort();
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        chromeWrapper = new ChromeWrapper();
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper);

        actionOutcome = { success: false, result: "" };
    });

    it('should type into an input element', () => {
        const inputElem = document.createElement('input');
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
        const textareaElem: HTMLTextAreaElement = document.createElement('textarea');
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
        pageActor = new PageActor(mockPort, browserHelper, testLogger, chromeWrapper);
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
        const divElem = document.createElement('div');
        jest.spyOn(divElem, 'click');
        const baseActResult = "[div] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(divElem, "test", actionOutcome)).toBeNull();
        expect(divElem.textContent).toBe("");
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result).toEqual(baseActResult + "; element is not an input, textarea, or contenteditable element; can't type in it. Tried clicking with js instead");
        expect(divElem.click).toHaveBeenCalled();
    });

    it('should handle undefined value for TYPE action', () => {
        const inputElem = document.createElement('input');
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
        const inputElem = document.createElement('input');
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
        const textareaElem = document.createElement('textarea');
        const initialValue = "some existing text";
        textareaElem.value = initialValue;
        jest.spyOn(textareaElem, 'focus');
        browserHelper.getElementText = jest.fn().mockReturnValueOnce(initialValue).mockReturnValueOnce(initialValue);
        const baseActResult = "[textarea] some description -> TYPE with value: " + testStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(textareaElem, testStr, actionOutcome)).toEqual(initialValue);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result).toEqual(`${baseActResult}; element text [<${initialValue}>] not changed by typing`);
        expect(textareaElem.focus).toHaveBeenCalled();
    });

    it('should handle element text after typing not exactly matching requested value', () => {
        const inputElem = document.createElement('input');
        inputElem.type= "number";
        inputElem.value="8";
        jest.spyOn(inputElem, 'focus');
        const crazyInputStr = "inappropriate input string 9";
        const actualResultStr = "";
        browserHelper.getElementText = jest.fn().mockReturnValueOnce("8").mockReturnValueOnce(actualResultStr);
        const baseActResult = "[input] some description -> TYPE with value: " + crazyInputStr;
        actionOutcome.result = baseActResult;
        expect(pageActor.typeIntoElement(inputElem, crazyInputStr, actionOutcome)).toEqual(actualResultStr);
        expect(inputElem.value).toEqual(actualResultStr);
        expect(actionOutcome.success).toBe(false);
        expect(actionOutcome.result).toEqual(`${baseActResult}; after typing, element text: [<${actualResultStr}>] still doesn't match desired value`);
        expect(inputElem.focus).toHaveBeenCalled();
    });
});



