/**
 * @description class with thin wrappers around DOM interaction
 * This is a class so that it can be mocked in unit tests
 */
export class DomHelper {
    //to avoid runtime errors during unit tests from jest/jsdom limitations
    static readonly XPATH_RESULT_1ST_ORDERED_NODE_TYPE = XPathResult ? XPathResult.FIRST_ORDERED_NODE_TYPE : 9;

    private dom: Document;

    constructor(domToUse: Document) {
        this.dom = domToUse;
    }

    /**
     * uses querySelectorAll to find elements in the DOM
     * @param cssSelector The CSS selector to use to find elements
     * @returns array of elements that match the CSS selector;
     *           this is a static view of the elements (not live access that would allow modification)
     */
    fetchElementsByCss = (cssSelector: string): NodeListOf<HTMLElement> => {
        return this.dom.querySelectorAll(cssSelector);
    }

    /**
     * grabs a single element from the html document by xpath, potentially relative to a context element
     * @param xpath the xpath to use to find the element
     * @param contextElement the element to use as the context/starting-point for the xpath search
     * @returns the first element found by the xpath, or null if no element is found
     */
    grabElementByXpath = (xpath: string, contextElement?: HTMLElement): HTMLElement | null => {
        return this.dom.evaluate(xpath, contextElement ?? this.dom, null,
            DomHelper.XPATH_RESULT_1ST_ORDERED_NODE_TYPE, null)
            .singleNodeValue as HTMLElement;
    }
}

export class BrowserHelper {

    //for dependency injection in unit tests
    private domHelper: DomHelper;

    constructor(domHelper?: DomHelper) {
        this.domHelper = domHelper ?? new DomHelper(document);
    }

    /**
     * @description converts line breaks to spaces and collapse multiple consecutive whitespace characters into a single space
     * This handles carriage-returns in addition to line feeds, unlike remove_extra_eol from browser_helper.py
     * @param text the text to process
     * @return string without any newlines or consecutive whitespace characters
     */
    removeEolAndCollapseWhitespace = (text: string): string => {
        return text.replace(/[\r\n]/g, " ").replace(/\s{2,}/g, " ");
    }

    /**
     * @description Get up to 8 whitespace-separated segments of the first line of a multi-line text
     * @param text the text to process, possibly containing line breaks
     * @return up to 8 whitespace-separated segments of the first line of the text
     */
    getFirstLine = (text: string): string => {
        const firstLine = text.split(/[\r\n]/, 1)[0];
        const firstLineSegments = firstLine.split(/\s+/);
        if (firstLineSegments.length <= 8) {
            return firstLine;
        } else {
            return firstLineSegments.slice(0, 8).join(" ") + "...";
        }
    }

    /**
     * @description Get a one-line description of an element, with special logic for certain types of elements
     * and some ability to fall back on information from parent element or first child element
     * @param element the element to describe
     * @return a one-line description of the element
     */
    getElementDescription = async (element: HTMLElement): Promise<string> => {
        const tagName = element.tagName.toLowerCase();
        const roleValue = element.getAttribute("role");
        const typeValue = element.getAttribute("type");

        //todo implement
        return "dummy";
    }
}