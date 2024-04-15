import {DOMWindow} from "jsdom";

/**
 * @description class with thin wrappers around DOM interaction
 * This is a class so that it can be mocked in unit tests (should reduce complexity/brittleness of mocking in unit tests)
 * It should never have any mutable state
 */
export class DomWrapper {
    //to avoid runtime errors during unit tests from jest/jsdom limitations
    static readonly XPATH_RESULT_1ST_ORDERED_NODE_TYPE = XPathResult ? XPathResult.FIRST_ORDERED_NODE_TYPE : 9;

    private readonly dom: Document;
    private readonly window: Window | DOMWindow;

    constructor(windowToUse: Window | DOMWindow) {
        const {document} = windowToUse;
        this.dom = document;
        this.window = windowToUse;
    }

    /**
     * uses querySelectorAll to find elements in the DOM
     * @param cssSelector The CSS selector to use to find elements
     * @returns array of elements that match the CSS selector;
     *           this is a static view of the elements (not live access that would allow modification)
     */
    fetchElementsByCss = (cssSelector: string): Array<HTMLElement> => {
        return Array.from(this.dom.querySelectorAll(cssSelector));
    }

    /**
     * grabs a single element from the html document by xpath, potentially relative to a context element
     * @param xpath the xpath to use to find the element
     * @param contextElement the element to use as the context/starting-point for the xpath search
     * @returns the first element found by the xpath, or null if no element is found
     */
    grabElementByXpath = (xpath: string, contextElement?: HTMLElement): HTMLElement | null => {
        return this.dom.evaluate(xpath, contextElement ?? this.dom, null,
            DomWrapper.XPATH_RESULT_1ST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLElement;
    }

    /**
     * trivial wrapper around element.innerText because jsdom doesn't support innerText (https://github.com/jsdom/jsdom/issues/1245)
     * and so it has to be mocked in unit tests
     * @param element the element to extract the inner text from
     * @returns the inner text of the element
     */
    getInnerText = (element: HTMLElement): string => {
        return element.innerText;
    }

    /**
     * trivial wrapper around element.getBoundingClientRect() because jsdom doesn't properly support that function
     * (all numbers are 0's) and so it has to be mocked in unit tests
     * @param element the element to grab the bounding rect of
     * @returns the bounding rect of the element
     */
    grabClientBoundingRect = (element: HTMLElement): DOMRect => {
        return element.getBoundingClientRect();
    }

    /**
     * trivial wrapper around window.getComputedStyle because jsdom doesn't support it and so it has to be mocked in unit tests
     * @param element the element whose computed style is needed
     * @returns the computed style of the element
     */
    getComputedStyle = (element: HTMLElement): CSSStyleDeclaration => {
        return this.window.getComputedStyle(element);
    }

    /**
     * @description trivial wrapper around document.documentElement to allow jsdom-based unit tests to work
     * @return the document element
     */
    getDocumentElement = (): HTMLElement => {
        return this.dom.documentElement;
    }

    /**
     * @description trivial wrapper around window.scrollY to allow jsdom-based unit tests to work
     * @return the vertical scroll position of the window
     */
    getVertScrollPos = (): number => {
        return this.window.scrollY;//random note- every browser except safari supports sub-pixel precision for this
    }

    /**
     * @description trivial wrapper around window.scrollBy to allow jsdom-based unit tests to work
     * @param horizOffset the amount to scroll by in the horizontal direction
     *                     positive values scroll right, negative values scroll left
     * @param vertOffset the amount to scroll by in the vertical direction
     *                      positive values scroll down, negative values scroll up
     */
    scrollBy = (horizOffset: number, vertOffset: number): void => {
        this.window.scrollBy(horizOffset, vertOffset);
    }



}