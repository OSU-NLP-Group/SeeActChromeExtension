import {DOMWindow} from "jsdom";
import getXPath from "get-xpath";

/**
 * @description class with thin wrappers around DOM interaction
 * This is a class so that it can be mocked in unit tests
 */
export class DomHelper {
    //to avoid runtime errors during unit tests from jest/jsdom limitations
    static readonly XPATH_RESULT_1ST_ORDERED_NODE_TYPE = XPathResult ? XPathResult.FIRST_ORDERED_NODE_TYPE : 9;

    private dom: Document;
    private window: Window | DOMWindow;

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
     * trivial wrapper around element.getBoundingClientRect() because jsdom doesn't properly support that element (all numbers are 0's)
     * and so it has to be mocked in unit tests
     * @param element the element to grab the bounding rect of
     * @returns the bounding rect of the element
     */
    grabClientBoundingRect = (element: HTMLElement): DOMRect => {
        return element.getBoundingClientRect();
    }

    /**
     * @description Determine whether an element is hidden, based on its CSS properties and the hidden attribute
     * @param element the element which might be hidden
     * @return true if the element is hidden, false if it is visible
     */
    calcIsHidden = (element: HTMLElement): boolean => {
        const elementComputedStyle = this.window.getComputedStyle(element);
        const isElementHiddenForOverflow = elementComputedStyle.overflow === "hidden" &&
            (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth);//thanks to https://stackoverflow.com/a/9541579/10808625
        return elementComputedStyle.display === "none" || elementComputedStyle.visibility === "hidden"
            || element.hidden || isElementHiddenForOverflow || elementComputedStyle.opacity === "0"
            || elementComputedStyle.height === "0px" || elementComputedStyle.width === "0px";
        //maybe eventually update this once content-visibility is supported outside chromium (i.e. in firefox/safari)
        // https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
        //todo FULLY unit test this on apr6 by mocking window.getComputedStyle
    }

}

export type ElementData = {
    /**
     * used as pseudo-unique identifier
     */
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
    tagName: string
}

export class BrowserHelper {

    //for dependency injection in unit tests
    private domHelper: DomHelper;

    constructor(domHelper?: DomHelper) {
        this.domHelper = domHelper ?? new DomHelper(window);
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

    //todo once receive clearance to rework this (after SeeAct main loop is working and we can confirm
    // whether rework introduces regression in e2e test), refactor this to just have 1 return point instead of 5-6
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
            "label", "name", "option_selected", "placeholder", "readonly", "text-value", "title", "value"];

        let parentValue = "";
        const parent = element.parentElement;
        //it's awkward that this 'first line' sometimes includes the innerText of elements below the main element (shown in a test case)
        // could get around that with parent.textContent and removing up to 1 linefeed at the start of it, for the
        // scenario where a label was the first child and there was a linefeed before the label element's text
        const parentText = parent ? this.domHelper.getInnerText(parent) : "";
        const parentFirstLine = this.removeEolAndCollapseWhitespace(this.getFirstLine(parentText)).trim();
        if (parentFirstLine) {
            parentValue = "parent_node: " + parentFirstLine + " ";
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
                console.warn("No selected option found for select element (or selected option's text was empty string), processing it as a generic element");
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
                    console.warn("Element text is too long and innerText is empty, processing it as a generic element");
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

        console.warn("unable to create element description for element at xpath", getXPath(element));
        return null;
    }

    /**
     * @description Get data about an element, including its tag name, role/type attributes, bounding box,
     * center coordinates, and a description
     * @param element the element to get data about
     * @return data about the element
     */
    getElementData = (element: HTMLElement): ElementData | null => {
        if (this.domHelper.calcIsHidden(element) || this.calcIsDisabled(element)) return null;

        const description = this.getElementDescription(element);
        if (!description) return null;

        const tagName = element.tagName.toLowerCase();
        const roleValue = element.getAttribute("role");
        const typeValue = element.getAttribute("type");
        const tagHead = tagName + (roleValue ? ` role="${roleValue}"` : "") + (typeValue ? ` type="${typeValue}"` : "");
        //does it matter that this (& original python code) treat "" as equivalent to null for role and type attributes?

        const boundingRect = this.domHelper.grabClientBoundingRect(element);
        const centerPoint = [boundingRect.x + boundingRect.width / 2,
            boundingRect.y + boundingRect.height / 2] as const;
        const mainDiagCorners = {
            tLx: boundingRect.x, tLy: boundingRect.y,
            bRx: boundingRect.x + boundingRect.width, bRy: boundingRect.y + boundingRect.height
        };

        return {
            centerCoords: centerPoint,
            description: description,
            tagHead: tagHead,
            boundingBox: mainDiagCorners,
            tagName: tagName
        };
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
            || element.getAttribute("disabled") != null;
        //todo FULLY unit test this on apr6
    }

}