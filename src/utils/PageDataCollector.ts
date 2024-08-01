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

        this.browserHelper.resetElementAnalysis();
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
                const activeElem = this.browserHelper.findRealActiveElement();
                if (activeElem) {
                    const activeHtmlElement = activeElem as HTMLElement;
                    const activeElementHtmlSample = activeHtmlElement.outerHTML.slice(0, 100);

                    const relevantInteractiveElementsEntry = interactiveElementsData.find((elementData) => elementData.element === activeHtmlElement);
                    if (relevantInteractiveElementsEntry) {
                        this.logger.info(`no active element found at mouse coordinates ${currMouseX}, ${currMouseY}, but found active element: ${activeElementHtmlSample}`);
                        userMessage = "Target element chosen based on focus rather than mouse coordinates";
                        userMessageDetails = `Active element: ${activeElementHtmlSample}; \nmouse coordinates: (${currMouseX}, ${currMouseY})`;
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
                userMessageDetails = `Mouse coordinates: (${currMouseX}, ${currMouseY}) relative to viewport: ${JSON.stringify(this.domWrapper.getViewportInfo())}`;
                await this.browserHelper.clearElementHighlightingEarly();
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
            const elem1Foregroundedness = this.browserHelper.judgeOverlappingElementsForForeground(elementData1, elementData2);

            if (elem1Foregroundedness !== 0) {
                //return negative if elem1 is foremost and so should be earlier in the list of target element candidates
                return -elem1Foregroundedness;
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

    setupMouseMovementTracking = () => {
        this.browserHelper.setupMouseMovementTracking((newMouseX: number, newMouseY: number) => {
            this.mouseClientX = newMouseX;
            this.mouseClientY = newMouseY;
        });
    }
}