import log from "loglevel";
import {origLoggerFactory} from "../../src/utils/shared_logging_setup";
import {DomWrapper} from "../../src/utils/DomWrapper";
import {BrowserHelper, ElementData, SerializableElementData} from "../../src/utils/BrowserHelper";
import {JSDOM} from "jsdom";
import {PageActor} from "../../src/utils/PageActor";
import {createMockPort} from "../test_utils";
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


