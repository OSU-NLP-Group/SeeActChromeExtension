import getXPath from "get-xpath";
import {createNamedLogger} from "./shared_logging_setup";
import {DomWrapper} from "./DomWrapper";
import log from "loglevel";
import * as fuzz from "fuzzball";
import {
    ElementData,
    elementHighlightRenderDelay,
    HTMLElementWithDocumentHost,
    renderUnknownValue,
    SerializableElementData,
    sleep
} from "./misc";
import {IframeNode, IframeTree} from "./IframeTree";

export function makeElementDataSerializable(elementData: ElementData): SerializableElementData {
    const serializableElementData: SerializableElementData = {...elementData};
    if ('element' in serializableElementData) {
        delete serializableElementData.element;
    }//ugly, but avoids forgetting to add another copying here if serializable fields are added to ElementData
    return serializableElementData;
}

//todo consider renaming this to HtmlHelper or HtmlElementHelper if I create a ChromeHelper class for accessing
// browser api's
export class BrowserHelper {

    //for dependency injection in unit tests
    private domHelper: DomWrapper;

    readonly logger;

    private highlightedElementOriginalOutline: string | undefined;
    private highlightedElementStyle: CSSStyleDeclaration | undefined;

    private cachedIframeTree: IframeTree | undefined;

    constructor(domHelper?: DomWrapper, loggerToUse?: log.Logger) {
        this.domHelper = domHelper ?? new DomWrapper(window);

        this.logger = loggerToUse ?? createNamedLogger('browser-helper', false);
    }

    resetElementAnalysis() {
        this.cachedIframeTree = undefined;
    }

    /**
     * @description Gets the text content of an element, or the value of an input or textarea element
     * @param elementToActOn the element whose text or value is to be retrieved
     * @return the text content of the element, or the value of an input or textarea element
     */
    getElementText = (elementToActOn: HTMLElement): string | null => {
        let priorElementText = elementToActOn.textContent;
        if (elementToActOn instanceof HTMLInputElement || elementToActOn instanceof HTMLTextAreaElement
            || ('value' in elementToActOn && typeof (elementToActOn.value) === 'string')) {
            priorElementText = (elementToActOn.value as string | null) ?? elementToActOn.textContent;
        }
        return priorElementText;
    }

