import { Logger } from "loglevel";
import {DomWrapper} from "./DomWrapper";
import {createNamedLogger} from "./shared_logging_setup";
import {ElementData, elementHighlightRenderDelay, renderUnknownValue, sleep} from "./misc";
import {IframeTree} from "./IframeTree";
import * as fuzz from "fuzzball";

export class ElementHighlighter {
    private domHelper: DomWrapper;

    readonly logger: Logger;
    private cachedIframeTreeGetter: () => IframeTree;

    private highlightedElementOriginalOutline: string | undefined;
    private highlightedElementStyle: CSSStyleDeclaration | undefined;

    constructor(getterForCachedIframeTree: () => IframeTree, domHelper?: DomWrapper, loggerToUse?: Logger) {
        this.domHelper = domHelper ?? new DomWrapper(window);
        this.logger = loggerToUse ?? createNamedLogger('element-highlighter', false);
        this.cachedIframeTreeGetter = getterForCachedIframeTree;
    }

    highlightElement = async (element: HTMLElement, allInteractiveElements: ElementData[] = [], highlightDuration: number = 30000): Promise<HTMLElement> => {
        let elemToHighlight = element;
        await this.clearElementHighlightingEarly();
        //todo on second thought, just move the below if block to the recursive helper
        if (this.doesElementContainSpaceOccupyingPseudoElements(element)) {
            this.logger.debug(`Element contains space-occupying pseudo-elements which typically throw off outline-based highlighting, so trying to highlight parent element instead; pseudoelement-containing element: ${element.outerHTML.slice(0, 300)}`);
            const parentElem = element.parentElement;
            if (parentElem) {
                const numInteractiveElementsUnderParent = allInteractiveElements.filter(interactiveElem => parentElem.contains(interactiveElem.element)).length;
                if (numInteractiveElementsUnderParent <= 1) {
                    elemToHighlight = parentElem;
                } else { this.logger.trace(`still just trying to highlight element that contains pseudo-elements because its parent has ${numInteractiveElementsUnderParent} interactive children, so it would be ambiguous to highlight the parent as target element`); }
            }
        }
        return await this.highlightElementHelper(elemToHighlight, allInteractiveElements, highlightDuration);
    }

    highlightElementHelper = async (element: HTMLElement, allInteractiveElements: ElementData[] = [], highlightDuration: number = 30000): Promise<HTMLElement> => {
        let elementHighlighted = element;
        const elementStyle: CSSStyleDeclaration = element.style;
        this.logger.trace(`attempting to highlight element ${element.outerHTML.slice(0, 300)}`);

        const initialOutline = elementStyle.outline;
        const initialComputedOutline = this.domHelper.getComputedStyle(element).outline;
        //const initialBackgroundColor = elemStyle.backgroundColor;

        //todo https://developer.mozilla.org/en-US/docs/Web/CSS/filter
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/hue-rotate
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/brightness (only 1.25, higher risks white-out and unreadability)
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/contrast

        //todo add logic to choose an outline color that contrasts with the actual visible background color of the element (with 'red' still being the fallback)
        elementStyle.outline = "3px solid red";

        const animationWaitStart = performance.now();
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        this.logger.trace(`Time to wait for top-level animation frame after setting outline: ${performance.now() - animationWaitStart} ms`);

        const iframeContextNode = this.cachedIframeTreeGetter().findIframeNodeForElement(element);
        if (iframeContextNode && iframeContextNode.iframe) {
            const iframeAnimationWaitStart = performance.now();
            try {
                await new Promise((resolve) => iframeContextNode.window.requestAnimationFrame(resolve));
            } catch (error: any) {
                if (error.name === "SecurityError") {
                    this.logger.trace(`Cross-origin iframe detected while highlighting element: ${renderUnknownValue(error)
                        .slice(0, 100)}`);
                } else {throw error;}
            }
            this.logger.trace(`Time to wait for animation frame in iframe context after setting outline: ${performance.now() - iframeAnimationWaitStart} ms`);
        }

        await sleep(elementHighlightRenderDelay);

        const computedStyleSimilarityThreshold = 0.8;
        const computedOutlinePostStyleMod = this.domHelper.getComputedStyle(element).outline;
        const computedOutlineSimilarity = fuzz.ratio(initialComputedOutline, computedOutlinePostStyleMod) / 100;
        if (computedOutlineSimilarity <= computedStyleSimilarityThreshold) {
            this.logger.trace(`initialComputedOutline: ${initialComputedOutline}; computedOutlinePostStyleMod: ${computedOutlinePostStyleMod}; similarity: ${computedOutlineSimilarity}`);
            //todo eventually explore using htmlcanvas and pixelmatch libraries to do more reliable check of whether the outline change was actually rendered
        } else {
            this.logger.info(`Element outline was not successfully set to red; computed outline is still the same as before (initialComputedOutline: ${initialComputedOutline}; computedOutlinePostStyleMod: ${computedOutlinePostStyleMod}; similarity ${computedOutlineSimilarity})`);
            const parentElem = element.parentElement;
            if (parentElem) {
                const numInteractiveElementsUnderParent = allInteractiveElements.filter(interactiveElem => parentElem.contains(interactiveElem.element)).length;
                if (numInteractiveElementsUnderParent <= 1) {
                    this.logger.debug("trying to highlight parent element instead");
                    elementStyle.outline = initialOutline;
                    elementHighlighted = await this.highlightElementHelper(parentElem, allInteractiveElements, highlightDuration);
                } else { this.logger.trace(`not trying to highlight parent because it has ${numInteractiveElementsUnderParent} interactive children, so it would be ambiguous to highlight the parent as target element`); }
            }
        }

        if (elementHighlighted === element) {
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
        return elementHighlighted;
    }

    clearElementHighlightingEarly = async () => {
        if (this.highlightedElementStyle) {
            if (this.highlightedElementOriginalOutline === undefined) { this.logger.error("highlightedElementOriginalOutline is undefined when resetting the outline of a highlighted element (at the start of the process for highlighting a new element"); }
            this.logger.trace(`clearing element highlighting early, from highlit outline of ${this.highlightedElementStyle.outline} to original outline value of ${this.highlightedElementOriginalOutline}`);
            this.highlightedElementStyle.outline = this.highlightedElementOriginalOutline ?? "";

            this.highlightedElementStyle = undefined;
            this.highlightedElementOriginalOutline = undefined;

            await sleep(elementHighlightRenderDelay);
        } else { this.logger.trace("unable to clear element highlighting because no temporary style object is stored for a highlighted element"); }
    }

    doesElementContainSpaceOccupyingPseudoElements = (element: HTMLElement): boolean => {
        //included marker/placeholder/file-selector-button speculatively; open to removing them if they don't actually
        // cause a problematic change in visually rendered element size (and so don't screw up element highlighting)
        return ["::before", "::after", "::marker", "::placeholder", "::file-selector-button"].some(pseudoElemName => {
            const pseudoElemStyle = this.domHelper.getComputedStyle(element, pseudoElemName);
            const isPseudoElemPresent = pseudoElemStyle.content !== "" && pseudoElemStyle.content !== "none"
                && pseudoElemStyle.content !== "normal";
            if (isPseudoElemPresent) { this.logger.debug(`FOUND PSEUDO-ELEMENT ${pseudoElemName} with computed style inside of element ${element.outerHTML.slice(0, 200)}`) }
            return isPseudoElemPresent;
        });
    }



}