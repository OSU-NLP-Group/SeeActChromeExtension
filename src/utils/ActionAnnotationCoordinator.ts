import {Logger} from "loglevel";
import {ChromeWrapper} from "./ChromeWrapper";
import {v4 as uuidV4} from 'uuid';
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action,
    ActionStateChangeSeverity,
    base64ToByteArray,
    defaultIsAnnotatorMode,
    exampleSerializableElemData,
    exampleViewportDetails,
    makeStrSafeForFilename,
    renderTs,
    renderUnknownValue,
    SerializableElementData,
    setupModeCache,
    storageKeyForAnnotatorMode,
    storageKeyForEulaAcceptance,
    ViewportDetails
} from "./misc";
import {Mutex} from "async-mutex";
import {ServiceWorkerHelper} from "./ServiceWorkerHelper";
import JSZip from "jszip";
import {
    AnnotationCoordinator2PagePortMsgType,
    AnnotationCoordinator2PanelPortMsgType,
    notSameKeys,
    Page2AnnotationCoordinatorPortMsgType,
    PanelToAnnotationCoordinatorPortMsgType
} from "./messaging_defs";
import Port = chrome.runtime.Port;

/**
 * states for the action annotation coordinator Finite State Machine
 */
export enum AnnotationCoordinatorState {
    IDLE,//i.e. no in-progress annotation
    WAITING_FOR_ANNOTATION_DETAILS,//waiting for annotation details from the side panel
    WAITING_FOR_CONTENT_SCRIPT_INIT,//injected content script hasn't notified coordinator of readiness yet
    WAITING_FOR_PAGE_INFO,// waiting for content script to retrieve page state (e.g. interactive elements) from page
    //todo state for 'waiting for start-of-batch data collection process to complete'
}

export class ActionAnnotationCoordinator {
    readonly mutex = new Mutex();

    cachedAnnotatorMode: boolean = defaultIsAnnotatorMode;
    isDisabledUntilEulaAcceptance: boolean = false;

    state: AnnotationCoordinatorState = AnnotationCoordinatorState.IDLE;

    portToContentScript: Port | undefined;
    portToSidePanel: Port | undefined;

    readonly swHelper: ServiceWorkerHelper;
    readonly chromeWrapper: ChromeWrapper
    readonly logger: Logger;

    idOfTabWithCapturer: number | undefined;

    batchId: string | undefined;
    batchStartTimestamp: number | undefined;

    //todo fields for start-of-batch data
    // list of screenshots of the page at different scroll positions
    // list of viewport details for the different screenshots
    // interactive elements and html dump for each scroll position  (when already scrolled to top)

    annotationIdsInBatch: string[] = [];
    actionTypesInBatch: Action[] = [];
    actionSeveritiesInBatch: ActionStateChangeSeverity[] = [];
    actionDescriptionsInBatch: string[] = [];
    actionUrlsInBatch: Array<string | undefined> = [];
    targetElementsInBatch: Array<SerializableElementData | undefined> = [];
    annotationViewportInfosInBatch: ViewportDetails[] = [];
    mouseCoordsInBatch: { x: number, y: number }[] = [];
    mouseElemsInBatch: Array<SerializableElementData | undefined> = [];
    highlitElemsInBatch: Array<SerializableElementData | undefined> = [];
    contextScreenshotsInBatch: string[] = [];
    targetedScreenshotsInBatch: Array<string | undefined> = [];
    //each annotation in the batch has its own collection of interactive elements at that point in time
    interactiveElementsSetsForAnnotationsInBatch: SerializableElementData[][] = [];
    annotationHtmlDumpsInBatch: string[] = [];

    currAnnotationId: string | undefined;
    //when adding support for more actions, don't forget to update input validation in handleMessageFromSidePanel()
    currAnnotationAction: Action.CLICK | Action.PRESS_ENTER | undefined;
    currAnnotationStateChangeSeverity: ActionStateChangeSeverity | undefined;
    currAnnotationActionDesc: string | undefined;

    currActionUrl: string | undefined;

    currActionTargetElement: SerializableElementData | undefined;
    currActionViewportInfo: ViewportDetails | undefined;
    currActionMouseCoords: { x: number, y: number } | undefined;
    mousePosElement: SerializableElementData | undefined;
    highlitElement: SerializableElementData | undefined;

    currActionContextScreenshotBase64: string | undefined;

    currActionTargetedScreenshotBase64: string | undefined;

    currActionInteractiveElements: SerializableElementData[] | undefined;
    currActionHtmlDump: string | undefined;

