import {Logger} from "loglevel";
import {DomWrapper} from "./DomWrapper";
import {createNamedLogger} from "./shared_logging_setup";
import {ElementData, elementHighlightRenderDelay, renderUnknownValue, sleep} from "./misc";
import {IframeTree} from "./IframeTree";
import * as fuzz from "fuzzball";

type RGB = [number, number, number];
type HSL = [number, number, number];

// Define an epsilon for floating-point comparison
const EPSILON = 0.000001;

export class ElementHighlighter {
    private domHelper: DomWrapper;

    readonly logger: Logger;
    private cachedIframeTreeGetter: () => IframeTree;

    private highlightedElement: HTMLElement | undefined;
    private highlightedElementStyle: CSSStyleDeclaration | undefined;
    private highlightedElementOriginalOutline: string | undefined;

    constructor(getterForCachedIframeTree: () => IframeTree, domHelper?: DomWrapper, loggerToUse?: Logger) {
        this.domHelper = domHelper ?? new DomWrapper(window);
        this.logger = loggerToUse ?? createNamedLogger('element-highlighter', false);
        this.cachedIframeTreeGetter = getterForCachedIframeTree;
    }

    highlightElement = async (element: HTMLElement, allInteractiveElements: ElementData[] = [], highlightDuration: number = 30000): Promise<HTMLElement|undefined> => {
        await this.clearElementHighlightingEarly();
        return await this.highlightElementHelper(element, allInteractiveElements, highlightDuration);
    }

