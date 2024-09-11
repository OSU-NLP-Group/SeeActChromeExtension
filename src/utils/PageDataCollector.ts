import {BrowserHelper, makeElementDataSerializable} from "./BrowserHelper";
import {DomWrapper} from "./DomWrapper";
import {ChromeWrapper} from "./ChromeWrapper";
import {Logger} from "loglevel";
import {createNamedLogger} from "./shared_logging_setup";
import {
    ElementData,
    renderUnknownValue,
    scrollFractionOfViewport,
    SerializableElementData, sleep,
    ViewportDetails
} from "./misc";
import {Mutex} from "async-mutex";
import {
    AnnotationCoordinator2PagePortMsgType,
    Page2AnnotationCoordinatorPortMsgType,
    PageRequestType
} from "./messaging_defs";

export class PageDataCollector {
    private readonly mutex = new Mutex();

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

        try {
            this.browserHelper.resetElementAnalysis();
            if (message.type === AnnotationCoordinator2PagePortMsgType.REQ_ACTION_DETAILS_AND_CONTEXT) {
                await this.mutex.runExclusive(async () => {await this.collectActionDetailsAndContext();});
            } else if (message.type === AnnotationCoordinator2PagePortMsgType.REQ_GENERAL_PAGE_INFO_FOR_BATCH) {
                await this.mutex.runExclusive(async () => {await this.collectGeneralPageInfoForBatch();});
            } else {
                this.logger.warn(`unknown message from annotation coordinator: ${JSON.stringify(message)}`);
            }
        } catch (error: any) {
            this.logger.error(`error in content script while handling message from annotation coordinator: ${renderUnknownValue(error)}`);
            try {
                this.portToBackground.postMessage(
                    {type: Page2AnnotationCoordinatorPortMsgType.TERMINAL, error: renderUnknownValue(error)});
            } catch (postingError: any) {
                this.logger.error(`error in content script while sending message to annotation coordinator about script failure: ${renderUnknownValue(postingError)}`);
            }
        }
    }

    collectGeneralPageInfoForBatch = async () => {
        await this.browserHelper.clearElementHighlightingEarly();
        const initialVertScrollPos = this.domWrapper.getVertScrollPos();
        this.domWrapper.scrollBy(0, -initialVertScrollPos, "instant");
        await sleep(50);//just in case 'instant' scroll animation is still slower than js execution

        const generalViewportDetailsCaptures: Array<ViewportDetails> = [];
        const generalInteractiveElementsCaptures: Array<SerializableElementData[]> = [];

        const viewportHeight = this.domWrapper.getDocumentElement().clientHeight;
        const scrollDist = viewportHeight * scrollFractionOfViewport;
        const viewportInfo = this.domWrapper.getViewportInfo();
        let numCaptures = 1;
        const totalDistToScroll = viewportInfo.pageScrollHeight - viewportHeight;
        if (totalDistToScroll > 1) {numCaptures += Math.ceil(totalDistToScroll / scrollDist);}
        this.logger.debug(`scrolling through page to capture general page info for batch; viewport height: ${viewportHeight}; scroll distance: ${scrollDist}; num captures: ${numCaptures}; dist to scroll: ${totalDistToScroll}; argument to ceil(): ${totalDistToScroll / scrollDist}; viewport info: ${JSON.stringify(viewportInfo)}`);

        const checkAtBottom = (): boolean => {
            const currViewportInfo = this.domWrapper.getViewportInfo();
            return currViewportInfo.pageScrollHeight - currViewportInfo.height - currViewportInfo.scrollY < 1;
        }

        for (let captureIdx = 0; captureIdx < numCaptures; captureIdx++) {
            const resp = await this.chromeWrapper.sendMessageToServiceWorker(
                {reqType: PageRequestType.GENERAL_SCREENSHOT_FOR_SAFE_ELEMENTS,});
            if (resp.success) {
                this.logger.trace(`successfully got service worker to take general screenshot at scroll position ${this.domWrapper.getVertScrollPos()}`);
            } else {
                this.logger.warn(`failed to get service worker to take general screenshot at scroll position ${this.domWrapper.getVertScrollPos()}; response message: ${resp.message}; aborting general page info collection`);
                return;
            }
            const tsAfterScreenshot = performance.now();
            generalViewportDetailsCaptures.push(this.domWrapper.getViewportInfo());
            generalInteractiveElementsCaptures.push(this.browserHelper.getInteractiveElements()
                .map(makeElementDataSerializable));
            if (captureIdx < numCaptures - 1) {//i.e. didn't just complete the last capture
                this.domWrapper.scrollBy(0, scrollDist, "instant");
                // wait before next screenshot or the final scroll position check, in case 'instant' in ui terms is still
                // slower than javascript execution
                await sleep(50);
                const msForGeneralCaptures = performance.now() - tsAfterScreenshot;
                // Also, we need to wait at least half a second between screenshots because of a Chrome limit/quota
                await sleep(501 - msForGeneralCaptures);
            }
            //if captureIdx===numCaptures-2, we're about to do the last iteration of the loop, and we should be at the bottom
            if (captureIdx < numCaptures - 2 && checkAtBottom()) {
                this.logger.warn(`reached the bottom of the page earlier than expected when capturing all general page info; stopping early; viewport info: ${JSON.stringify(this.domWrapper.getViewportInfo())}; num captures so far ${captureIdx + 1}; expected number of captures needed: ${numCaptures}`);
                break;
            } else if (captureIdx === numCaptures - 2 && !checkAtBottom()
            ) {this.logger.warn(`final viewport info before last general page info capture doesn't indicate that we reached the bottom of the page; final viewport info: ${JSON.stringify(this.domWrapper.getViewportInfo())}`);}
        }

        this.domWrapper.scrollBy(0, initialVertScrollPos - this.domWrapper.getVertScrollPos());//scroll back to initial position

        try {
            this.portToBackground.postMessage({
                type: Page2AnnotationCoordinatorPortMsgType.GENERAL_PAGE_INFO_FOR_BATCH,
                generalViewportDetailsCaptures: generalViewportDetailsCaptures,
                generalInteractiveElementsCaptures: generalInteractiveElementsCaptures,
                url: this.domWrapper.getUrl(), title: this.domWrapper.getPageTitle(),
                htmlDump: this.domWrapper.getDocumentElement().outerHTML
            });
        } catch (error: any) {
            this.logger.error(`error in content script while sending general page info to annotation coordinator: ${renderUnknownValue(error)}`);
        }

    }

    collectActionDetailsAndContext = async (): Promise<void> => {
        await this.browserHelper.clearElementHighlightingEarly();
        let userMessage = "";//to be shown to the user in the status display in the side panel
        let userMessageDetails = "";//to be shown to the user as hovertext of the status display in the side panel

        const interactiveElementsData = this.browserHelper.getInteractiveElements();
        const elementsDataInSerializableForm = interactiveElementsData.map(makeElementDataSerializable);

        let targetElement: HTMLElement | undefined = undefined;
        let targetElementData: SerializableElementData | undefined = undefined;

        const currMouseX = this.mouseClientX;
        const currMouseY = this.mouseClientY;
        const foremostElementAtPoint = this.browserHelper.actualElementFromPoint(currMouseX, currMouseY);

        let shouldCaptureMousePosElemInfo = true;
        let actuallyHighlightedElement: HTMLElement | undefined = undefined;

        let candidateTargetElementsData = interactiveElementsData.filter(
            (elementData) => elementData.element.contains(foremostElementAtPoint)
                //check the parent's contents because of things like 1x1px <input> elements with a clickable <span> sibling element
                || elementData.element.parentElement?.contains(foremostElementAtPoint));
        if (candidateTargetElementsData.length === 0) {
            candidateTargetElementsData = interactiveElementsData.filter((elementData) => {
                const boundingRect = elementData.boundingBox;
                return boundingRect.tLx <= currMouseX && boundingRect.bRx >= currMouseX
                    && boundingRect.tLy <= currMouseY && boundingRect.bRy >= currMouseY;
            });
        }
        candidateTargetElementsData.sort(this.sortBestTargetElemFirst(currMouseX, currMouseY))
        if (candidateTargetElementsData.length > 0) {
            const fullTargetElemData = candidateTargetElementsData[0];
            targetElement = fullTargetElemData.element;
            if (foremostElementAtPoint) {
                actuallyHighlightedElement = await this.browserHelper.highlightElement(foremostElementAtPoint, interactiveElementsData);
            } else {actuallyHighlightedElement = await this.browserHelper.highlightElement(targetElement, interactiveElementsData);}
            targetElementData = makeElementDataSerializable(fullTargetElemData);
            shouldCaptureMousePosElemInfo = foremostElementAtPoint !== targetElement;
        } else {
            const activeElem = this.browserHelper.findRealActiveElement();
            if (activeElem) {
                const activeHtmlElement = activeElem;
                const activeElementHtmlSample = activeHtmlElement.outerHTML.slice(0, 300);

                const relevantInteractiveElementsEntry = interactiveElementsData.find((elementData) => elementData.element === activeHtmlElement);
                if (relevantInteractiveElementsEntry) {
                    this.logger.info(`no active element found at mouse coordinates ${currMouseX}, ${currMouseY}, but found active element: ${activeElementHtmlSample}`);
                    userMessage = "Target element chosen based on focus rather than mouse coordinates";
                    userMessageDetails = `Active element: ${activeElementHtmlSample}; \nmouse coordinates: (${currMouseX}, ${currMouseY})`;
                    //todo this highlighting doesn't show up in some sites where the focused element already has a pronounced border, maybe add additional logic?
                    targetElement = activeHtmlElement;
                    actuallyHighlightedElement = await this.browserHelper.highlightElement(targetElement, interactiveElementsData);
                    targetElementData = makeElementDataSerializable(relevantInteractiveElementsEntry);
                } else {
                    this.logger.warn(`no interactive elements found at mouse coordinates ${currMouseX}, ${currMouseY}; active element was defined but wasn't recognized as an interactive element: ${activeElementHtmlSample}`);
                }
            }
        }

        let mousePosElemData: SerializableElementData | undefined = undefined;
        if (foremostElementAtPoint && shouldCaptureMousePosElemInfo) {
            this.logger.debug(`element found at mouse coordinates ${currMouseX}, ${currMouseY}: ${foremostElementAtPoint.outerHTML.slice(0, 200)}; has onclick property?: ${Boolean(foremostElementAtPoint.onclick)}`);
            const mousePosElemFullData = this.browserHelper.getElementData(foremostElementAtPoint);
            const mousePosElemBox = mousePosElemFullData.boundingBox;
            if (mousePosElemBox.tLx <= currMouseX && mousePosElemBox.bRx >= currMouseX && mousePosElemBox.tLy <= currMouseY && mousePosElemBox.bRy >= currMouseY) {
                mousePosElemData = makeElementDataSerializable(mousePosElemFullData);
                mousePosElemData.interactivesIndex = interactiveElementsData.findIndex((elementData) => elementData.element === foremostElementAtPoint);
            } else {this.logger.warn(`foremost element found at mouse coordinates but its bounding box doesn't contain the mouse coordinates; element bounding box: ${JSON.stringify(mousePosElemBox)}`);}
        }

        let actuallyHighlightedElemData: SerializableElementData | undefined = undefined;
        if (actuallyHighlightedElement && (
            (foremostElementAtPoint && actuallyHighlightedElement !== foremostElementAtPoint)
            || (targetElement && actuallyHighlightedElement !== targetElement))) {
            const actualHighlitElemData = this.browserHelper.getElementData(actuallyHighlightedElement);
            actuallyHighlightedElemData = makeElementDataSerializable(actualHighlitElemData);
            actuallyHighlightedElemData.interactivesIndex = interactiveElementsData.findIndex((elementData) => elementData.element === actuallyHighlightedElement);
        }

        if (!targetElementData) {
            this.logger.warn(`no interactive elements found at mouse coordinates ${currMouseX}, ${currMouseY}`);
            userMessage = "Warning- No interactive elements found at mouse coordinates";
            userMessageDetails = `Mouse coordinates: (${currMouseX}, ${currMouseY}) relative to viewport: ${JSON.stringify(this.domWrapper.getViewportInfo())}`;
            await this.browserHelper.clearElementHighlightingEarly();
        }

        try {
            this.portToBackground.postMessage({
                type: Page2AnnotationCoordinatorPortMsgType.ANNOTATION_PAGE_INFO,
                targetElementData: targetElementData,
                interactiveElements: elementsDataInSerializableForm,
                mouseX: currMouseX,
                mouseY: currMouseY,
                viewportInfo: this.domWrapper.getViewportInfo(),
                userMessage: userMessage,
                userMessageDetails: userMessageDetails,
                url: this.domWrapper.getUrl(),
                mousePosElemData: mousePosElemData,
                highlitElemData: actuallyHighlightedElemData,
                htmlDump: this.domWrapper.getDocumentElement().outerHTML
            });
        } catch (error: any) {
            this.logger.error(`error in content script while sending interactive elements to annotation coordinator; error: ${renderUnknownValue(error)}`);
        }
    }

    private sortBestTargetElemFirst(currMouseX: number, currMouseY: number) {
        return (elementData1: ElementData, elementData2: ElementData): number => {
            //leaving this log message here because this method should be called pretty rarely
            this.logger.trace(`JUDGING ELEMENTS FOR RELEVANCE TO MOUSE CURSOR: element A ${elementData1.element.outerHTML.slice(0, 200)}; element B ${elementData2.element.outerHTML.slice(0, 200)}`);

            const elem1Box = elementData1.boundingBox;
            const elem2Box = elementData2.boundingBox;
            const overlapArea = Math.max(0, Math.min(elem1Box.bRx, elem2Box.bRx) - Math.max(elem1Box.tLx, elem2Box.tLx))
                * Math.max(0, Math.min(elem1Box.bRy, elem2Box.bRy) - Math.max(elem1Box.tLy, elem2Box.tLy));
            const elem1AreaOverlapFraction = overlapArea / ((elem1Box.bRx - elem1Box.tLx) * (elem1Box.bRy - elem1Box.tLy))
            const elem2AreaOverlapFraction = overlapArea / ((elem2Box.bRx - elem2Box.tLx) * (elem2Box.bRy - elem2Box.tLy));
            const elemOverlapAreaThreshold = 0.1;
            const shouldConsiderOverlapForegroundedness = elem1AreaOverlapFraction > elemOverlapAreaThreshold
                || elem2AreaOverlapFraction > elemOverlapAreaThreshold;

            const elem1CenterDistFromCursor = Math.sqrt(Math.pow(elementData1.centerCoords[0] - currMouseX, 2)
                + Math.pow(elementData1.centerCoords[1] - currMouseY, 2));
            const elem2CenterDistFromCursor = Math.sqrt(Math.pow(elementData2.centerCoords[0] - currMouseX, 2)
                + Math.pow(elementData2.centerCoords[1] - currMouseY, 2));
            //return negative if elem1 is closer to the cursor and so has smaller distance
            const relativeDistFromCursor = elem1CenterDistFromCursor - elem2CenterDistFromCursor;
            this.logger.debug(`relative distance from cursor: ${relativeDistFromCursor}`);

            let relativeRanking = 0;
            if (shouldConsiderOverlapForegroundedness) {
                this.logger.trace(`considering which element is foremost in overlap area; overlap is ${elem1AreaOverlapFraction} of element A's area and ${elem2AreaOverlapFraction} of element B's area`);
                const elem1ForegroundednessScore = this.browserHelper.judgeOverlappingElementsForForeground(elementData1, elementData2);
                if (elem1ForegroundednessScore === 2 || elem1ForegroundednessScore === -2) {
                    //rely solely on foregroundedness if one element is in the foreground in zero parts of the overlap zone
                    //return negative if elem1 is foremost and so should be earlier in the list of target element candidates
                    relativeRanking = -elem1ForegroundednessScore;
                } else if (elem1ForegroundednessScore === 1 || elem1ForegroundednessScore === -1) {
                    const marginForEquivalentMouseDistances = 10;
                    if ((relativeDistFromCursor < -marginForEquivalentMouseDistances && elem1ForegroundednessScore === 1)
                        || (relativeDistFromCursor > marginForEquivalentMouseDistances && elem1ForegroundednessScore === -1)) {
                        // if foregroundedness and cursor distance agree on which element is better
                        relativeRanking = relativeDistFromCursor;
                    } else if (Math.abs(relativeDistFromCursor) < marginForEquivalentMouseDistances) {
                        //if cursor distances are ~equal, rely on foregroundedness and sort things so the more foregrounded element is earlier in the list
                        relativeRanking = -elem1ForegroundednessScore;
                    } else {
                        //conflict between cursor distance and foregroundedness-in-overlap heuristics

                        //if one element is basically contained within the other, then pick the smaller/more specific element
                        const containedElemMinOverlap = 0.9, containerElemMaxOverlap = 0.5;
                        if (elem1AreaOverlapFraction > containedElemMinOverlap && elem2AreaOverlapFraction < containerElemMaxOverlap) {
                            this.logger.debug(`element A is ~contained within element B, so A should be ranked closer to the start of the target list; element A's overlap fraction is ${elem1AreaOverlapFraction} and element B's overlap fraction is ${elem2AreaOverlapFraction}; element A: ${elementData1.element.outerHTML.slice(0, 200)}; element B: ${elementData2.element.outerHTML.slice(0, 200)}`);
                            relativeRanking = -1;
                        } else if (elem2AreaOverlapFraction > containedElemMinOverlap && elem1AreaOverlapFraction < containerElemMaxOverlap) {
                            this.logger.debug(`element B is ~contained within element A, so B should be ranked closer to the start of the target list; element A's overlap fraction is ${elem1AreaOverlapFraction} and element B's overlap fraction is ${elem2AreaOverlapFraction}; element A: ${elementData1.element.outerHTML.slice(0, 200)}; element B: ${elementData2.element.outerHTML.slice(0, 200)}`);
                            relativeRanking = 1;
                        }

                        //can add more fallback heuristics here as new cases come up which require/inspire them
                    }
                } else {relativeRanking = relativeDistFromCursor;}
            } else {relativeRanking = relativeDistFromCursor;}
            return relativeRanking;
        };
    }

    setupMouseMovementTracking = () => {
        this.browserHelper.setupMouseMovementTracking((newMouseX: number, newMouseY: number) => {
            this.mouseClientX = newMouseX;
            this.mouseClientY = newMouseY;
        });
    }

    stopMouseMovementTracking = () => {this.browserHelper.terminateMouseMovementTracking();}

    handleVisibleIframesChange = async () => {
        await this.mutex.runExclusive(() => {
            this.logger.trace('visible iframes changed, resetting element analysis (i.e. for tree of iframes in page) and setting up mouse movement tracking listeners again');
            this.browserHelper.resetElementAnalysis();
            this.setupMouseMovementTracking();
        });
    }
}