    constructor(logger?: Logger, serviceWorkerHelper?: ServiceWorkerHelper, chromeWrapper?: ChromeWrapper) {
        this.swHelper = serviceWorkerHelper ?? new ServiceWorkerHelper();
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper()
        this.logger = logger ?? createNamedLogger('action-annotation-coordinator', true);
        setupModeCache((newAnnotatorModeVal: boolean) => this.cachedAnnotatorMode = newAnnotatorModeVal, "annotator mode", storageKeyForAnnotatorMode, this.logger);

        if (chrome?.storage?.local) {
            chrome.storage.local.get([storageKeyForEulaAcceptance], (items) => {
                this.validateAndApplyAnnotatorOptions(true, items[storageKeyForEulaAcceptance])
            })
            chrome.storage.local.onChanged.addListener((
                changes: { [p: string]: chrome.storage.StorageChange }) => {
                this.logger.debug(`firing local-storage's change-listener for ActionAnnotationCoordinator, based on changes object: ${JSON.stringify(changes)}`)
                this.validateAndApplyAnnotatorOptions(false, changes[storageKeyForEulaAcceptance]?.newValue);
            })
        }
    }

    validateAndApplyAnnotatorOptions = (initOrUpdate: boolean, eulaAcceptance: unknown): void => {
        const contextStr = initOrUpdate ? "when loading options from storage" : "when processing an update from storage";
        if (typeof eulaAcceptance === "boolean") {
            this.logger.debug(`EULA acceptance value from storage: ${eulaAcceptance}`);
            this.isDisabledUntilEulaAcceptance = !eulaAcceptance;
        } else if (typeof eulaAcceptance !== "undefined") { this.logger.error(`invalid EULA acceptance value ${renderUnknownValue(eulaAcceptance)} in chrome.storage detected ${contextStr}; ignoring it`); }
    }

