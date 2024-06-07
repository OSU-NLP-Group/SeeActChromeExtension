import getXPath from "get-xpath";
import {createNamedLogger} from "./shared_logging_setup";
import {DomWrapper} from "./DomWrapper";
import log from "loglevel";
import * as fuzz from "fuzzball";

export type ElementData = {
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
    tagName: string,
    element: HTMLElement
}

export type SerializableElementData = Omit<ElementData, 'element'>;

//todo consider renaming this to HtmlHelper or HtmlElementHelper if I create a ChromeHelper class for accessing
// browser api's
export class BrowserHelper {

    //for dependency injection in unit tests
    private domHelper: DomWrapper;

    readonly logger;

    constructor(domHelper?: DomWrapper, loggerToUse?: log.Logger) {
        this.domHelper = domHelper ?? new DomWrapper(window);

        this.logger = loggerToUse ?? createNamedLogger('browser-helper', false);
    }

    /**
     * @description Gets the text content of an element, or the value of an input or textarea element
     * @param elementToActOn the element whose text or value is to be retrieved
     * @return the text content of the element, or the value of an input or textarea element
     */
    getElementText = (elementToActOn: HTMLElement): string|null => {
        let priorElementText = elementToActOn.textContent;
        if (elementToActOn instanceof HTMLInputElement || elementToActOn instanceof HTMLTextAreaElement
            || ('value' in elementToActOn && typeof(elementToActOn.value) === 'string')) {
            priorElementText = (elementToActOn.value as string|null) ?? elementToActOn.textContent;
        }
        return priorElementText;
    }

    /**
     * @description Select an option from a select element, based on the option's name or an approximation of it
     * @param selectElement the select element to select an option from
     * @param optionName the name (or an approximation of the name) of the option element to select
     * @return the name/innertext of the option element which was selected
     */
    selectOption = (selectElement: HTMLElement, optionName: string): string|undefined => {
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

        //todo put a flag/warning in the description if the element's dimensions are suspiciously tiny (e.g. 1px by 1px)


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

        this.logger.info("ELEMENT DESCRIPTION PROBLEM- unable to create element description for element at xpath " + getXPath(element));
        return null;
    }

    /**
     * @description Get data about an element, including its tag name, role/type attributes, bounding box,
     * center coordinates, and a description
     * @param element the element to get data about
     * @return data about the element
     */
    getElementData = (element: HTMLElement): ElementData | null => {
        if (this.calcIsHidden(element) || this.calcIsDisabled(element)) return null;

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
            tagName: tagName,
            element: element
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
            || elementComputedStyle.height === "0px" || elementComputedStyle.width === "0px";
        //maybe eventually update this once content-visibility is supported outside chromium (i.e. in firefox/safari)
        // https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility
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
        //todo ask Boyuan about also checking for readonly attribute if element is input or textarea (or select? or others??)
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

        const uniqueInteractiveElements = new Set<HTMLElement>();
        interactiveElementSelectors.forEach(selector => {
            this.domHelper.fetchElementsByCss(selector).forEach(element => {
                uniqueInteractiveElements.add(element);
            });
        });
        //based on https://developer.mozilla.org/en-US/docs/Web/API/Node/isSameNode, I'm pretty confident that simple
        // element === element checks by the Set class will prevent duplicates

        return Array.from(uniqueInteractiveElements).map(element => this.getElementData(element))
            .filter(Boolean) as ElementData[];
    }
}