import {BrowserHelper, makeElementDataSerializable} from "./BrowserHelper";
import {DomWrapper} from "./DomWrapper";
import {ChromeWrapper} from "./ChromeWrapper";
import {Logger} from "loglevel";
import {createNamedLogger} from "./shared_logging_setup";
import {
    AnnotationCoordinator2PagePortMsgType, ElementData,
    Page2AnnotationCoordinatorPortMsgType,
    renderUnknownValue,
    SerializableElementData
} from "./misc";


export class PageDataCollector {
    private browserHelper: BrowserHelper;
    private domWrapper: DomWrapper;
    private chromeWrapper: ChromeWrapper;
    hasCoordinatorEverResponded: boolean = false;

    portToBackground: chrome.runtime.Port;
    readonly logger: Logger;

    public mouseClientX = -1;
    public mouseClientY = -1;

    constructor(portToBackground: chrome.runtime.Port, browserHelper?: BrowserHelper, logger?: Logger,
                chromeWrapper?: ChromeWrapper, domWrapper?: DomWrapper) {
        this.portToBackground = portToBackground;
        this.browserHelper = browserHelper ?? new BrowserHelper();
        this.domWrapper = domWrapper ?? new DomWrapper(window);
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = logger ?? createNamedLogger('page-data-collector', false);
    }

    handleRequestFromAnnotationCoordinator = async (message: any) => {
        this.logger.trace(`message received from annotation coordinator: ${JSON.stringify(message)} by page ${document.URL}`);
        this.hasCoordinatorEverResponded = true;
        if (message.type === AnnotationCoordinator2PagePortMsgType.REQ_ACTION_DETAILS_AND_CONTEXT) {
            let userMessage = "";//to be shown to the user in the status display in the side panel
            let userMessageDetails = "";//to be shown to the user as hovertext of the status display in the side panel

            const interactiveElementsData = this.browserHelper.getInteractiveElements();
            const elementsDataInSerializableForm = interactiveElementsData.map(makeElementDataSerializable);

            let targetElementData: SerializableElementData | undefined = undefined;

            const currMouseX = this.mouseClientX;
            const currMouseY = this.mouseClientY;
            const candidateTargetElementsData = interactiveElementsData.filter((elementData) => {
                return elementData.boundingBox.tLx <= currMouseX && currMouseX <= elementData.boundingBox.bRx &&
                    elementData.boundingBox.tLy <= currMouseY && currMouseY <= elementData.boundingBox.bRy;
            });
            candidateTargetElementsData.sort(this.sortBestTargetElemFirst(currMouseX, currMouseY))
            if (candidateTargetElementsData.length > 0) {
                await this.browserHelper.highlightElement(candidateTargetElementsData[0].element.style);
                targetElementData = makeElementDataSerializable(candidateTargetElementsData[0]);
            } else {
                const activeElem = this.domWrapper.dom.activeElement;
                if (activeElem && activeElem.tagName.toLowerCase() !== "body") {
                    const activeHtmlElement = activeElem as HTMLElement;
                    const activeElementHtmlSample = activeHtmlElement.outerHTML.slice(0, 100);

                    const relevantInteractiveElementsEntry = interactiveElementsData.find((elementData) => elementData.element === activeHtmlElement);
                    if (relevantInteractiveElementsEntry) {
                        this.logger.info(`no active element found at mouse coordinates ${currMouseX}, ${currMouseY}, but found active element: ${activeElementHtmlSample}`);
                        userMessage = "Target element chosen based on focus rather than mouse coordinates";
                        //what we send as hovertext gets treated as markdown and then converted into html by the side panel manager
                        userMessageDetails = `Active element: \`\`\`${activeElementHtmlSample}\`\`\`;  \nmouse coordinates: (${currMouseX}, ${currMouseY})`;
                        //todo this highlighting doesn't show up in some sites where the focused element already has a pronounced border, maybe add additional logic?
                        await this.browserHelper.highlightElement(activeHtmlElement.style);
                        targetElementData = makeElementDataSerializable(relevantInteractiveElementsEntry);
                    } else {
                        this.logger.warn(`no interactive elements found at mouse coordinates ${currMouseX}, ${currMouseY}; active element was defined but wasn't recognized as an interactive element: ${activeElementHtmlSample}`);
                    }
                }
            }
            if (!targetElementData) {
                this.logger.warn(`no interactive elements found at mouse coordinates ${currMouseX}, ${currMouseY}`);
                userMessage = "Warning- No interactive elements found at mouse coordinates";
                userMessageDetails = `Mouse coordinates: (${currMouseX}, ${currMouseY}) relative to viewport: \`\`\`${JSON.stringify(this.domWrapper.getViewportInfo())}\`\`\``;
            }

            try {
                this.portToBackground.postMessage({
                    type: Page2AnnotationCoordinatorPortMsgType.PAGE_INFO, targetElementData: targetElementData,
                    interactiveElements: elementsDataInSerializableForm, mouseX: currMouseX, mouseY: currMouseY,
                    viewportInfo: this.domWrapper.getViewportInfo(), userMessage: userMessage,
                    userMessageDetails: userMessageDetails, htmlDump: this.domWrapper.getDocumentElement().outerHTML
                });
            } catch (error: any) {
                this.logger.error(`error in content script while sending interactive elements to annotation coordinator; error: ${renderUnknownValue(error)}`);
            }
        } else {
            this.logger.warn(`unknown message from annotation coordinator: ${JSON.stringify(message)}`);
        }
    }