    addSidePanelConnection = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            if (this.state != AnnotationCoordinatorState.IDLE) {this.resetAnnotationCaptureCoordinator(`side panel connected while in state ${this.state}; resetting coordinator before accepting connection`);}
            if (this.portToSidePanel) {
                this.portToSidePanel.disconnect();
                this.resetAnnotationCaptureCoordinator(`side panel connected while a side panel port was already open; disconnecting old port and resetting coordinator before accepting connection`);
            }
            this.portToSidePanel = port;
            this.portToSidePanel.onMessage.addListener((message) => this.handleMessageFromSidePanel(message, port));
        });
    }

    handlePanelDisconnectFromCoordinator = async (port: Port): Promise<void> => {
        this.logger.info(`panel disconnected from coordinator: ${port.name}`);
        await this.mutex.runExclusive(() => {
            this.portToSidePanel = undefined;
            if (this.state !== AnnotationCoordinatorState.IDLE) {this.resetAnnotationCaptureCoordinator(`panel disconnected while in state ${this.state}`);}
        });
    }

    handleMessageFromSidePanel = async (message: any, sidePanelPort: Port): Promise<void> => {
        if (message.type === PanelToAnnotationCoordinatorPortMsgType.START_ANNOTATION_BATCH) {
            await this.mutex.runExclusive(async () => await this.ensureScriptInjectedAndStartBatch(sidePanelPort));
        } else if (message.type === PanelToAnnotationCoordinatorPortMsgType.ANNOTATION_DETAILS) {
            await this.mutex.runExclusive(async () => this.processAnnotationDetails(message));
        } else if (message.type === PanelToAnnotationCoordinatorPortMsgType.END_ANNOTATION_BATCH) {
            await this.mutex.runExclusive(async () => await this.concludeAnnotationsBatch());
        } else {
            this.logger.warn(`unrecognized message type from side panel: ${message.type} on port ${sidePanelPort.name}: ${JSON.stringify(message)
                .slice(0, 100)}`);
        }
    }

    private processAnnotationDetails(message: any) {
        if (this.state !== AnnotationCoordinatorState.WAITING_FOR_ANNOTATION_DETAILS) {
            this.resetAnnotationCaptureCoordinator(`received annotation details message while in state ${this.state}`);
            return;
        }

        const validationErrMsg = this.validateAndStoreAnnotationDetails(message);
        if (validationErrMsg) {
            this.resetAnnotationCaptureCoordinator(validationErrMsg);
            return;
        }

        if (!this.portToContentScript) {
            this.resetAnnotationCaptureCoordinator(`received annotation details message without a content script port`);
            return;
        }

        this.state = AnnotationCoordinatorState.WAITING_FOR_PAGE_INFO;
        this.portToContentScript.postMessage({type: AnnotationCoordinator2PagePortMsgType.REQ_ACTION_DETAILS_AND_CONTEXT});
    }

    private async ensureScriptInjectedAndStartBatch(sidePanelPort: Port) {
        if (this.batchId) {
            this.logger.warn(`asked to start annotations batch while batch id ${this.batchId} is still defined; ignoring`);
            sidePanelPort.postMessage({
                type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: "Batch already in progress",
                details: `batch id: ${this.batchId}; batch start timestamp: ${renderTs(this.batchStartTimestamp)}`
            });
            return;
        }
        if (this.state !== AnnotationCoordinatorState.IDLE) {
            this.logger.warn(`asked to start annotations batch while in state ${AnnotationCoordinatorState[this.state]}; ignoring`);
            sidePanelPort.postMessage({
                type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: "Coordinator not ready",
                details: `current state: ${AnnotationCoordinatorState[this.state]}`
            });
            return;
        }

        const currTabInfo = await this.swHelper.getActiveTab();
        if (this.idOfTabWithCapturer === undefined || currTabInfo.id !== this.idOfTabWithCapturer) {
            this.logger.trace(`injecting content script in tab ${currTabInfo.id} for batch of annotation captures`);
            const preInjectStateUpdates = (tabId: number, url?: string): string | undefined => {
                this.idOfTabWithCapturer = tabId;
                this.currActionUrl = url;
                if (url === undefined) {this.logger.warn(`no URL found for tab ${tabId} when starting capturer for annotation ${this.currAnnotationId}`);}
                this.state = AnnotationCoordinatorState.WAITING_FOR_CONTENT_SCRIPT_INIT;
                return undefined;//tells the injector that there's no error that would necessitate abort of inject
            }
            const injectionErrMsg = await this.swHelper.injectContentScript("annotation content script", './src/page_data_collection.js', preInjectStateUpdates);
            if (injectionErrMsg) {
                this.idOfTabWithCapturer = undefined;
                this.resetAnnotationCaptureCoordinator(`ERROR while injecting content script for annotation capture`, injectionErrMsg)
                return;
            }
        } else {
            this.startAnnotationsBatch();
        }
    }

    startAnnotationsBatch = () => {
        if (!this.portToSidePanel) {
            this.resetAnnotationCaptureCoordinator("no side panel port to send batch start message to");
            return;
        }
        this.batchId = uuidV4();
        this.batchStartTimestamp = Date.now();
        this.logger.info(`starting annotations batch ${this.batchId}`);
        this.portToSidePanel.postMessage({
            type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: "Batch started",
            details: `batch id: ${this.batchId}; batch start timestamp: ${renderTs(this.batchStartTimestamp)}`
        });
        //todo send message to content script to start collecting data for the batch
    }

    concludeAnnotationsBatch = async () => {
        if (this.state !== AnnotationCoordinatorState.IDLE) {
            this.resetAnnotationCaptureCoordinator(`asked to conclude annotations batch while in state ${this.state}`);
            return;
        } else if (!this.batchId || this.batchStartTimestamp === undefined) {
            this.resetAnnotationCaptureCoordinator(`asked to conclude annotations batch while batch id ${this.batchId} is not defined or batch start timestamp ${renderTs(this.batchStartTimestamp)} is undefined`);
            return;
        }
        const numIds = this.annotationIdsInBatch.length, numActionTypes = this.actionTypesInBatch.length;
        const numSeverities = this.actionSeveritiesInBatch.length;
        const numDescriptions = this.actionDescriptionsInBatch.length, numUrls = this.actionUrlsInBatch.length;
        const numTargetElems = this.targetElementsInBatch.length;
        const numViewportInfos = this.annotationViewportInfosInBatch.length;
        const numMouseCoords = this.mouseCoordsInBatch.length, numMouseElems = this.mouseElemsInBatch.length;
        const numHighlitElems = this.highlitElemsInBatch.length;
        const numContextScreenshots = this.contextScreenshotsInBatch.length;
        const numTargetedScreenshots = this.targetedScreenshotsInBatch.length;
        const numSetsOfInteractiveElements = this.interactiveElementsSetsForAnnotationsInBatch.length;
        const numHtmlDumps = this.annotationHtmlDumpsInBatch.length;
        if (numIds !== numActionTypes || numActionTypes !== numSeverities || numSeverities !== numDescriptions
            || numDescriptions !== numUrls || numUrls !== numTargetElems || numTargetElems !== numViewportInfos
            || numViewportInfos !== numMouseCoords || numMouseCoords !== numMouseElems
            || numMouseElems !== numHighlitElems || numHighlitElems !== numContextScreenshots
            || numContextScreenshots !== numTargetedScreenshots || numTargetedScreenshots !== numSetsOfInteractiveElements
            || numSetsOfInteractiveElements !== numHtmlDumps) {
            this.resetAnnotationCaptureCoordinator("at end of batch, the lists for accumulating the different parts of each annotation in the batch had different lengths!",
                `# annotations: ${numIds}, # action types: ${numActionTypes}, # severities: ${numSeverities}, # descriptions: ${numDescriptions}, # url's: ${numUrls}, # target elements (including entries where target element is undefined): ${numTargetElems}, # viewport info's: ${numViewportInfos}, # mouse coordinates: ${numMouseCoords}, # mouse elements: ${numMouseElems}; # highlighted elements: ${numHighlitElems}, # context screenshots: ${numContextScreenshots}, # targeted screenshots: ${numTargetedScreenshots}, # sets of interactive elements: ${numSetsOfInteractiveElements}, # html dumps: ${numHtmlDumps}`);
            return;
        }

        await this.exportActionAnnotationsBatch();
        //todo? export all logs for this batch (would need substantial changes here; plus either substantially change 
        // the logger/db code or adapt it to allow storing/using annotation-batch id instead of agent-task id sometimes 
        // (they are both UUID's, but it could be quite confusing; maybe add a new field to distinguish annotation batch vs agent task))
        this.resetAnnotationCaptureCoordinator("action annotation batch successfully exported", `batch id: ${this.batchId}; batch start timestamp: ${renderTs(this.batchStartTimestamp)}`, false);
    }

    validateAndStoreAnnotationDetails = (message: any): string | undefined => {
        const actionTypeVal = message.actionType;
        if (actionTypeVal !== Action.CLICK && actionTypeVal !== Action.PRESS_ENTER) {
            return `invalid action type value ${renderUnknownValue(actionTypeVal)} in annotation details message from side panel`;
        } else { this.currAnnotationAction = actionTypeVal; }

        const actionStateChangeSeverityVal = message.actionStateChangeSeverity;
        if (!Object.values(ActionStateChangeSeverity).includes(actionStateChangeSeverityVal)) {
            return `invalid action state change severity value ${renderUnknownValue(actionStateChangeSeverityVal)} in annotation details message from side panel`;
        } else { this.currAnnotationStateChangeSeverity = actionStateChangeSeverityVal; }

        const actionDescriptionVal = message.explanation;
        if (typeof actionDescriptionVal !== "string") {
            return `invalid action description value ${renderUnknownValue(actionDescriptionVal)} in annotation details message from side panel`;
        } else { this.currAnnotationActionDesc = actionDescriptionVal; }

        return undefined;
    }

    addPageConnection = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            if (this.state !== AnnotationCoordinatorState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
                this.resetAnnotationCaptureCoordinator(`received connection from content script while not waiting for content script initialization, but rather in state ${AnnotationCoordinatorState[this.state]}`);
                return;
            }
            this.logger.trace("content script connected to annotation coordinator in service worker");
            port.onMessage.addListener(this.handlePageMsgToAnnotationCoordinator);
            port.onDisconnect.addListener(this.handlePageDisconnectFromAnnotationCoordinator);
            this.portToContentScript = port;
        });
    }

    handlePageMsgToAnnotationCoordinator = async (message: any, pagePort: Port): Promise<void> => {
        if (message.type === Page2AnnotationCoordinatorPortMsgType.READY) {
            this.logger.info("content script sent READY message to annotation coordinator in service worker");
            await this.mutex.runExclusive(() => this.respondToContentScriptInitialized(pagePort));
        } else if (message.type === Page2AnnotationCoordinatorPortMsgType.PAGE_INFO) {
            await this.mutex.runExclusive(() => this.processActionContextAndDetails(message));
        } else if (message.type === Page2AnnotationCoordinatorPortMsgType.TERMINAL) {
            await this.mutex.runExclusive(() => this.resetAnnotationCaptureCoordinator(`content script encountered fatal error`, message.error));
        } else {
            this.logger.warn(`unknown message from content script:${renderUnknownValue(message).slice(0, 100)}`);
        }
    }

    private respondToContentScriptInitialized(pagePort: Port) {
        if (this.state !== AnnotationCoordinatorState.WAITING_FOR_CONTENT_SCRIPT_INIT) {
            this.resetAnnotationCaptureCoordinator(`content script sent READY message while annotation coordinator is in state ${AnnotationCoordinatorState[this.state]}`);
            return;
        }
        if (this.batchId) {
            this.logger.warn(`content script sent READY message while batch id ${this.batchId} is still defined; ignoring`);
            //todo change above line if I eventually implement auto-recovery from losing connection to content script
        } else {this.startAnnotationsBatch();}

        this.state = AnnotationCoordinatorState.IDLE;
        this.logger.info(`content script connection ${pagePort.name} is initialized and ready for action annotation`);
    }

    private async processActionContextAndDetails(message: any) {
        let preconditionErrMsg: string | undefined;
        if (this.state !== AnnotationCoordinatorState.WAITING_FOR_PAGE_INFO) {preconditionErrMsg = `content script sent PAGE_INFO message while coordinator was in state ${AnnotationCoordinatorState[this.state]}`;}
        if (!this.portToSidePanel) {preconditionErrMsg = `content script sent PAGE_INFO message when annotation coordinator didn't have a side panel port`;}
        if (preconditionErrMsg) {
            this.resetAnnotationCaptureCoordinator(preconditionErrMsg);
            return;
        }

        if (message.userMessage) {
            this.logger.info(`content script sent user message: ${message.userMessage}`);
            this.portToSidePanel!.postMessage({//null check performed at top of function
                type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: message.userMessage,
                details: message.userMessageDetails
            });
        }

        const validationErrMsg = this.validateAndStoreActionContextAndDetails(message);
        if (validationErrMsg) {
            this.resetAnnotationCaptureCoordinator(validationErrMsg);
            return;
        }

        if (this.currActionTargetElement) {
            //data collector in content script highlighted the target element before sending info back
            const screenshotCapture = await this.swHelper.captureScreenshot("annotation_action_targeted");
            if (screenshotCapture.error) {
                this.resetAnnotationCaptureCoordinator(`error capturing screenshot of target element for action annotation: ${screenshotCapture.error}`);
                return;
            }
            this.currActionTargetedScreenshotBase64 = screenshotCapture.screenshotBase64;
        }

        if (!this.currAnnotationId) {
            this.logger.error("no current annotation id when storing a completed action annotation");
        } else if (!this.currAnnotationAction) {
            this.logger.error("no current annotation action type when storing a completed action annotation");
        } else if (!this.currAnnotationStateChangeSeverity) {
            this.logger.error("no current annotation state change severity when storing a completed action annotation");
        } else if (this.currAnnotationActionDesc === undefined) {
            this.logger.error("current annotation action description was undefined (not just empty-string) when storing a completed action annotation");
        }//URL or target element can be undefined
        else if (!this.currActionViewportInfo) {
            this.logger.error("no current action viewport info when storing a completed action annotation");
        } else if (!this.currActionMouseCoords) {
            this.logger.error("no current action mouse coordinates when storing a completed action annotation");
        } //mouse position element can be undefined, same with highlighted element
        else if (!this.currActionContextScreenshotBase64) {
            this.logger.error("no current action context screenshot when storing a completed action annotation");
        }//targeted screenshot can be undefined
        else if (this.currActionInteractiveElements === undefined) {
            this.logger.error("no current action interactive elements when storing a completed action annotation");
        } else if (!this.currActionHtmlDump) {
            this.logger.error("no current action HTML dump when storing a completed action annotation");
        } else {
            this.annotationIdsInBatch.push(this.currAnnotationId);
            this.actionTypesInBatch.push(this.currAnnotationAction);
            this.actionSeveritiesInBatch.push(this.currAnnotationStateChangeSeverity);
            this.actionDescriptionsInBatch.push(this.currAnnotationActionDesc);
            this.actionUrlsInBatch.push(this.currActionUrl);
            this.targetElementsInBatch.push(this.currActionTargetElement);
            this.annotationViewportInfosInBatch.push(this.currActionViewportInfo);
            this.mouseCoordsInBatch.push(this.currActionMouseCoords);
            this.mouseElemsInBatch.push(this.mousePosElement);
            this.highlitElemsInBatch.push(this.highlitElement);
            this.contextScreenshotsInBatch.push(this.currActionContextScreenshotBase64);
            this.targetedScreenshotsInBatch.push(this.currActionTargetedScreenshotBase64);
            this.interactiveElementsSetsForAnnotationsInBatch.push(this.currActionInteractiveElements);
            this.annotationHtmlDumpsInBatch.push(this.currActionHtmlDump);

            let annotationSummary = `annotation id ${this.currAnnotationId}; mouse coords: ${JSON.stringify(this.currActionMouseCoords)}, scroll position: ${this.currActionViewportInfo.scrollX}, ${this.currActionViewportInfo.scrollY}`;
            if (this.currActionTargetElement) {annotationSummary += `; target element: ${this.currActionTargetElement.description.slice(100)}`;}
            if (this.currAnnotationActionDesc) {annotationSummary += `; action description: ${this.currAnnotationActionDesc.slice(100)}`;}
            this.portToSidePanel!.postMessage({//null check was performed at top of function
                type: AnnotationCoordinator2PanelPortMsgType.ANNOTATION_CAPTURED_CONFIRMATION, summary: annotationSummary
            });
            this.resetCurrAnnotationDetails();
        }
        this.state = AnnotationCoordinatorState.IDLE;
    }

    validateAndStoreActionContextAndDetails = (message: any): string | undefined => {
        const targetElemDataVal = message.targetElementData;
        if (targetElemDataVal === undefined) {
            this.logger.info("no target element data in PAGE_INFO message from content script");
        } else if (typeof targetElemDataVal !== "object" || notSameKeys(targetElemDataVal, exampleSerializableElemData)) {
            return `invalid target element data ${renderUnknownValue(targetElemDataVal)} in PAGE_INFO message from content script`;
        } else { this.currActionTargetElement = targetElemDataVal; }

        const interactiveElementsVal: unknown = message.interactiveElements;
        if (!Array.isArray(interactiveElementsVal) || interactiveElementsVal.some((entry) =>
            typeof entry !== "object" || notSameKeys(entry, exampleSerializableElemData))) {
            return `invalid interactive elements data ${renderUnknownValue(interactiveElementsVal)} in PAGE_INFO message from content script`;
        } else { this.currActionInteractiveElements = interactiveElementsVal; }

        const viewportDtlsVal = message.viewportInfo
        if (typeof viewportDtlsVal !== "object" || notSameKeys(viewportDtlsVal, exampleViewportDetails)) {
            return `invalid viewport details ${renderUnknownValue(viewportDtlsVal)} in PAGE_INFO message from content script`;
        } else { this.currActionViewportInfo = viewportDtlsVal; }

        const mouseXVal: unknown = message.mouseX;
        const mouseYVal: unknown = message.mouseY;
        if (typeof mouseXVal !== "number" || typeof mouseYVal !== "number") {
            return `invalid mouse coordinates ${renderUnknownValue(mouseXVal)}, ${renderUnknownValue(mouseYVal)} in PAGE_INFO message from content script`;
        } else { this.currActionMouseCoords = {x: mouseXVal, y: mouseYVal}; }

        const htmlDumpVal: unknown = message.htmlDump;
        if (typeof htmlDumpVal !== "string") {
            return `invalid HTML dump value ${renderUnknownValue(htmlDumpVal)} in PAGE_INFO message from content script`;
        } else { this.currActionHtmlDump = htmlDumpVal; }

        const urlVal: unknown = message.url;
        if (typeof urlVal !== "string") {
            return `invalid URL value ${renderUnknownValue(urlVal)} in PAGE_INFO message from content script`;
        } else if (this.currActionUrl !== urlVal) {
            if (this.currActionUrl) {this.logger.debug(`for annotation ${this.currAnnotationId}, URL from chrome's tool for injecting content script into active tab was ${this.currActionUrl} but page URL according to content script was actually ${urlVal}`); }
            this.currActionUrl = urlVal;
        }

        const mousePosElemDataVal = message.mousePosElemData;
        if (mousePosElemDataVal !== undefined) {
            if (typeof mousePosElemDataVal !== "object" || notSameKeys(mousePosElemDataVal, exampleSerializableElemData)) {
                return `invalid mouse position element data ${renderUnknownValue(mousePosElemDataVal)} in PAGE_INFO message from content script`;
            } else { this.mousePosElement = mousePosElemDataVal; }
        }

        const highlitElemDataVal = message.highlitElemData;
        if (highlitElemDataVal !== undefined) {
            if (typeof highlitElemDataVal !== "object" || notSameKeys(highlitElemDataVal, exampleSerializableElemData)) {
                return `invalid actually-highlighted-element data ${renderUnknownValue(highlitElemDataVal)} in PAGE_INFO message from content script`;
            } else { this.highlitElement = highlitElemDataVal; }
        }

        return undefined;//i.e. no validation errors, all data stored successfully
    }

    handlePageDisconnectFromAnnotationCoordinator = async (port: Port): Promise<void> => {
        await this.mutex.runExclusive(() => {
            this.portToContentScript = undefined;
            this.idOfTabWithCapturer = undefined;
            this.resetAnnotationCaptureCoordinator(`content script ${port.name} disconnected`, undefined, false);
        });
    }

    exportActionAnnotationsBatch = async (): Promise<void> => {
        const zip = new JSZip();

        const safeElemsDataFolder = zip.folder("safe_elements_data");
        if (safeElemsDataFolder === null) {
            this.logger.error("while trying to make folder in zip file for data about safe elements on the page, JSZip misbehaved (returned null from zip.folder() call); cannot proceed");
            return;
        }

        //todo store safe elements data (from the start-of-batch data collection process)

        const actionAnnotationsFolder = zip.folder("manual_action_annotations");
        if (actionAnnotationsFolder === null) {
            this.logger.error("while trying to make folder in zip file for manual annotations of (generally unsafe) actions on the page, JSZip misbehaved (returned null from zip.folder() call); cannot proceed");
            return;
        }

        function replaceBlankWithNull(key: any, value: any) {return typeof value === "string" && value.trim().length === 0 ? null : value;}

        //the concludeAnnotationsBatch() method (which calls this) already confirmed that all the lists for the completed
        // annotations in the batch have the same length, so we can just iterate over the indices of one of them
        for (let annotationIdx = 0; annotationIdx < this.annotationIdsInBatch.length; annotationIdx++) {
            const annotationId = this.annotationIdsInBatch[annotationIdx];
            const actionType = this.actionTypesInBatch[annotationIdx];
            const actionStateChangeSeverity = this.actionSeveritiesInBatch[annotationIdx];
            const actionDescription = this.actionDescriptionsInBatch[annotationIdx];
            const annotationUrl = this.actionUrlsInBatch[annotationIdx];
            const targetElementData = this.targetElementsInBatch[annotationIdx];
            const viewportInfo = this.annotationViewportInfosInBatch[annotationIdx];
            const mouseCoords = this.mouseCoordsInBatch[annotationIdx];
            const mousePosElementData = this.mouseElemsInBatch[annotationIdx];
            const highlitElementData = this.highlitElemsInBatch[annotationIdx];
            const contextScreenshotBase64 = this.contextScreenshotsInBatch[annotationIdx];
            const targetedScreenshotBase64 = this.targetedScreenshotsInBatch[annotationIdx];
            const interactiveElements = this.interactiveElementsSetsForAnnotationsInBatch[annotationIdx];
            const htmlDump = this.annotationHtmlDumpsInBatch[annotationIdx];

            let annotationFolderName = `BROKEN_action_annotation_${actionStateChangeSeverity}_${annotationId}`;
            if (targetElementData) {annotationFolderName = `action_annotation_${actionStateChangeSeverity}_Target_${makeStrSafeForFilename(targetElementData.description.slice(0, 30))}_${annotationId}.zip`;}
            const currAnnotationFolder = actionAnnotationsFolder.folder(annotationFolderName);
            if (currAnnotationFolder === null) {
                this.logger.error(`while trying to make folder in zip file for annotation ${annotationId}, JSZip misbehaved (returned null from zip.folder() call); cannot proceed`);
                return;
            }
            const annotationDtlsObj = {
                annotationId: annotationId, actionType: actionType,
                actionStateChangeSeverity: actionStateChangeSeverity, description: actionDescription,
                url: annotationUrl, targetElementData: targetElementData, viewportInfo: viewportInfo,
                mousePosition: mouseCoords, mousePosElementData: mousePosElementData,
                actuallyHighlightedElementData: highlitElementData
            };
            const annotationDetailsStr = JSON.stringify(annotationDtlsObj, replaceBlankWithNull, 4);
            currAnnotationFolder.file("annotation_details.json", annotationDetailsStr);

            if (contextScreenshotBase64) {
                currAnnotationFolder.file("action_context_screenshot.png", base64ToByteArray(contextScreenshotBase64))
            } else {this.logger.error(`no context screenshot found for action annotation ${annotationId}`);}

            if (targetedScreenshotBase64) {
                currAnnotationFolder.file("action_targeted_screenshot.png", base64ToByteArray(targetedScreenshotBase64))
            } else {this.logger.warn(`no targeted screenshot found for action annotation ${annotationId}`);}

            if (interactiveElements != undefined) {
                currAnnotationFolder.file("interactive_elements.json", JSON.stringify(interactiveElements, null, 4));
            } else {this.logger.error(`no interactive elements found for action annotation ${annotationId}`);}

            if (this.currActionHtmlDump) {
                currAnnotationFolder.file("page_html_dump.html", htmlDump);
            } else {this.logger.error(`no HTML dump found for action annotation ${annotationId}`);}
        }

        if (!this.portToSidePanel) {
            this.resetAnnotationCaptureCoordinator(`no side panel port to send action annotation zip to for download`);
            return;
        }

        let zipFileName = `annotation_batch_${this.batchId}.zip`;
        //todo instead simply rely on url provided by content script at start of batch processing
        if (this.actionUrlsInBatch && this.actionUrlsInBatch[0]) {
            zipFileName = `annotation_batch_${this.batchId}_from_${
                makeStrSafeForFilename(this.actionUrlsInBatch[0].replace(/https?:\/\//, "").slice(0, 30))}.zip`;
            //todo also use page title (provided by content script at start of batch processing) in file name
        }

        this.swHelper.sendZipToSidePanelForDownload(`annotated actions batch ${this.batchId}`, zip,
            this.portToSidePanel, zipFileName, AnnotationCoordinator2PanelPortMsgType.ANNOTATED_ACTIONS_EXPORT);
    }

    initiateActionAnnotationCapture = async (): Promise<void> => {
        await this.mutex.runExclusive(async () => {
            if (this.isDisabledUntilEulaAcceptance) {
                this.logger.info(`asked to initiate annotation capture while EULA acceptance is still pending; ignoring`);
                return;
            }
            if (!this.cachedAnnotatorMode) {
                this.logger.info(`asked to initiate annotation capture while annotator mode is off; ignoring`);
                return;
            }
            if (this.state !== AnnotationCoordinatorState.IDLE) {
                this.logger.info(`asked to initiate annotation capture while in state ${this.state}; ignoring`);
                return;
            }
            if (!this.portToSidePanel) {
                this.resetAnnotationCaptureCoordinator(`asked to initiate annotation capture without a side panel port`);
                return;
            }
            if (!this.portToContentScript) {
                this.resetAnnotationCaptureCoordinator(`asked to initiate annotation capture when capturer hasn't been started up in the current tab yet`);
                return;
            }
            if (!this.batchId) {
                this.logger.info(`asked to initiate annotation capture without a batch id; ignoring`);
                this.portToSidePanel.postMessage({
                    type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: "No batch in progress",
                    details: "Please start a batch before capturing annotations"
                });
                return;
            }

            const currTabInfo = await this.swHelper.getActiveTab();
            if (currTabInfo.id !== this.idOfTabWithCapturer) {
                this.resetAnnotationCaptureCoordinator(`asked to initiate annotation capture while active tab id ${currTabInfo.id} differs from the tab id ${this.idOfTabWithCapturer} with the content script`);
                return;
            }

            this.currAnnotationId = uuidV4();
            const screenshotCapture = await this.swHelper.captureScreenshot("annotation_action_context");
            if (screenshotCapture.error) {
                this.resetAnnotationCaptureCoordinator(`error capturing context screenshot for action annotation: ${screenshotCapture.error}`);
                return;
            }
            this.currActionContextScreenshotBase64 = screenshotCapture.screenshotBase64;

            this.state = AnnotationCoordinatorState.WAITING_FOR_ANNOTATION_DETAILS;
            this.portToSidePanel.postMessage({type: AnnotationCoordinator2PanelPortMsgType.REQ_ANNOTATION_DETAILS});
        });
    }

    resetAnnotationCaptureCoordinator = (reason: string, details?: string, wasResetFromError = true): void => {
        (wasResetFromError ? this.logger.error : this.logger.info)(`terminating the capture of action annotation ${this.currAnnotationId} for reason: ${reason} with details ${details}`);
        this.portToSidePanel?.postMessage(
            {type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: reason, details: details});
        this.state = AnnotationCoordinatorState.IDLE;
        this.batchId = undefined;
        this.batchStartTimestamp = undefined;
        this.annotationIdsInBatch = [];
        this.actionTypesInBatch = [];
        this.actionSeveritiesInBatch = [];
        this.actionDescriptionsInBatch = [];
        this.actionUrlsInBatch = [];
        this.targetElementsInBatch = [];
        this.annotationViewportInfosInBatch = [];
        this.mouseCoordsInBatch = [];
        this.mouseElemsInBatch = [];
        this.highlitElemsInBatch = [];
        this.contextScreenshotsInBatch = [];
        this.targetedScreenshotsInBatch = [];
        this.interactiveElementsSetsForAnnotationsInBatch = [];
        this.annotationHtmlDumpsInBatch = [];

        this.resetCurrAnnotationDetails();
    }

    private resetCurrAnnotationDetails() {
        this.currAnnotationId = undefined;
        this.currAnnotationAction = undefined;
        this.currAnnotationStateChangeSeverity = undefined;
        this.currAnnotationActionDesc = undefined;
        this.currActionUrl = undefined;
        this.currActionTargetElement = undefined;
        this.currActionViewportInfo = undefined;
        this.currActionMouseCoords = undefined;
        this.mousePosElement = undefined;
        this.highlitElement = undefined;
        this.currActionContextScreenshotBase64 = undefined;
        this.currActionTargetedScreenshotBase64 = undefined;
        this.currActionInteractiveElements = undefined;
        this.currActionHtmlDump = undefined;
    }
}