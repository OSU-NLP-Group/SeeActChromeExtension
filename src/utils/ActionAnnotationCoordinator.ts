import {Logger} from "loglevel";
import {ChromeWrapper} from "./ChromeWrapper";
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action, ActionStateChangeSeverity,
    defaultIsAnnotatorMode, PanelToAnnotationCoordinatorPortMsgType,
    renderUnknownValue,
    setupModeCache,
    storageKeyForAnnotatorMode,
    storageKeyForEulaAcceptance
} from "./misc";
import Port = chrome.runtime.Port;
import { Mutex } from "async-mutex";
import {ServiceWorkerHelper} from "./ServiceWorkerHelper";

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
                this.logger.warn(`side panel connected while in state ${this.state}`);
                //todo maybe call reset method once available
            }
            if (this.portToSidePanel) {
                this.logger.warn(`side panel connected while a side panel port was already open`);
                this.portToSidePanel.disconnect();
                //todo maybe call reset method once available
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
        });

    }

    handleMessageFromSidePanel = async (message: any, port: Port): Promise<void> => {
        if (message.type === PanelToAnnotationCoordinatorPortMsgType.ANNOTATION_DETAILS) {
            await this.mutex.runExclusive(() => {
                if (this.state !== AnnotationCoordinatorState.WAITING_FOR_ANNOTATION_DETAILS) {
                    //todo
                    return;
                }
                this.currAnnotationAction = message.actionType;//todo validate
                this.currAnnotationStateChangeSeverity = message.actionStateChangeSeverity;//todo validate
                this.currAnnotationActionDesc = message.explanation;
                //todo next step!

                //todo change state to appropriate value for next step
            });
        } else {
            this.logger.warn(`unrecognized message type from side panel: ${message.type} on port ${port.name}`);
        }
    }

    //todo method to bundle assembled info in a zip blob for sending to side panel for download
    // heavily inspired by (reusing code from?) related AgentController method


    //todo method to be called by background script listener when keyboard shortcut is invoked
    // remember that it should first check this.eulaAcceptance and this.annotatorMode to see if it should proceed
    // it should also check if side panel is connected and otherwise abort

    //todo initially implement flow where it requests annotation details from side panel, then gets them, then assembles
    // them in a json (which is stuffed in a jszip object), then sends a blob made from that jszip object to the side panel for download

    //todo implement the part of the flow that includes capturing 1 screenshot

    //todo implement the part of the flow that includes injecting content script and grabbing
    // full dom snapshot, interactive elements, mouse cursor position, and other page state
    // todo capture what is the hovered-element, if any: filter interactive elements for mouse pos being in their bounding box, then pick the one with highest z position (if multiple even here, break ties based on cursor closeness to center of bounding box)

    //todo highlight the hovered element visually and capture another screenshot

    //todo need reset method for end of an annotation process, and for when something goes wrong
}