    private sortBestTargetElemFirst(currMouseX: number, currMouseY: number) {
        return (elementData1: ElementData, elementData2: ElementData): number => {
            const elem1ZPos: number = this.browserHelper.getNumericZIndex(elementData1.element);
            const elem2ZPos: number = this.browserHelper.getNumericZIndex(elementData2.element);
            if (elem1ZPos !== elem2ZPos) {
                //return negative if elem1 is foremost and so has larger z index
                return elem2ZPos - elem1ZPos;
            } else {
                const elem1CenterDistFromCursor = Math.sqrt(Math.pow(elementData1.centerCoords[0] - currMouseX, 2)
                    + Math.pow(elementData1.centerCoords[1] - currMouseY, 2));
                const elem2CenterDistFromCursor = Math.sqrt(Math.pow(elementData2.centerCoords[0] - currMouseX, 2)
                    + Math.pow(elementData2.centerCoords[1] - currMouseY, 2));

                //return negative if elem1 is closer to the cursor and so has smaller distance
                return elem1CenterDistFromCursor - elem2CenterDistFromCursor;
            }
        };
    }

    /*
        findMousePositionFromHoverPseudoClass = () => {
            const startTsForHoverSearch = performance.now();
            const elementUnderMouse = this.browserHelper.enhancedQuerySelector(':hover', document,
                elem => !this.browserHelper.calcIsHidden(elem) && elem.tagName.toLowerCase() !== "html");
            //if broader elements like the root html are showing as having :hover, maybe do exhaustive search then pick the element with :hover pseudoclass and the highest z index?
            // can reliably test this idea by removing the check for elem.tagName.toLowerCase() !== "html" in the elemFilter after implementing the above line's idea

            this.logger.debug(`time taken for exhaustive search for :hover pseudo class is ${performance.now() - startTsForHoverSearch} ms`);
            if (elementUnderMouse) {
                const elemBounds = elementUnderMouse.getBoundingClientRect();
                this.mouseClientX = (elemBounds.left + elemBounds.right) / 2;
                this.mouseClientY = (elemBounds.top + elemBounds.bottom) / 2;

                const mouseElemInfo = this.browserHelper.getElementData(elementUnderMouse);
                if (mouseElemInfo) {
                    this.logger.info(`found mouse position from exhaustive search for :hover pseudo class: ${this.mouseClientX}, ${this.mouseClientY}; element details: ${JSON.stringify(makeElementDataSerializable(mouseElemInfo))}`);
                }
                this.logger.info(`found mouse position from exhaustive search for :hover pseudo class: ${this.mouseClientX}, ${this.mouseClientY}; but couldn't construct ElementData from element ${elementUnderMouse.tagName}`);
            } else {
                this.logger.warn("no element found under mouse from exhaustive search for :hover pseudo class");
            }
        }
    */
}