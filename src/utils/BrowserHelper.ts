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

    removeAndCollapseEol = (text: string): string => {
        return text.replace("\n", " ").replace(/\s{2,}/g, " ");
    }
}