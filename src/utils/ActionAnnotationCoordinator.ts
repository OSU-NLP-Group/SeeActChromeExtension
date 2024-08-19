import {Logger} from "loglevel";
import {ChromeWrapper} from "./ChromeWrapper";
import {v4 as uuidV4} from 'uuid';
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action,
    ActionStateChangeSeverity,
    base64ToByteArray,
    BoundingBox,
    defaultIsAnnotatorMode,
    exampleSerializableElemData,
    exampleViewportDetails,
    isValidBoundingBox,
    makeStrSafeForFilename,
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
    //todo batch id and start-timestamp

    //todo fields for start-of-batch data
    // list of screenshots of the page at different scroll positions
    // list of viewport details for the different screenshots
    // interactive elements and html dump for each scroll position  (when already scrolled to top)

    //todo list of completed annotation ids in batch
    //todo list for in-progress batch of completed annotation actions, severities, descriptions, url's, target
    // element's, viewport info's, mouse coords, mouse elem bounding box's, mouse elem's, highlighted element bounding
    // boxes, highlighted elements, context screenshots, targeted screenshots, interactive elements, html dumps

    currAnnotationId: string | undefined;
    //when adding support for more actions, don't forget to update input validation in handleMessageFromSidePanel()
    currAnnotationAction: Action.CLICK | Action.PRESS_ENTER | undefined;
    currAnnotationStateChangeSeverity: ActionStateChangeSeverity | undefined;
    currAnnotationActionDesc: string | undefined;

    currActionUrl: string | undefined;

    currActionTargetElement: SerializableElementData | undefined;
    currActionViewportInfo: ViewportDetails | undefined;
    currActionMouseCoords: { x: number, y: number } | undefined;
    mousePosElemBoundingBox: BoundingBox | undefined;
    mousePosElement: SerializableElementData | undefined;
    highlitElemBoundingBox: BoundingBox | undefined;
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
            await this.mutex.runExclusive(async () => await this.ensureScriptInjectedAndStartBatch());
        } else if (message.type === PanelToAnnotationCoordinatorPortMsgType.ANNOTATION_DETAILS) {
            await this.mutex.runExclusive(async () => {
                this.processAnnotationDetails(message);
            });
        } else {
            this.logger.warn(`unrecognized message type from side panel: ${message.type} on port ${sidePanelPort.name}: ${JSON.stringify(message).slice(0, 100)}`);
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

    private async ensureScriptInjectedAndStartBatch() {
        //todo double check that batch id is undefined and that state is idle
        const currTabInfo = await this.swHelper.getActiveTab();
        //todo revise this to inject the capturer if it isn't there already, otherwise proceed
        if (currTabInfo.id !== undefined && currTabInfo.id === this.idOfTabWithCapturer) {
            this.resetAnnotationCaptureCoordinator(`capturer already started in current tab`, `current tab id: ${currTabInfo.id}`);
            return;
        }
        const preInjectStateUpdates = (tabId: number, url?: string): string | undefined => {
            this.idOfTabWithCapturer = tabId;
            this.currActionUrl = url;
            if (url === undefined) {
                this.logger.warn(`no URL found for tab ${tabId} when starting capturer for annotation ${this.currAnnotationId}`);
            }
            this.state = AnnotationCoordinatorState.WAITING_FOR_CONTENT_SCRIPT_INIT;
            return undefined;//tells the injector that there's no error that would necessitate abort of inject
        }
        const injectionErrMsg = await this.swHelper.injectContentScript("annotation content script", './src/page_data_collection.js', preInjectStateUpdates);
        if (injectionErrMsg) {
            this.idOfTabWithCapturer = undefined;
            this.resetAnnotationCaptureCoordinator(`ERROR while injecting content script for annotation capture`, injectionErrMsg)
            return;
        }
        //todo if script was already injected, call method for start of batch data collection
    }

    validateAndStoreAnnotationDetails = (message: any): string | undefined => {
        const actionTypeVal = message.actionType;
        if (actionTypeVal !== Action.CLICK && actionTypeVal !== Action.PRESS_ENTER) {
            return `invalid action type value ${renderUnknownValue(actionTypeVal)} in annotation details message from side panel`;
        } else { this.currAnnotationAction = actionTypeVal; }

        const actionStateChangeSeverityVal = message.actionStateChangeSeverity;
        if (!Object.values(ActionStateChangeSeverity).includes(actionStateChangeSeverityVal)) {
            return`invalid action state change severity value ${renderUnknownValue(actionStateChangeSeverityVal)} in annotation details message from side panel`;
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
        //todo if batch id _not_ defined, call method for start of batch data collection (including a bunch of screenshots)
        // otherwise log warning about unexpected page reconnection (since eventually I should probably implement
        // automatic re-inject on connection loss like what agentController does)
        this.state = AnnotationCoordinatorState.IDLE;
        this.logger.info(`content script connection ${pagePort.name} is initialized and ready for action annotation`);
    }

    //todo method for start of batch data collection (including generation/storage of batch id and sending message to
    // page to request the several-step start-of-batch data collection process)

    private async processActionContextAndDetails(message: any) {
        let preconditionErrMsg: string | undefined;
        if (this.state !== AnnotationCoordinatorState.WAITING_FOR_PAGE_INFO) {
            preconditionErrMsg = `content script sent PAGE_INFO message while coordinator was in state ${AnnotationCoordinatorState[this.state]}`;
        }
        if (!this.portToSidePanel) {
            preconditionErrMsg = `content script sent PAGE_INFO message when annotation coordinator didn't have a side panel port`;
        }
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
        //todo store current annotation id through HTML dump in corresponding lists for the current batch
        // and move to IDLE state

        //todo delete the next two lines
        await this.exportActionAnnotation();
        this.resetAnnotationCaptureCoordinator("action annotation successfully exported", undefined, false);
    }

    //todo have handler method for end-batch command which exports the collected data and resets the coordinator

    validateAndStoreActionContextAndDetails = (message: any): string|undefined => {
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
        } else { this.currActionUrl = urlVal; }

        const mousePosElemBoundingBoxVal: unknown = message.mousePosElemBoundingBox;
        if (mousePosElemBoundingBoxVal !== undefined) {
            if (!isValidBoundingBox(mousePosElemBoundingBoxVal)) {
                return `invalid mouse position element bounding box value ${renderUnknownValue(mousePosElemBoundingBoxVal)} in PAGE_INFO message from content script`;
            } else { this.mousePosElemBoundingBox = mousePosElemBoundingBoxVal; }
        }

        const mousePosElemDataVal = message.mousePosElemData;
        if (mousePosElemDataVal !== undefined) {
            if (typeof mousePosElemDataVal !== "object" || notSameKeys(mousePosElemDataVal, exampleSerializableElemData)) {
                return `invalid mouse position element data ${renderUnknownValue(mousePosElemDataVal)} in PAGE_INFO message from content script`;
            } else { this.mousePosElement = mousePosElemDataVal; }
        }

        const highlitElemBoundingBoxVal: unknown = message.highlitElemBoundingBox;
        if (highlitElemBoundingBoxVal !== undefined) {
            if (!isValidBoundingBox(highlitElemBoundingBoxVal)) {
                return `invalid actually-highlighted-element bounding box value ${renderUnknownValue(highlitElemBoundingBoxVal)} in PAGE_INFO message from content script`;
            } else { this.highlitElemBoundingBox = highlitElemBoundingBoxVal; }
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

    exportActionAnnotation = async (): Promise<void> => {
        const zip = new JSZip();

        function replaceBlankWithNull(key: any, value: any) {return typeof value === "string" && value.trim().length === 0 ? null : value;}

        //todo add files in the zip (in their own folder) for the start-of-batch data collection

        //todo everything from here down to the part that adds the html dump should all be in the body of a for loop
        // and the loop should iterate over the lists of data for the completed annotations in the current batch,
        // putting each completed annotation's data into a separate folder inside the zip
        const annotationDtlsObj = {
            annotationId: this.currAnnotationId,
            actionType: this.currAnnotationAction,
            actionStateChangeSeverity: this.currAnnotationStateChangeSeverity,
            description: this.currAnnotationActionDesc,
            url: this.currActionUrl,
            targetElementData: this.currActionTargetElement,
            mousePosition: this.currActionMouseCoords,
            mousePosElementData: this.mousePosElement,
            mousePosElemBoundingBox: this.mousePosElemBoundingBox,
            actuallyHighlightedElementData: this.highlitElement,
            actuallyHighlightedElementBoundingBox: this.highlitElemBoundingBox,
            viewportInfo: this.currActionViewportInfo
        };
        if (annotationDtlsObj.mousePosElementData) {delete annotationDtlsObj.mousePosElemBoundingBox;}
        if (annotationDtlsObj.actuallyHighlightedElementData) {delete annotationDtlsObj.actuallyHighlightedElementBoundingBox;}
        const annotationDetailsStr = JSON.stringify(annotationDtlsObj, replaceBlankWithNull, 4);
        zip.file("annotation_details.json", annotationDetailsStr);

        if (this.currActionContextScreenshotBase64) {
            zip.file("action_context_screenshot.png", base64ToByteArray(this.currActionContextScreenshotBase64))
        } else {
            this.logger.error(`no context screenshot found for action annotation ${this.currAnnotationId}`);
        }

        if (this.currActionTargetedScreenshotBase64) {
            zip.file("action_targeted_screenshot.png", base64ToByteArray(this.currActionTargetedScreenshotBase64))
        } else {
            this.logger.warn(`no targeted screenshot found for action annotation ${this.currAnnotationId}`);
        }


        if (this.currActionInteractiveElements != undefined) {
            zip.file("interactive_elements.json", JSON.stringify(this.currActionInteractiveElements, null, 4));
        } else {
            this.logger.error(`no interactive elements found for action annotation ${this.currAnnotationId}`);
        }

        if (this.currActionHtmlDump) {
            zip.file("page_html_dump.html", this.currActionHtmlDump);
        } else {
            this.logger.error(`no HTML dump found for action annotation ${this.currAnnotationId}`);
        }

        if (!this.portToSidePanel) {
            this.resetAnnotationCaptureCoordinator(`no side panel port to send action annotation zip to for download`);
            return;
        }

        let zipFilename = `BROKEN_action_annotation_${this.currAnnotationStateChangeSeverity}_${this.currAnnotationId}.zip`;
        if (this.currActionTargetElement) {
            zipFilename = `action_annotation_${this.currAnnotationStateChangeSeverity}_Target_${makeStrSafeForFilename(this.currActionTargetElement.description.slice(0,30))}_${this.currAnnotationId}.zip`;
        }
        this.swHelper.sendZipToSidePanelForDownload(`details for annotated action ${this.currAnnotationId}`,
            zip, this.portToSidePanel, zipFilename, AnnotationCoordinator2PanelPortMsgType.ANNOTATED_ACTIONS_EXPORT);
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
            //todo check that batch id is defined, error if not

            if (!this.portToSidePanel) {
                this.resetAnnotationCaptureCoordinator(`asked to initiate annotation capture without a side panel port`);
                return;
            }

            if (!this.portToContentScript) {
                this.resetAnnotationCaptureCoordinator(`asked to initiate annotation capture when capturer hasn't been started up in the current tab yet`);
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
        this.portToSidePanel?.postMessage({type: AnnotationCoordinator2PanelPortMsgType.NOTIFICATION, msg: reason, details: details});
        this.state = AnnotationCoordinatorState.IDLE;
        this.batchId = undefined;
        this.batchStartTimestamp = undefined;

        this.currAnnotationId = undefined;
        this.currAnnotationAction = undefined;
        this.currAnnotationStateChangeSeverity = undefined;
        this.currAnnotationActionDesc = undefined;
        this.currActionUrl = undefined;
        this.currActionTargetElement = undefined;
        this.currActionViewportInfo = undefined;
        this.currActionMouseCoords = undefined;
        this.currActionContextScreenshotBase64 = undefined;
        this.currActionTargetedScreenshotBase64 = undefined;
        this.currActionInteractiveElements = undefined;
        this.currActionHtmlDump = undefined;
        this.mousePosElemBoundingBox = undefined;
        this.mousePosElement = undefined;
        this.highlitElemBoundingBox = undefined;
        this.highlitElement = undefined;
    }
}