    /**
     * @description Select an option from a select element, based on the option's name or an approximation of it
     * @param selectElement the select element to select an option from
     * @param optionName the name (or an approximation of the name) of the option element to select
     * @return the name/innertext of the option element which was selected
     */
    selectOption = (selectElement: HTMLElement, optionName: string): string | undefined => {
        let bestOptIndex = -1;
        let bestOptVal = undefined;//in case it's important, for some <select>, to be able to choose an option whose innertext is the empty string
        let bestOptSimilarity = -1;
        //todo idea for later- we might want to initialize bestOptSimilarity at some value above 0 (e.g. 0.3), to avoid
        // selecting an option with negligible similarity to the requested option name in a scenario where the AI got
        // really confused and gave a completely wrong value for the chosen select element?
        // confer with Boyuan; & should check what the similarity values look like in practice for good vs bad elements

        const selectElem = selectElement as HTMLSelectElement;

        console.time("timeFor_selectOptionFuzzyStringCompares");
        for (let optIndex = 0; optIndex < selectElem.options.length; optIndex++) {
            this.logger.trace("Comparing option #" + optIndex + " against " + optionName);
            const currOptVal = this.domHelper.getInnerText(selectElem.options[optIndex]);
            const similarity = fuzz.ratio(optionName, currOptVal);
            if (similarity > bestOptSimilarity) {
                this.logger.debug(`For requested option name ${optionName}, found better option ${currOptVal} with similarity ${similarity} at index ${optIndex}, beating prior best option ${bestOptVal} with similarity ${bestOptSimilarity} at index ${bestOptIndex}`);
                bestOptIndex = optIndex;
                bestOptVal = currOptVal;
                bestOptSimilarity = similarity;
            }
        }
        console.timeEnd("timeFor_selectOptionFuzzyStringCompares");
        selectElem.selectedIndex = bestOptIndex;
        this.logger.trace("sending change event to select element");
        selectElem.dispatchEvent(new Event('input', {bubbles: true}));
        selectElem.dispatchEvent(new Event('change', {bubbles: true}));

        return bestOptVal;
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
    getElementDescription = (element: HTMLElement): string | null => {
        const tagName = element.tagName.toLowerCase();
        const roleValue = element.getAttribute("role");
        const typeValue = element.getAttribute("type");

        const salientAttributes = ["alt", "aria-describedby", "aria-label", "aria-role", "input-checked",
            "label", "name", "option_selected", "placeholder", "readonly", "text-value", "title", "value",
            "aria-keyshortcuts"];

        let parentValue = "";
        let parent = element.parentElement;
        const parentNode = element.parentNode;//possible shadow root
        if (parentNode && parentNode instanceof ShadowRoot) {
            //this.logger.trace(`Parent node of current element is a shadow root, so getting host of shadow root as the real parent of current element; inner html of parent node which is a shadow-root: ${parentNode.innerHTML}`)
            parent = parentNode.host as HTMLElement;
            //this.logger.trace(`inner html of parent of shadow root: ${parent.innerHTML}`);
        }
        //it's awkward that this 'first line' sometimes includes the innerText of elements below the main element (shown in a test case)
        // could get around that with parent.textContent and removing up to 1 linefeed at the start of it, for the
        // scenario where a label was the first child and there was a linefeed before the label element's text
        const parentText = parent ? this.domHelper.getInnerText(parent) : "";
        const parentFirstLine = this.removeEolAndCollapseWhitespace(this.getFirstLine(parentText)).trim();
        if (parentFirstLine) {
            parentValue = "parent_node: [<" + parentFirstLine + ">] ";
        }

        if (tagName === "select") {
            const selectElement = element as HTMLSelectElement;
            //note that this doesn't necessarily give full picture for multi-select elements, room for improvement
            const selectedOptionText = selectElement.options[selectElement.selectedIndex]?.textContent;
            //this currently rules out the ability to support <select> elements which initially have no selected option
            // but that's a rare edge case; could be improved in future
            if (selectedOptionText) {
                let optionsText = Array.from(selectElement.options).map(option => option.text).join(" | ");

                //todo I don't understand how textContent would be non-empty when there were no options elements under
                // a select; There's the react-select library that could be used to create a select sort of element
                // with no <option> elements, but then the main element's tag wouldn't be <select>
                if (!optionsText) {
                    optionsText = selectElement.textContent ?? "";
                    //todo I can't figure out how you'd get a situation where textContent is empty but innerText is not
                    if (!optionsText) {
                        optionsText = this.domHelper.getInnerText(selectElement);
                    }
                }
                //why no use of removeEolAndCollapseWhitespace on optionsText??
                return parentValue + "Selected Options: " + this.removeEolAndCollapseWhitespace(selectedOptionText.trim())
                    + " - Options: " + optionsText;
            } else {
                this.logger.info("ELEMENT DESCRIPTION PROBLEM- No selected option found for select element (or selected option's text was empty string), processing it as a generic element");
            }
        }

        let inputValue = "";

        const typesForNoTextInputElements = ["submit", "reset", "checkbox", "radio", "button", "file"];
        if ((tagName === "input" || tagName === "textarea") && !typesForNoTextInputElements.includes(typeValue ?? "")
            && !typesForNoTextInputElements.includes(roleValue ?? "")) {
            const inputElement = element as HTMLInputElement;
            inputValue = `INPUT_VALUE="${inputElement.value}" `;
        }

        let elementText = (element.textContent ?? "").trim();
        if (elementText) {
            elementText = this.removeEolAndCollapseWhitespace(elementText);
            if (elementText.length > 80) {
                const innerText = (this.domHelper.getInnerText(element) ?? "").trim();
                if (innerText) {
                    return inputValue + this.removeEolAndCollapseWhitespace(innerText);
                } else {
                    //why are we completely skipping textContent if it's too long and innerText is empty? why not just truncate it?
                    this.logger.info("ELEMENT DESCRIPTION PROBLEM- Element text is too long and innerText is empty, processing it as a generic element");
                }
            } else {
                //possible improvement by including parentValue, but that would by default lead to duplication
                // if the parent's innerText was just this element's text, maybe add a check for that;
                // that concern would be made irrelevant by the improvement of parentValue calculation proposed earlier
                return inputValue + elementText;
            }
        }

        const getRelevantAttributes = (element: HTMLElement): string => salientAttributes.map(attr => {
            const attrValue = element.getAttribute(attr);
            return attrValue ? `${attr}="${attrValue}"` : "";
        }).filter(Boolean).join(" ")
        //todo ask Boyuan- seems undesirable for an input element's value attribute to be repeated here if it's already in the input value part (from querying the value property)
        // is initializing an input element with a non-empty value attribute common if setting a default value?


        const elementDescWithAttributes = (parentValue + getRelevantAttributes(element)).trim();
        //why do we ignore child attributes if the parent text is defined but the current element doesn't have any
        // relevant attributes? wouldn't it make more sense to include the child attributes in that case?
        if (elementDescWithAttributes) {
            return inputValue + this.removeEolAndCollapseWhitespace(elementDescWithAttributes);
        }

        const childElement = element.firstElementChild;
        if (childElement) {
            const childDescWithAttributes = (parentValue + getRelevantAttributes(childElement as HTMLElement)).trim();
            //if parent_value was non-empty, then wouldn't we have returned before looking at child elements?
            if (childDescWithAttributes) {
                //why would a textarea or input have a child node?
                return inputValue + this.removeEolAndCollapseWhitespace(childDescWithAttributes);
            }
        }

        this.logger.info("ELEMENT DESCRIPTION PROBLEM- unable to create element description for element at xpath " + this.getFullXpath(element));
        return null;
    }

    /**
     * extends library method getXPath to account for shadow DOM's
     * @param element the element whose full xpath should be constructed
     * @returns the full xpath of the given element (from the root of the page's document element)
     */
    getFullXpath = (element: HTMLElement): string => {
        let overallXpath = this.getFullXpathHelper(element);
        const topWindow = (this.domHelper.window as Window).top;
        if (!topWindow) {
            this.logger.warn("unable to access window.top, so unable to access the top-level document's iframe tree; cannot provide xpath analysis which takes iframes into account");
            return overallXpath;
        }

        if (!this.cachedIframeTree) {this.cachedIframeTree = new IframeTree(topWindow, this.logger);}
        const nestedIframesPathToElem = this.cachedIframeTree.getIframePathForElement(element);
        if (nestedIframesPathToElem) {
            for (let nestedIframeIdx = nestedIframesPathToElem.length - 1; nestedIframeIdx >= 0; nestedIframeIdx--) {
                const nestedIframeElem = nestedIframesPathToElem[nestedIframeIdx].iframe;
                if (nestedIframeElem) {
                    overallXpath = this.getFullXpathHelper(nestedIframeElem) + "/iframe()" + overallXpath;
                } else {
                    this.logger.warn("nested iframe element was null in the path to the current element; cannot provide full xpath analysis which takes iframes into account");
                    overallXpath = "/corrupted-node-in-iframe-tree()" + overallXpath;
                }
            }
        }
        return overallXpath;
    }

    private getFullXpathHelper = (element: HTMLElement): string => {
        let xpath = getXPath(element);
        const rootElem = element.getRootNode();
        if (rootElem instanceof ShadowRoot) {
            xpath = this.getFullXpath(rootElem.host as HTMLElement) + "/shadow-root()" + xpath;
        }
        return xpath;
    }

    /**
     * @description Get data about an element, including its tag name, role/type attributes, bounding box,
     * center coordinates, and a description
     * @param element the element to get data about
     * @return data about the element
     */
    getElementData = (element: HTMLElementWithDocumentHost): ElementData | null => {
        const description = this.getElementDescription(element);
        if (!description) return null;

        const tagName = element.tagName.toLowerCase();
        const roleValue = element.getAttribute("role");
        const typeValue = element.getAttribute("type");
        const tagHead = tagName + (roleValue ? ` role="${roleValue}"` : "") + (typeValue ? ` type="${typeValue}"` : "");
        //does it matter that this (& original python code) treat "" as equivalent to null for role and type attributes?

        const boundingRect = this.domHelper.grabClientBoundingRect(element);
        let elemX = boundingRect.x;
        let elemY = boundingRect.y;
        if (element.documentHostChain) {
            //this.logger.debug(`base coords were (${elemX}, ${elemY}) for element with tag head ${tagHead} and description: ${description}`);
            for (const host of element.documentHostChain) {
                const hostBoundingRect = this.domHelper.grabClientBoundingRect(host);
                elemX += hostBoundingRect.x;
                elemY += hostBoundingRect.y;
                //this.logger.debug(`adjusted coords to (${elemX}, ${elemY}) for host element with tag head ${host.tagName} and description: ${this.getElementDescription(host)}`);
            }
            //otherwise, you get really bizarre behavior where position measurements for 2nd/3rd/etc. annotations on the
            // same page are increasingly wildly off (for elements inside iframes)
            delete element.documentHostChain;
        }

        const centerPoint = [elemX + boundingRect.width / 2, elemY + boundingRect.height / 2] as const;
        const mainDiagCorners =
            {tLx: elemX, tLy: elemY, bRx: elemX + boundingRect.width, bRy: elemY + boundingRect.height};

        return {
            centerCoords: centerPoint, description: description, tagHead: tagHead, boundingBox: mainDiagCorners,
            width: boundingRect.width, height: boundingRect.height, tagName: tagName, element: element,
            xpath: this.getFullXpath(element)
        };
    }


    /**
     * @description Determine whether an element is hidden, based on its CSS properties and the hidden attribute
     * @param element the element which might be hidden
     * @return true if the element is hidden, false if it is visible
     */
    calcIsHidden = (element: HTMLElement): boolean => {
        const elementComputedStyle = this.domHelper.getComputedStyle(element);
        const isElementHiddenForOverflow = elementComputedStyle.overflow === "hidden" &&
            (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);//thanks to https://stackoverflow.com/a/9541579/10808625
        return elementComputedStyle.display === "none" || elementComputedStyle.visibility === "hidden"
            || element.hidden || isElementHiddenForOverflow || elementComputedStyle.opacity === "0"
            || elementComputedStyle.height === "0px" || elementComputedStyle.width === "0px"
            //1x1 px elements are generally a css hack to make an element temporarily ~invisible
            || elementComputedStyle.height === "1px" || elementComputedStyle.width === "1px"
            || this.isBuriedInBackground(element);
        //maybe eventually update this once content-visibility is supported outside chromium (i.e. in firefox/safari)
        // https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility

        //if needed, can explore adding logic for other tricks mentioned in this article (e.g. 'clip-path')
        // https://css-tricks.com/comparing-various-ways-to-hide-things-in-css/
    }

    isBuriedInBackground = (element: HTMLElement): boolean => {
        const boundRect = this.domHelper.grabClientBoundingRect(element);
        const queryPoints: [number, number][] = [[boundRect.x, boundRect.y], [boundRect.x + boundRect.width, boundRect.y],
            [boundRect.x, boundRect.y + boundRect.height], [boundRect.x + boundRect.width, boundRect.y + boundRect.height],
            [boundRect.x + boundRect.width / 2, boundRect.y + boundRect.height / 2]];
        //can add more query points based on quarters of width and height if we ever encounter a scenario where the existing logic incorrectly dismisses an element as being fully background-hidden
        let isBuried = true;
        for (const queryPoint of queryPoints) {
            const foregroundElemAtQueryPoint = this.actualElementFromPoint(queryPoint[0], queryPoint[1]);
            if (element.contains(foregroundElemAtQueryPoint)) {
                isBuried = false;
                break;
            }
        }
        return isBuried;
    }

    /**
     * @description Determine whether an element is disabled, based on its attributes and properties
     * @param element the element which might be disabled
     * @return true if the element is disabled, false if it is enabled
     */
    calcIsDisabled = (element: HTMLElement): boolean => {
        return element.ariaDisabled === "true"
            || ((element instanceof HTMLButtonElement || element instanceof HTMLInputElement
                    || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
                    || element instanceof HTMLOptGroupElement || element instanceof HTMLOptionElement
                    || element instanceof HTMLFieldSetElement)
                && element.disabled)
            || ((element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) && element.readOnly)
            || element.getAttribute("disabled") != null;
    }

    //is it possible to make this work even when there are shadow dom's?? and iframes?
    // is it worth working on that?

    /**
     * @description Get interactive elements in the DOM, including links, buttons, inputs, selects, textareas, and elements with certain roles
     * @return data about the interactive elements
     */
    getInteractiveElements = (): ElementData[] => {
        const interactiveElementSelectors = ['a', 'button', 'input', 'select', 'textarea', 'adc-tab',
            '[role="button"]', '[role="radio"]', '[role="option"]', '[role="combobox"]', '[role="textbox"]',
            '[role="listbox"]', '[role="menu"]', '[role="link"]', '[type="button"]', '[type="radio"]', '[type="combobox"]',
            '[type="textbox"]', '[type="listbox"]', '[type="menu"]', '[tabindex]:not([tabindex="-1"])',
            '[contenteditable]:not([contenteditable="false"])', '[onclick]', '[onfocus]', '[onkeydown]',
            '[onkeypress]', '[onkeyup]', "[checkbox]", '[aria-disabled="false"]', '[data-link]'];

        const elemsFetchStartTs = performance.now();
        const uniqueInteractiveElements = this.enhancedQuerySelectorAll(interactiveElementSelectors,
            this.domHelper.window as Window, elem => !this.calcIsDisabled(elem), true);
        const elemFetchDuration = performance.now() - elemsFetchStartTs;//ms
        (elemFetchDuration < 50 ? this.logger.debug : this.logger.warn)(`time to fetch interactive elements: ${elemFetchDuration} ms`);

        const interactiveElementsData = Array.from(uniqueInteractiveElements)
            .map(element => this.getElementData(element))
            .filter(Boolean) as ElementData[];
        //only add index after filtering b/c some interactive elements are discarded when not able to generate descriptions for them
        interactiveElementsData.forEach((elementData, index) => { elementData.interactivesIndex = index; })

        return interactiveElementsData;
    }

    highlightElement = async (element: HTMLElement, highlightDuration: number = 30000) => {
        await this.clearElementHighlightingEarly();
        const elementStyle: CSSStyleDeclaration = element.style;

        const initialOutline = elementStyle.outline;
        const initialComputedOutline = this.domHelper.getComputedStyle(element).outline;
        //const initialBackgroundColor = elemStyle.backgroundColor;

        elementStyle.outline = "3px solid red";

        await sleep(elementHighlightRenderDelay);

        const computedStyleSimilarityThreshold = 0.8;
        const computedOutlinePostStyleMod = this.domHelper.getComputedStyle(element).outline;
        const computedOutlineSimilarity = fuzz.ratio(initialComputedOutline, computedOutlinePostStyleMod) / 100;
        if (computedOutlineSimilarity > computedStyleSimilarityThreshold) {
            this.logger.info(`Element outline was not successfully set to red; computed outline is still the same as before (initialComputedOutline: ${initialComputedOutline}; computedOutlinePostStyleMod: ${computedOutlinePostStyleMod}; similarity ${computedOutlineSimilarity})`);
            const parentElem = element.parentElement;
            if (parentElem) {
                this.logger.debug("trying to highlight parent element instead");
                await this.highlightElement(parentElem, highlightDuration);
            }
        } else {
            //this.logger.trace(`initialComputedOutline: ${initialComputedOutline}; computedOutlinePostStyleMod: ${computedOutlinePostStyleMod}; similarity: ${computedOutlineSimilarity}`)
            this.highlightedElementStyle = elementStyle;
            this.highlightedElementOriginalOutline = initialOutline;
            setTimeout(() => {
                if (this.highlightedElementStyle === elementStyle) {
                    elementStyle.outline = initialOutline;
                    this.highlightedElementStyle = undefined;
                    this.highlightedElementOriginalOutline = undefined;
                }//otherwise the highlighting of the element was already reset by a later call of this method
            }, highlightDuration);

            //elemStyle.filter = "brightness(1.5)";

            // https://stackoverflow.com/questions/1389609/plain-javascript-code-to-highlight-an-html-element
            // meddling with element.style properties like backgroundColor, outline, filter, (border?)
            // https://developer.mozilla.org/en-US/docs/Web/CSS/background-color
            // https://developer.mozilla.org/en-US/docs/Web/CSS/outline
            // https://developer.mozilla.org/en-US/docs/Web/CSS/filter
            // https://developer.mozilla.org/en-US/docs/Web/CSS/border
        }
    }

    clearElementHighlightingEarly = async () => {
        if (this.highlightedElementStyle) {
            if (this.highlightedElementOriginalOutline === undefined) { this.logger.error("highlightedElementOriginalOutline is undefined when resetting the outline of a highlighted element (at the start of the process for highlighting a new element"); }
            this.highlightedElementStyle.outline = this.highlightedElementOriginalOutline ?? "";

            this.highlightedElementStyle = undefined;
            this.highlightedElementOriginalOutline = undefined;

            await sleep(elementHighlightRenderDelay);
        }
    }


    /**
     * safely access contents of an iframe and record any cases where the iframe content is inaccessible
     * @param iframe an iframe whose contents should be accessed
     * @returns the root document of the iframe's contents, or null if the iframe's content is inaccessible
     */
    getIframeContent = (iframe: HTMLIFrameElement): Document | null => {
        try {
            return iframe.contentDocument || iframe.contentWindow?.document || null;
        } catch (error: any) {
            if (error.name === "SecurityError") {
                this.logger.debug(`Cross-origin (${iframe.src}) iframe detected while grabbing iframe content: ${
                    renderUnknownValue(error).slice(0, 100)}`);
            } else {
                this.logger.error(`Error grabbing iframe content: ${renderUnknownValue(error)}`);
            }
            return null;
        }
    }

    /**
     * find matching elements even inside of shadow DOM's or (some) iframes
     * Can search for multiple css selectors (to avoid duplicating the effort of finding/traversing the various shadow DOM's and iframes)
     *
     * partly based on this https://stackoverflow.com/a/71692555/10808625 (for piercing shadow DOM's), plus additional
     * logic to handle iframes, multiple selectors, etc.
     * Avoids duplicates within a given scope (from multiple selectors matching an element), but doesn't currently have
     * protection against duplicates across different scopes (since intuitively it shouldn't be possible for an element
     * to be in both a shadow DOM and the main document)
     * @param cssSelectors The CSS selectors to use to find elements
     * @param topWindow the window that the search should happen in; this should be the top window of the page
     * @param elemFilter predicate to immediately eliminate irrelevant elements before they slow down the
     *                      array-combining operations
     * @param shouldIgnoreHidden whether to ignore hidden/not-displayed elements
     * @returns array of elements that match any of the CSS selectors;
     *          this is a static view of the elements (not live access that would allow modification)
     */
    enhancedQuerySelectorAll = (cssSelectors: string[], topWindow: Window,
                                elemFilter: (elem: HTMLElement) => boolean, shouldIgnoreHidden: boolean = true
    ): Array<HTMLElementWithDocumentHost> => {
        if (!this.cachedIframeTree) {this.cachedIframeTree = new IframeTree(topWindow, this.logger);}
        //todo measure which operations in this recursive stack are taking up the most time in total
        // I suspect the elementFromPoint() calls, since fetch time seemed to have shot up recently from 10-20ms to 60-130ms
        // Since this is single-threaded, can use instance vars to accumulate time spent on different things
        //  (as long as those instance vars are reset at the start of each call of this method)
        return this.enhancedQuerySelectorAllHelper(cssSelectors, topWindow.document, this.cachedIframeTree.root,
            elemFilter, shouldIgnoreHidden);
    }

    enhancedQuerySelectorAllHelper = (cssSelectors: string[], root: ShadowRoot | Document, iframeContextNode: IframeNode,
                                      elemFilter: (elem: HTMLElement) => boolean, shouldIgnoreHidden: boolean = true
    ): Array<HTMLElementWithDocumentHost> => {
        let possibleShadowRootHosts = Array.from(root.querySelectorAll('*')) as HTMLElement[];
        if (shouldIgnoreHidden) { possibleShadowRootHosts = possibleShadowRootHosts.filter(elem => !this.calcIsHidden(elem)); }
        const shadowRootsOfChildren = possibleShadowRootHosts.map(elem => elem.shadowRoot)
            .filter(Boolean) as ShadowRoot[];//TS compiler doesn't know that filter(Boolean) removes nulls

        const iframeNodes = iframeContextNode.children;
        //+1 is for the current scope results array, in case none of the child iframes get disqualified for being hidden
        const resultArrays: HTMLElement[][] = new Array<Array<HTMLElement>>(shadowRootsOfChildren.length + iframeNodes.length + 1);

        for (const childIframeNode of iframeNodes) {
            const childIframeElem = childIframeNode.iframe;
            if (!childIframeElem) {
                this.logger.warn("iframeNode had null iframe element, so skipping it");
                continue;
            }
            if (shouldIgnoreHidden && this.calcIsHidden(childIframeElem)) {
                this.logger.debug("Ignoring hidden iframe element");
                continue;
            }

            const iframeContent = this.getIframeContent(childIframeElem);
            if (iframeContent) {
                const resultsForIframe = this.enhancedQuerySelectorAllHelper(cssSelectors, iframeContent, childIframeNode, elemFilter, shouldIgnoreHidden);
                resultsForIframe.forEach(elem => {
                    if (elem.documentHostChain === undefined) {elem.documentHostChain = [];}
                    elem.documentHostChain.push(childIframeElem);
                });
                resultArrays.push(resultsForIframe);
            }
        }

        shadowRootsOfChildren.map(childShadowRoot => this.enhancedQuerySelectorAllHelper(cssSelectors, childShadowRoot, iframeContextNode, elemFilter, shouldIgnoreHidden))
            .forEach(resultsForShadowRoot => resultArrays.push(resultsForShadowRoot));

        //based on https://developer.mozilla.org/en-US/docs/Web/API/Node/isSameNode, I'm pretty confident that simple
        // element === element checks by the Set class will prevent duplicates
        const currScopeResults: Set<HTMLElement> = new Set();
        cssSelectors.map(selector => Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(elemFilter))
            .forEach(resultsForSelector => {
                resultsForSelector.forEach(elem => {
                    if (!shouldIgnoreHidden || !this.calcIsHidden(elem)) {
                        currScopeResults.add(elem);
                    }
                });
            })
        resultArrays.push(Array.from(currScopeResults));

        //todo consider implementing custom array merging logic instead of HTML[][].flat() if this method is proving to be a noticeable performance bottleneck even sometimes
        // e.g. look at this source: https://dev.to/uilicious/javascript-array-push-is-945x-faster-than-array-concat-1oki
        return resultArrays.flat();
    }

    enhancedQuerySelector(cssSelector: string, root: ShadowRoot | Document | HTMLIFrameElement,
                          elemFilter: (elem: HTMLElement) => boolean, shouldIgnoreHidden: boolean = true): HTMLElement | null {
        const currScopeResult = root.querySelector(cssSelector) as HTMLElement | null;
        if (currScopeResult && elemFilter(currScopeResult) && !(shouldIgnoreHidden && this.calcIsHidden(currScopeResult))) {
            return currScopeResult;
        }
        let possibleShadowRootHosts = Array.from(root.querySelectorAll('*')) as HTMLElement[];
        if (shouldIgnoreHidden) {
            possibleShadowRootHosts = possibleShadowRootHosts.filter(elem => !this.calcIsHidden(elem));
        }
        const shadowRootsOfChildren = possibleShadowRootHosts.map(elem => elem.shadowRoot)
            .filter(Boolean) as ShadowRoot[];//filter(Boolean) removes nulls
        for (const shadowRoot of shadowRootsOfChildren) {
            const shadowResult = this.enhancedQuerySelector(cssSelector, shadowRoot, elemFilter, shouldIgnoreHidden);
            if (shadowResult) {
                return shadowResult;
            }
        }
        let iframes = Array.from(root.querySelectorAll('iframe'));
        if (shouldIgnoreHidden) { iframes = iframes.filter(iframe => !this.calcIsHidden(iframe)); }
        for (const iframe of iframes) {
            const iframeContent = this.getIframeContent(iframe);
            if (iframeContent) {
                const iframeResult = this.enhancedQuerySelector(cssSelector, iframeContent, elemFilter, shouldIgnoreHidden);
                if (iframeResult) {
                    return iframeResult;
                }
            }
        }
        return null;
    }

    /**
     * this tries to tunnel through shadow roots and iframes to find the actual active/focused element
     * It also automatically deals with the annoying browser behavior of sometimes returning the `<body>` element
     * as a default value for document.activeElement
     * Finally, it checks for the active element not being visible and logs a warning if so
     */
    findRealActiveElement = (): HTMLElement | null => {
        const activeElem = this.getRealActiveElementInContext(this.domHelper.dom);
        if (activeElem) {
            if (activeElem.tagName.toLowerCase() === "body") {
                return null;
            }
            if (this.calcIsHidden(activeElem)) {
                this.logger.warn(`Active element is hidden, so it's likely not the intended target: ${activeElem.outerHTML.slice(0, 100)}`);
            }
        }
        return activeElem;
    }

    private getRealActiveElementInContext(root: Document | ShadowRoot): HTMLElement | null {
        let actualActiveElement: HTMLElement | null = null;
        const currContextActiveElement = root.activeElement as HTMLElement;
        if (currContextActiveElement) {
            if (currContextActiveElement.shadowRoot) {
                actualActiveElement = this.getRealActiveElementInContext(currContextActiveElement.shadowRoot);
            } else if (currContextActiveElement instanceof HTMLIFrameElement) {
                const iframeContent = this.getIframeContent(currContextActiveElement);
                if (iframeContent) {
                    actualActiveElement = this.getRealActiveElementInContext(iframeContent);
                }
            } else {
                actualActiveElement = currContextActiveElement;
            }
        }
        return actualActiveElement;
    }

    setupMouseMovementTracking = (positionUpdater: (x: number, y: number) => void) => {
        if (!this.cachedIframeTree) {this.cachedIframeTree = new IframeTree(this.domHelper.window as Window, this.logger);}
        this.setupMouseMovementTrackingHelper(this.cachedIframeTree.root, positionUpdater);
    }

    setupMouseMovementTrackingHelper = (iframeContextNode: IframeNode, positionUpdater: (x: number, y: number) => void) => {
        let currContextDocument: Document | null = null;
        try {
            currContextDocument = iframeContextNode.window.document;
        } catch (error: any) {
            if (error.name === "SecurityError") {
                this.logger.debug(`Cross-origin (${iframeContextNode.iframe?.src}) iframe detected while adding mouse movement listeners for nested documents: ${
                    renderUnknownValue(error).slice(0, 100)}`);
            } else {
                this.logger.error(`Error while adding mouse movement listeners for nested documents: ${renderUnknownValue(error)}`);
            }
        }
        if (currContextDocument) {
            currContextDocument.addEventListener('mousemove', (e) => {
                positionUpdater(e.clientX + iframeContextNode.coordsOffsetFromViewport.x, e.clientY + iframeContextNode.coordsOffsetFromViewport.y);
            });
        }
        for (const childIframe of iframeContextNode.children) {
            this.setupMouseMovementTrackingHelper(childIframe, positionUpdater);
        }
    }

    findQueryPointsInOverlap = (elem1Data: ElementData, elem2Data: ElementData): Array<readonly [number, number]> => {
        const overlapLeftX = Math.max(elem1Data.boundingBox.tLx, elem2Data.boundingBox.tLx);
        const overlapRightX = Math.min(elem1Data.boundingBox.bRx, elem2Data.boundingBox.bRx);
        const overlapTopY = Math.max(elem1Data.boundingBox.tLy, elem2Data.boundingBox.tLy);
        const overlapBottomY = Math.min(elem1Data.boundingBox.bRy, elem2Data.boundingBox.bRy);
        const queryPoints: Array<readonly [number, number]> = [];
        if (overlapLeftX >= overlapRightX || overlapTopY >= overlapBottomY) {
            this.logger.warn(`No overlap between elements ${elem1Data.description} and ${elem2Data.description}`);
            return queryPoints;
        }
        queryPoints.push([overlapLeftX, overlapTopY], [overlapRightX, overlapTopY], [overlapLeftX, overlapBottomY],
            [overlapRightX, overlapBottomY]);
        if (elem1Data.centerCoords[0] >= overlapLeftX && elem1Data.centerCoords[0] <= overlapRightX &&
            elem1Data.centerCoords[1] >= overlapTopY && elem1Data.centerCoords[1] <= overlapBottomY
        ) {queryPoints.push(elem1Data.centerCoords);}
        if (elem2Data.centerCoords[0] >= overlapLeftX && elem2Data.centerCoords[0] <= overlapRightX &&
            elem2Data.centerCoords[1] >= overlapTopY && elem2Data.centerCoords[1] <= overlapBottomY
        ) {queryPoints.push(elem2Data.centerCoords);}

        return queryPoints;
    }

    actualElementFromPoint(x: number, y: number, doc?: Document): Element | null {
        let foremostElemAtPoint = this.domHelper.elementFromPoint(x, y, doc);

        if (foremostElemAtPoint && foremostElemAtPoint instanceof HTMLIFrameElement) {
            const topWindow = (this.domHelper.window as Window).top;
            if (topWindow) {
                if (!this.cachedIframeTree) {this.cachedIframeTree = new IframeTree(topWindow, this.logger);}
                const iframeNode = this.cachedIframeTree.findIframeNodeForIframeElement(foremostElemAtPoint);
                if (iframeNode) {
                    const iframeContent = this.getIframeContent(foremostElemAtPoint);
                    if (iframeContent) {
                         foremostElemAtPoint = this.actualElementFromPoint(x - iframeNode.coordsOffsetFromViewport.x, y - iframeNode.coordsOffsetFromViewport.y, iframeContent);
                    } else {this.logger.info("unable to access iframe content, so unable to access the actual element at point which takes iframes into account");}
                } else {this.logger.info("unable to find iframe node for iframe element, so unable to access the actual element at point which takes iframes into account");}
            } else { this.logger.warn("unable to access window.top, so unable to access the top-level document's iframe tree; cannot provide actual element at point which takes iframes into account"); }
        }
        return foremostElemAtPoint;
    }

    judgeOverlappingElementsForForeground = (elem1Data: ElementData, elem2Data: ElementData): number => {
        const queryPoints = this.findQueryPointsInOverlap(elem1Data, elem2Data);
        if (queryPoints.length === 0) {return 0;}
        let numPointsWhereElem1IsForeground = 0;
        let numPointsWhereElem2IsForeground = 0;
        for (const queryPoint of queryPoints) {
            const foregroundElemAtQueryPoint = this.actualElementFromPoint(queryPoint[0], queryPoint[1]);
            if (elem1Data.element.contains(foregroundElemAtQueryPoint)) {
                numPointsWhereElem1IsForeground++;
            } else if (elem2Data.element.contains(foregroundElemAtQueryPoint)) {numPointsWhereElem2IsForeground++;}
        }
        if (numPointsWhereElem1IsForeground === 0) {this.logger.info(`No query points where ${elem1Data.description} was in the foreground, when evaluating its overlap with ${elem2Data.description}`);}
        if (numPointsWhereElem2IsForeground === 0) {this.logger.info(`No query points where ${elem2Data.description} was in the foreground, when evaluating its overlap with ${elem1Data.description}`);}
        return numPointsWhereElem1IsForeground - numPointsWhereElem2IsForeground;
    }
}