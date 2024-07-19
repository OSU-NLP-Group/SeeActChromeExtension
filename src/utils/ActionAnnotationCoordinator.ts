import {Logger} from "loglevel";
import {ChromeWrapper} from "./ChromeWrapper";
import {v4 as uuidV4} from 'uuid';
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action,
    ActionStateChangeSeverity,
    AnnotationCoordinator2PanelPortMsgType,
    defaultIsAnnotatorMode,
    PanelToAnnotationCoordinatorPortMsgType,
    renderUnknownValue,
    setupModeCache,
    storageKeyForAnnotatorMode,
    storageKeyForEulaAcceptance
} from "./misc";
import {Mutex} from "async-mutex";
import {ServiceWorkerHelper} from "./ServiceWorkerHelper";
import JSZip from "jszip";
import Port = chrome.runtime.Port;

//todo make util files to break out pieces from AgentController that will be needed by both it
// and this; e.g. injecting a content script and managing its
// port, stuff related to capturing screenshots, sendZipToSidePanelForDownload()

/**
 * states for the action annotation coordinator Finite State Machine
 */
export enum AnnotationCoordinatorState {
    IDLE,//i.e. no in-progress annotation
    WAITING_FOR_ANNOTATION_DETAILS,//waiting for annotation details from the side panel
    WAITING_FOR_CONTENT_SCRIPT_INIT,//there's an in-progress annotation, but injection of content script hasn't completed yet
    ACTIVE,//partway through an event handler function
    WAITING_FOR_PAGE_INFO,// waiting for content script to retrieve page state (e.g. interactive elements) from page

    //anything else here?
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

    currAnnotationId: string | undefined;
    currAnnotationAction: Action.CLICK | Action.PRESS_ENTER | undefined;
    currAnnotationStateChangeSeverity: ActionStateChangeSeverity | undefined;
    currAnnotationActionDesc: string | undefined;



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
            if (this.state != AnnotationCoordinatorState.IDLE) {
                const errMsg = `side panel connected while in state ${this.state}`;
                this.logger.warn(`${errMsg}; resetting coordinator before accepting connection`);
                this.terminateAnnotationCapture(errMsg);
            }
            if (this.portToSidePanel) {
                const errMsg = `side panel connected while a side panel port was already open`;
                this.logger.warn(`${errMsg}; disconnecting old port and resetting coordinator before accepting connection`);
                this.portToSidePanel.disconnect();
                this.terminateAnnotationCapture(errMsg);
            }

            this.portToSidePanel = port;
            this.portToSidePanel.onMessage.addListener((message) => this.handleMessageFromSidePanel(message, port));
            //other needed stuff?
        });
    }

    handlePanelDisconnectFromCoordinator = async (port: Port): Promise<void> => {
        this.logger.info(`panel disconnected from coordinator: ${port.name}`);
        await this.mutex.runExclusive(() => {
            //any needed stuff?
            this.portToSidePanel = undefined;
            if (this.state !== AnnotationCoordinatorState.IDLE) {
                const errMsg = `panel disconnected while in state ${this.state}`;
                this.logger.warn(errMsg);
                this.terminateAnnotationCapture(errMsg);
            }
        });

    }

    handleMessageFromSidePanel = async (message: any, port: Port): Promise<void> => {
        if (message.type === PanelToAnnotationCoordinatorPortMsgType.ANNOTATION_DETAILS) {
            await this.mutex.runExclusive(() => {
                if (this.state !== AnnotationCoordinatorState.WAITING_FOR_ANNOTATION_DETAILS) {
                    const errMsg = `received annotation details message while in state ${this.state}`;
                    this.logger.warn(errMsg);
                    this.terminateAnnotationCapture(errMsg);
                    return;
                }
                this.currAnnotationAction = message.actionType;//todo validate
                this.currAnnotationStateChangeSeverity = message.actionStateChangeSeverity;//todo validate
                this.currAnnotationActionDesc = message.explanation;
                //todo next step!

                //temp, todo move next 3 lines to appropriate new place once more complex flow is implemented
                this.exportActionAnnotation().then(() => {
                    this.terminateAnnotationCapture("action annotation successfully exported").catch((error) => this.logger.error(`error while terminating annotation capture after exporting action annotation: ${renderUnknownValue(error)}`));
                });


                //todo change state to appropriate value for next step
            });
        } else {
            this.logger.warn(`unrecognized message type from side panel: ${message.type} on port ${port.name}`);
        }
    }

    exportActionAnnotation = async (): Promise<void> => {
        const zip = new JSZip();

        const annotationDetailsStr = JSON.stringify({
            annotationId: this.currAnnotationId,
            actionType: this.currAnnotationAction,
            actionStateChangeSeverity: this.currAnnotationStateChangeSeverity,
            explanation: this.currAnnotationActionDesc
        }, null, 4);
        zip.file("annotation_details.json", annotationDetailsStr);

        if (!this.portToSidePanel) {
            const errMsg = `no side panel port to send action annotation zip to for download`;
            this.logger.error(errMsg);
            await this.terminateAnnotationCapture(errMsg);
            return;
        }

        this.swHelper.sendZipToSidePanelForDownload(`details for annotated action ${this.currAnnotationId}`,
            zip, this.portToSidePanel, `action_annotation_${this.currAnnotationId}.zip`,
            AnnotationCoordinator2PanelPortMsgType.ANNOTATED_ACTION_EXPORT);
    }

    initiateActionAnnotationCapture = async (): Promise<void> => {
        await this.mutex.runExclusive(() => {
            if (this.isDisabledUntilEulaAcceptance) {
                this.logger.warn(`asked to initiate annotation capture while EULA acceptance is still pending; ignoring`);
                return;
            }
            if (!this.cachedAnnotatorMode) {
                this.logger.warn(`asked to initiate annotation capture while annotator mode is off; ignoring`);
                return;
            }

            if (!this.portToSidePanel) {
                const errMsg = `asked to initiate annotation capture without a side panel port`;
                this.logger.warn(errMsg);
                this.terminateAnnotationCapture(errMsg);
                return;
            }
            if (this.state !== AnnotationCoordinatorState.IDLE) {
                this.logger.info(`asked to initiate annotation capture while in state ${this.state}; ignoring`);
                return;
            }

            this.currAnnotationId = uuidV4();
            this.state = AnnotationCoordinatorState.WAITING_FOR_ANNOTATION_DETAILS;
            this.portToSidePanel.postMessage({type: AnnotationCoordinator2PanelPortMsgType.ANNOTATION_DETAILS_REQ});
        });
    }

    //todo implement the part of the flow that includes capturing 1 screenshot

    //todo implement the part of the flow that includes injecting content script and grabbing
    // full dom snapshot, interactive elements, mouse cursor position, and other page state
    // todo capture what is the hovered-element, if any: filter interactive elements for mouse pos being in their bounding box, then pick the one with highest z position (if multiple even here, break ties based on cursor closeness to center of bounding box)

    //todo highlight the hovered element visually and capture another screenshot

    terminateAnnotationCapture = async (reason: string): Promise<void> => {
        this.logger.info(`terminating the capture of action annotation ${this.currAnnotationId} for reason: ${reason}`);

        this.state = AnnotationCoordinatorState.IDLE;
        this.currAnnotationId = undefined;
        this.currAnnotationAction = undefined;
        this.currAnnotationStateChangeSeverity = undefined;
        this.currAnnotationActionDesc = undefined;
    }
}