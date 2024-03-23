export type ElementFetcher = (dom: Document, cssSelector: string) => NodeListOf<HTMLElement>;

export class BrowserHelper {

    /**
     * Default implementation of the element fetcher, which uses querySelectorAll to find elements in the DOM
     * @param dom The document object model to search
     * @param cssSelector The CSS selector to use to find elements
     * @returns array of elements that match the CSS selector;
     *           this is a static view of the elements (not live access that would allow modification)
     */
    private static readonly defaultElementFetcher: ElementFetcher = (dom: Document, cssSelector: string) => {
        return dom.querySelectorAll(cssSelector);
    }
    //exists solely for dependency injection in unit tests
    private elementFetcher: ElementFetcher;

    constructor(htmlFetcher?: ElementFetcher) {
        this.elementFetcher = htmlFetcher ?? BrowserHelper.defaultElementFetcher;
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
        return "todo";
    }
}