    highlightElementHelper = async (element: HTMLElement, allInteractiveElements: ElementData[] = [], highlightDuration: number = 30000): Promise<HTMLElement|undefined> => {
        if (this.doesElementContainSpaceOccupyingPseudoElements(element)) {
            this.logger.debug(`Element contains space-occupying pseudo-elements which typically throw off outline-based highlighting, so trying to highlight parent element instead; pseudoelement-containing element: ${element.outerHTML.slice(0, 300)}`);
            const parentElem = element.parentElement;
            if (parentElem) {
                const numInteractiveElementsUnderParent = allInteractiveElements.filter(interactiveElem => parentElem.contains(interactiveElem.element)).length;
                if (numInteractiveElementsUnderParent <= 1) {
                    return await this.highlightElementHelper(parentElem, allInteractiveElements, highlightDuration);
                } else { this.logger.trace(`still just trying to highlight element that contains pseudo-elements because its parent has ${numInteractiveElementsUnderParent} interactive children, so it would be ambiguous to highlight the parent as target element`); }
            }
        }

        let elementHighlighted: HTMLElement|undefined = element;

        const elementStyle: CSSStyleDeclaration = element.style;
        this.logger.trace(`attempting to highlight element ${element.outerHTML.slice(0, 300)}`);

        const initialOutline = elementStyle.outline;
        const initialComputedOutline = this.domHelper.getComputedStyle(element).outline;
        //const initialBackgroundColor = elemStyle.backgroundColor;

        //todo https://developer.mozilla.org/en-US/docs/Web/CSS/filter
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/hue-rotate
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/brightness (only 1.25, higher risks white-out and unreadability)
        // https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/contrast

        elementStyle.outline = `3px solid ${this.calculateOutlineColor(element)}`;

        await this.waitForElemHighlightChangeAnimation(element);

        const computedStyleSimilarityThreshold = 0.8;
        const computedOutlinePostStyleMod = this.domHelper.getComputedStyle(element).outline;
        const computedOutlineSimilarity = fuzz.ratio(initialComputedOutline, computedOutlinePostStyleMod) / 100;
        if (computedOutlineSimilarity <= computedStyleSimilarityThreshold) {
            this.logger.trace(`initialComputedOutline: ${initialComputedOutline}; computedOutlinePostStyleMod: ${computedOutlinePostStyleMod}; similarity: ${computedOutlineSimilarity}`);
            //todo eventually explore using htmlcanvas and pixelmatch libraries to do more reliable check of whether the outline change was actually rendered
        } else {
            elementHighlighted = undefined;
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
            this.highlightedElement = element;
            this.highlightedElementStyle = elementStyle;
            this.highlightedElementOriginalOutline = initialOutline;
            setTimeout(() => {
                if (this.highlightedElementStyle === elementStyle) {
                    elementStyle.outline = initialOutline;
                    this.highlightedElement = undefined;
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

    private async waitForElemHighlightChangeAnimation(element: HTMLElement) {
        const animationWaitStart = performance.now();
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        this.logger.trace(`Time to wait for top-level animation frame after setting outline: ${(performance.now() - animationWaitStart).toFixed(5)} ms`);

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
            this.logger.trace(`Time to wait for animation frame in iframe context after setting outline: ${(performance.now() - iframeAnimationWaitStart).toFixed(5)} ms`);
        }

        await sleep(elementHighlightRenderDelay);
    }

    clearElementHighlightingEarly = async () => {
        if (this.highlightedElementStyle) {
            if (this.highlightedElementOriginalOutline === undefined) { this.logger.error("highlightedElementOriginalOutline is undefined when resetting the outline of a highlighted element (at the start of the process for highlighting a new element"); }
            this.logger.trace(`clearing element highlighting early, from highlit outline of ${this.highlightedElementStyle.outline} to original outline value of ${this.highlightedElementOriginalOutline}`);
            this.highlightedElementStyle.outline = this.highlightedElementOriginalOutline ?? "";

            if (this.highlightedElement) {
                await this.waitForElemHighlightChangeAnimation(this.highlightedElement);
            } else { this.logger.error("highlightedElement variable is undefined when resetting the outline of a highlighted element"); }

            this.highlightedElement = undefined;
            this.highlightedElementStyle = undefined;
            this.highlightedElementOriginalOutline = undefined;

            await sleep(3*elementHighlightRenderDelay);
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

    calculateOutlineColor = (element: HTMLElement): string => {
        let outlineColor = "red";
        const bgColorRgb = this.findEffectiveBackgroundColor(element);
        if (bgColorRgb) {
            const originalColorHsl = this.rgbToHsl(bgColorRgb);
            if (!this.isNeutralColor(originalColorHsl)) {
                const distinctiveColorHsl =  this.adjustNonNeutralColor(originalColorHsl);
                const [r, g, b] = this.hslToRgb(distinctiveColorHsl);
                outlineColor = `rgb(${r}, ${g}, ${b})`;
            }
        }
        return outlineColor;
    }

    //todo check for effective background color of element just to left, element just to right, element just above, and
    // element just below (using BrowserHelper.actualElementFromPoint() somehow);
    // then combine those with the effective background color of the element itself (maybe averaging the hue,
    // saturation, and lightness values) to figure out what color the outline should maximally contrast with

    rgbToHsl(rgb: RGB): HSL {
        // Normalize RGB values to 0-1 range
        const [r, g, b] = rgb.map(v => v / 255);

        // Find the minimum and maximum values out of R, G, and B
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        // Calculate the lightness
        const lightness = (max + min) / 2;

        let hue = 0;
        let saturation = 0;

        if (Math.abs(max - min) > EPSILON) {//i.e. max !== min, but safe from floating point weirdness
            // Calculate the saturation
            const colorRange = max - min;
            // Saturation formula changes based on lightness to maintain consistent
            // perceptual saturation across different lightness levels.
            // When lightness is very high _or_ very low, a larger color range is needed for the same
            // perceived saturation
            saturation = lightness > 0.5
                ? colorRange / (2*(1-lightness))
                : colorRange / (2*lightness);

            // Calculate the hue
            switch (true) {
                case Math.abs(r - max) < EPSILON: {
                    // If red is the dominant color
                    const greenBlueDistance = g - b;
                    const redDominantHue = greenBlueDistance / colorRange;
                    hue = redDominantHue + (g < b ? 6 : 0);//center of red region is at the 0 point of the color wheel
                    // Add 6 if hue is negative to keep it in 0-6 range
                    break;
                }
                case Math.abs(g - max) < EPSILON: {
                    // If green is the dominant color
                    const blueRedDistance = b - r;
                    const greenDominantHue = blueRedDistance / colorRange;
                    hue = greenDominantHue + 2;//center of green region is 2/6 aka 1/3 of the way around the color wheel
                    break;
                }
                case Math.abs(b - max) < EPSILON: {
                    // If blue is the dominant color
                    const redGreenDistance = r - g;
                    const blueDominantHue = redGreenDistance / colorRange;
                    hue = blueDominantHue + 4;//center of blue region is 4/6 aka 2/3 of the way around the color wheel
                    break;
                }
            }
            // Normalize hue to 0-1 range
            hue /= 6;
        }

        // Convert hue to degrees, and saturation and lightness to percentages
        return [hue * 360, saturation * 100, lightness * 100];
    }

    /**
     * Helper function to calculate one of the RGB component values for a given color
     * @param baseComponent - The base RGB component value for the color (in 0-1 range)
     * @param saturationAdjustment the amount to adjust the rgb component based on the saturation of that color (in 0-1 range)
     * @param hueOffset the angle on the hue color wheel to use for this rgb component (in 0-1 range)
     * @returns The calculated RGB component value (in 0-1 range)
     */
    calculateRgbComponent = (baseComponent: number, saturationAdjustment: number, hueOffset: number): number => {
        // Adjust hue offset to be within 0-1 range
        let adjustedHue = hueOffset;
        if (adjustedHue < 0) adjustedHue += 1;
        if (adjustedHue > 1) adjustedHue -= 1;

        // Calculate RGB value based on which sixth of the color wheel the hue falls in
        if (adjustedHue < 1/6) {
            // Hue is in the first sixth: linear interpolation from baseComponent to saturationAdjustment
            return baseComponent + (saturationAdjustment - baseComponent) * 6 * adjustedHue;
        } else if (adjustedHue < 1/2) {
            // Hue is in the second or third sixth: flat at saturationAdjustment
            return saturationAdjustment;
        } else if (adjustedHue < 2/3) {
            // Hue is in the fourth sixth: linear interpolation from saturationAdjustment back to baseComponent
            return baseComponent + (saturationAdjustment - baseComponent) * (2/3 - adjustedHue) * 6;
        } else {
            // Hue is in the fifth or sixth sixth: flat at baseComponent
            return baseComponent;
        }
    }

    hslToRgb(hsl: HSL): RGB {
        let [hue, saturation, lightness] = hsl;

        // Normalize HSL values
        hue /= 360; // Convert hue to 0-1 range
        saturation /= 100; // Convert saturation to 0-1 range
        lightness /= 100; // Convert lightness to 0-1 range

        let red, green, blue;

        if (saturation < EPSILON) {
            // If saturation is 0, the color is a shade of gray
            red = green = blue = lightness;
        } else {
            // Calculate color components based on lightness
            // This formula adjusts the range of the color components based on lightness
            // to maintain consistent perceived saturation across different lightness levels
            const saturationAdjustment = lightness < 0.5
                ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
            const baseComponent = 2 * lightness - saturationAdjustment;

            // Calculate RGB values
            red = this.calculateRgbComponent(baseComponent, saturationAdjustment, hue + 1/3);
            green = this.calculateRgbComponent(baseComponent, saturationAdjustment, hue);
            blue = this.calculateRgbComponent(baseComponent, saturationAdjustment, hue - 1/3);
        }

        const denormalize = (x: number) => Math.round(x * 255); // expand rgb component from 0-1 range to 0-255 range and force it to be an integer
        return [denormalize(red), denormalize(green), denormalize(blue)];
    }
    isNeutralColor(hsl: HSL): boolean {return hsl[1] < 10;} // Consider colors with saturation < 10% as neutral

    adjustNonNeutralColor(hsl: HSL): HSL {
        // eslint-disable-next-line prefer-const -- destructuring operation
        let [hue, saturation, lightness] = hsl;
        hue = (hue + 180) % 360;
        saturation= 100;//we want the new color to be as blatant/obvious as possible; it is a mediocre sort of contrast for the new color to differ from the original color by being less vibrant
        lightness = lightness > 50 ? Math.max(0, lightness - 30) : Math.min(100, lightness + 30);
        return [hue, saturation, lightness];
    }

    //this is imperfect- it neglects how, say, an element with a 30% alpha background color will have an actually
    // rendered background color that's a combination of its own (partly-transparent) background color choice and the
    // background color choice(s) of its ancestor(s); however, it should be sufficient for this purpose of finding a
    // good outline color for highlighting
    findEffectiveBackgroundColor(element: HTMLElement, alphaThreshold: number = 0.1): RGB | null {
        let currentElement: HTMLElement | null = element;
        while (currentElement) {
            const bgColor: string = this.domHelper.getComputedStyle(currentElement).backgroundColor;
            const [r, g, b, alpha] = this.parseRGBA(bgColor);
            if (alpha > alphaThreshold) {return [r, g, b];}
            currentElement = currentElement.parentElement;
        }
        // If no element with alpha > threshold is found, return null
        return null;
    }

    parseRGBA(color: string): [number, number, number, number] {
        let r = 0, g = 0, b = 0, a = 1;  // Default to opaque black
        if (color === 'transparent') {
            a = 0;  // Fully transparent
        } else if (color.startsWith('rgb(')) {
            const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                r = parseInt(match[1], 10);
                g = parseInt(match[2], 10);
                b = parseInt(match[3], 10);
            }
        } else if (color.startsWith('rgba(')) {
            const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
            if (match) {
                r = parseInt(match[1], 10);
                g = parseInt(match[2], 10);
                b = parseInt(match[3], 10);
                a = parseFloat(match[4]);
            }
        }
        return [r, g, b, a];
    }

}