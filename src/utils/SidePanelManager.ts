import {ChromeWrapper} from "./ChromeWrapper";
import {createNamedLogger} from "./shared_logging_setup";
import {Logger} from "loglevel";
import {
    Action,
    ActionStateChangeSeverity,
    buildGenericActionDesc,
    defaultIsAnnotatorMode,
    defaultIsMonitorMode,
    defaultShouldWipeActionHistoryOnStart,
    renderUnknownValue,
    setupModeCache,
    storageKeyForAnnotatorMode,
    storageKeyForEulaAcceptance,
    storageKeyForMonitorMode,
    storageKeyForShouldWipeHistoryOnTaskStart
} from "./misc";
import {Mutex} from "async-mutex";
import {ActionInfo} from "./AgentController";
import saveAs from "file-saver";
import {marked} from "marked";
import {
    AgentController2PanelPortMsgType,
    AnnotationCoordinator2PanelPortMsgType,
    expectedMsgForPortDisconnection,
    Panel2AgentControllerPortMsgType,
    panelToAnnotationCoordinatorPort,
    PanelToAnnotationCoordinatorPortMsgType,
    panelToControllerPort
} from "./messaging_defs";

class ChunkedDownloadHandler {
    expectedNextChunkIndex = -1;
    numChunks = -1;
    chunks: number[][] = [];

    isChunkedDownloadInProgress = (): boolean => {
        if (this.expectedNextChunkIndex >= 0 && this.numChunks >= 0 && this.chunks.length === this.expectedNextChunkIndex) {
            return true;
        } else if (this.expectedNextChunkIndex < 0 && this.numChunks < 0 && this.chunks.length === 0) {
            return false;
        } else {
            const errMsg = `inconsistent state in ChunkedDownloadHandler: expectedNextChunkIndex=${this.expectedNextChunkIndex}, numChunks=${this.numChunks}, chunks.length=${this.chunks.length}, reset download handler`;
            this.reset();
            throw new Error(errMsg);
        }
    }

    processDownloadChunk = (dataChunk: number[], chunkIndex: number, totalNumChunks: number
    ): [string | undefined, number[] | undefined] => {
        let errMsg: string | undefined;
        let finalizedDownloadNumbersArr: number[] | undefined;
        //assuming for now that Chrome will maintain the order of a sequence of messages sent over a port
        // Will add logic to support out-of-order messages only if that proves necessary
        if (this.isChunkedDownloadInProgress()) {
            if (chunkIndex === this.expectedNextChunkIndex && totalNumChunks === this.numChunks && dataChunk.length > 0) {
                this.chunks.push(dataChunk);
                if (chunkIndex < totalNumChunks - 1) {
                    this.expectedNextChunkIndex++;
                } else if (chunkIndex === totalNumChunks - 1) {
                    finalizedDownloadNumbersArr = this.chunks.flat();
                } else { throw new Error(`chunk index reached illegal value ${chunkIndex} that's >= num chunks ${totalNumChunks}`); }
            } else {errMsg = `received inconsistent input partway through chunked download: chunk index=${chunkIndex}, expected chunk index=${this.expectedNextChunkIndex}, num chunks=${totalNumChunks}, expected num chunks=${this.numChunks}, and data chunk length=${dataChunk.length}`;}
        } else if (chunkIndex === 0 && totalNumChunks > 0 && dataChunk.length > 0) {
            this.chunks.push(dataChunk);
            this.expectedNextChunkIndex = 1;
            this.numChunks = totalNumChunks;
        } else {errMsg = `received bad input at start of chunked download: in message, chunk index=${chunkIndex}, num chunks=${totalNumChunks}, and data chunk length=${dataChunk.length}`;}

        if (errMsg || finalizedDownloadNumbersArr) { this.reset(); }
        return [errMsg, finalizedDownloadNumbersArr];
    }

    reset = (): void => {
        this.expectedNextChunkIndex = -1;
        this.numChunks = -1;
        this.chunks = [];
    }
}


export interface SidePanelElements {
    eulaComplaintContainer: HTMLDivElement,
    annotatorContainer: HTMLDivElement,
    annotatorStartButton: HTMLButtonElement,
    annotatorEndButton: HTMLButtonElement,
    annotatorActionType: HTMLSelectElement,
    annotatorActionStateChangeSeverity: HTMLSelectElement,
    annotatorExplanationField: HTMLTextAreaElement,
    annotatorStatusDiv: HTMLDivElement,
    startButton: HTMLButtonElement;
    taskSpecField: HTMLTextAreaElement;
    agentStatusDiv: HTMLDivElement;
    statusPopup: HTMLSpanElement;
    killButton: HTMLButtonElement;
    historyList: HTMLOListElement;
    pendingActionDiv: HTMLDivElement;
    monitorModeContainer: HTMLDivElement;
    monitorFeedbackField: HTMLTextAreaElement;
    monitorApproveButton: HTMLButtonElement;
    monitorRejectButton: HTMLButtonElement;
    unaffiliatedLogsExportButton: HTMLButtonElement;
}

/**
 * states for the Side Panel Manager Finite State Machine
 */
enum SidePanelMgrState {
    IDLE,
    WAIT_FOR_CONNECTION_INIT,
    WAIT_FOR_TASK_STARTED,
    WAIT_FOR_PENDING_ACTION_INFO,
    WAIT_FOR_MONITOR_RESPONSE,//unlike the others, in this state the panel is primarily waiting for input from the user to the side panel's UI rather than from the background (service worker)
    WAIT_FOR_ACTION_PERFORMED_RECORD,
    WAIT_FOR_TASK_ENDED//panel only reaches this state for a task that the user decides to kill, not for a task that ends naturally
}

export class SidePanelManager {
    private readonly eulaComplaintContainer: HTMLDivElement;

    private readonly annotatorContainer: HTMLDivElement;
    private readonly annotatorStartButton: HTMLButtonElement;
    private readonly annotatorEndButton: HTMLButtonElement;
    private readonly annotatorActionType: HTMLSelectElement;
    private readonly annotatorActionStateChangeSeverity: HTMLSelectElement;
    private readonly annotatorExplanationField: HTMLTextAreaElement;
    private readonly annotatorStatusDiv: HTMLDivElement;

    private readonly startButton: HTMLButtonElement;
    private readonly taskSpecField: HTMLTextAreaElement;
    private readonly agentStatusDiv: HTMLDivElement;
    private readonly agentStatusPopup: HTMLSpanElement;
    private readonly killButton: HTMLButtonElement;
    private readonly historyList: HTMLOListElement;
    private readonly pendingActionDiv: HTMLDivElement;
    private readonly monitorModeContainer: HTMLDivElement;
    private readonly monitorFeedbackField: HTMLTextAreaElement;
    private readonly monitorApproveButton: HTMLButtonElement;
    private readonly monitorRejectButton: HTMLButtonElement;
    private readonly unaffiliatedLogsExportButton: HTMLButtonElement;

    private readonly chromeWrapper: ChromeWrapper;
    readonly logger: Logger;
    private readonly dom: Document;
    private readonly chunkedDownloadHandler: ChunkedDownloadHandler;

    readonly mutex = new Mutex();

    //allow read access to this without mutex; only written to by the handleMonitorModeCacheUpdate method
    //has to initially be true (even if the default is actually false) so that handleMonitorModeCacheUpdate() call
    // in constructor will minimize the monitor mode UI
    cachedMonitorMode = true;
    shouldWipeActionHistoryOnTaskStart = defaultShouldWipeActionHistoryOnStart;
    //because this is above other ui elements, we don't need complex resizing logic for when it becomes enabled/visible vs disabled/hidden
    cachedIsAnnotatorMode = defaultIsAnnotatorMode;

    isMonitorModeTempEnabled = false;

    private state: SidePanelMgrState = SidePanelMgrState.IDLE;
    public agentControllerPort?: chrome.runtime.Port;
    public agentControllerReady = false;
    public annotationCoordinatorPort?: chrome.runtime.Port;
    lastHeightOfMonitorModeContainer = 0;//px

    public mouseClientX = -1;
    public mouseClientY = -1;

    constructor(elements: SidePanelElements, chromeWrapper?: ChromeWrapper, logger?: Logger, overrideDoc?: Document,
                chunkedDownloadHandler?: ChunkedDownloadHandler) {
        this.eulaComplaintContainer = elements.eulaComplaintContainer;
        this.annotatorContainer = elements.annotatorContainer;
        this.annotatorStartButton = elements.annotatorStartButton;
        this.annotatorEndButton = elements.annotatorEndButton;
        this.annotatorActionType = elements.annotatorActionType;
        this.annotatorActionStateChangeSeverity = elements.annotatorActionStateChangeSeverity;
        this.annotatorExplanationField = elements.annotatorExplanationField;
        this.annotatorStatusDiv = elements.annotatorStatusDiv;
        this.startButton = elements.startButton;
        this.taskSpecField = elements.taskSpecField;
        this.agentStatusDiv = elements.agentStatusDiv;
        this.agentStatusPopup = elements.statusPopup;
        this.killButton = elements.killButton;
        this.historyList = elements.historyList;
        this.pendingActionDiv = elements.pendingActionDiv;
        this.monitorModeContainer = elements.monitorModeContainer;
        this.monitorFeedbackField = elements.monitorFeedbackField;
        this.monitorApproveButton = elements.monitorApproveButton;
        this.monitorRejectButton = elements.monitorRejectButton;
        this.unaffiliatedLogsExportButton = elements.unaffiliatedLogsExportButton;

        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = logger ?? createNamedLogger('side-panel-mgr', false);
        this.dom = overrideDoc ?? document;
        this.chunkedDownloadHandler = chunkedDownloadHandler ?? new ChunkedDownloadHandler();

        //have to initialize to default value this way to ensure that the monitor mode container is hidden if the default is false
        this.handleMonitorModeCacheUpdate(defaultIsMonitorMode);
        this.handleAnnotatorModeCacheUpdate(defaultIsAnnotatorMode);

        setupModeCache(this.handleMonitorModeCacheUpdate, "monitor mode", storageKeyForMonitorMode, this.logger);
        setupModeCache(this.handleAnnotatorModeCacheUpdate, "annotator mode", storageKeyForAnnotatorMode, this.logger);
        if (chrome?.storage?.local) {
            chrome.storage.local.get([storageKeyForShouldWipeHistoryOnTaskStart, storageKeyForEulaAcceptance], (items) => {
                this.validateAndApplySidePanelOptions(true, items[storageKeyForShouldWipeHistoryOnTaskStart], items[storageKeyForEulaAcceptance]);
            });
            chrome.storage.local.onChanged.addListener((changes: { [p: string]: chrome.storage.StorageChange }) => {
                this.validateAndApplySidePanelOptions(false, changes[storageKeyForShouldWipeHistoryOnTaskStart]?.newValue,
                    changes[storageKeyForEulaAcceptance]?.newValue);
            });
        }

        try {
            this.establishAgentControllerConnection();
        } catch (error: any) {
            this.logger.error('error while establishing service worker connection:', renderUnknownValue(error));
            try {
                this.establishAgentControllerConnection();
            } catch (error: any) {
                this.logger.error('error while retrying to establish service worker connection:', renderUnknownValue(error));
                this.setAgentStatusWithDelayedClear('Persistent errors while trying to establish connection to agent controller; Please close and reopen the side panel to try again');
            }
        }
    }

    /**
     * @description validates and applies the side panel options that are stored in local storage
     * @param initOrUpdate whether the context for the call is the initial loading of options from storage or a later update
     * @param newShouldWipeHistoryOnTaskStartVal the new value for shouldWipeHistoryOnTaskStart, if it is a valid boolean
     * @param isEulaAccepted whether the EULA has been accepted, if it is a valid boolean
     */
    validateAndApplySidePanelOptions = (initOrUpdate: boolean, newShouldWipeHistoryOnTaskStartVal: unknown,
                                        isEulaAccepted: unknown): void => {
        const contextStr = initOrUpdate ? "when loading options from storage" : "when processing an update from storage";
        if (typeof newShouldWipeHistoryOnTaskStartVal === "boolean") {
            this.shouldWipeActionHistoryOnTaskStart = newShouldWipeHistoryOnTaskStartVal;
        } else if (typeof newShouldWipeHistoryOnTaskStartVal !== "undefined") {this.logger.error(`invalid shouldWipeHistoryOnTaskStart value ${newShouldWipeHistoryOnTaskStartVal} detected in local storage ${contextStr}, ignoring it`)}

        if (typeof isEulaAccepted === "undefined") {
            this.logger.debug(`EULA acceptance value not found in local storage ${contextStr}, ignoring`);
        } else if (typeof isEulaAccepted !== "boolean") {
            this.logger.error(`invalid EULA acceptance value ${renderUnknownValue(isEulaAccepted)} detected in local storage ${contextStr}, ignoring`);
        } else if (isEulaAccepted) {
            this.logger.debug("EULA acceptance detected in local storage, hiding EULA complaint and re-enabling relevant interactive parts of UI");
            this.eulaComplaintContainer.hidden = true;
            this.startButton.disabled = false;
            this.taskSpecField.disabled = false;
            this.unaffiliatedLogsExportButton.disabled = false;
        } else {
            this.logger.debug("EULA acceptance not detected in local storage, showing EULA complaint and disabling relevant interactive parts of UI");
            this.eulaComplaintContainer.hidden = false;
            this.startButton.disabled = true;
            this.taskSpecField.disabled = true;
            this.unaffiliatedLogsExportButton.disabled = true;
        }
    }

    establishAgentControllerConnection = (): void => {
        this.agentControllerReady = false;

        this.state = SidePanelMgrState.WAIT_FOR_CONNECTION_INIT;
        this.agentControllerPort = chrome.runtime.connect({name: panelToControllerPort});
        this.agentControllerPort.onMessage.addListener(this.handleAgentControllerMsg);
        this.agentControllerPort.onDisconnect.addListener(this.handleAgentControllerDisconnect);
    }

    pingServiceWorkerForKeepAlive = async (swPort: chrome.runtime.Port): Promise<void> => {
        try {
            swPort.postMessage({type: Panel2AgentControllerPortMsgType.KEEP_ALIVE});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info('chain of keep-alive pings to service worker terminating because service worker disconnected');
            } else {
                this.logger.error('chain of keep-alive pings to service worker terminating because of unexpected error:', renderUnknownValue(error));
            }
            return;
        }
        const nearly_service_worker_timeout = 28000;
        setTimeout(() => this.pingServiceWorkerForKeepAlive(swPort), nearly_service_worker_timeout);
    }


    startTaskClickHandler = async (): Promise<void> => {
        this.logger.trace('startAgent button clicked');
        await this.mutex.runExclusive(async () => {
            this.logger.trace("start task button click being handled")
            if (this.taskSpecField.value.trim() === '') {
                const taskEmptyWhenStartMsg = "task specification field is empty (or all whitespace), can't start agent";
                this.logger.warn(taskEmptyWhenStartMsg);
                this.setAgentStatusWithDelayedClear(taskEmptyWhenStartMsg, 3);
            } else if (this.state !== SidePanelMgrState.IDLE) {
                const existingTaskMsg = 'another task is already running, cannot start task';
                this.logger.warn(existingTaskMsg);
                this.setAgentStatusWithDelayedClear(existingTaskMsg, 3);
            } else if (!this.agentControllerPort) {
                this.logger.error('service worker port is broken or missing, cannot start task');
                this.setAgentStatusWithDelayedClear('Connection to agent controller is missing, so cannot start task (starting it up again); please try again after status display shows that connection is working again', 3);

                try {
                    this.establishAgentControllerConnection();
                } catch (error: any) {
                    this.setAgentStatusWithDelayedClear('Error while trying to establish connection to agent controller; Please close and reopen the side panel to try again');
                    this.logger.error('error while establishing service worker connection after start task button clicked', renderUnknownValue(error));
                }
            } else if (!this.agentControllerReady) {
                this.logger.info("start task button clicked when port to service worker exists but service worker has not yet confirmed its readiness; ignoring");
                this.setAgentStatusWithDelayedClear("Agent controller not ready yet, please wait a moment and try again");
            } else {
                const taskSpec = this.taskSpecField.value;
                if (taskSpec.trim() === '') {
                    const cantStartErrMsg = 'task specification field became empty (or all whitespace) since Start Task button was clicked, cannot start task';
                    this.logger.error(cantStartErrMsg);
                    this.setAgentStatusWithDelayedClear(cantStartErrMsg);
                    this.state = SidePanelMgrState.IDLE;
                } else {
                    try {
                        this.agentControllerPort.postMessage(
                            {type: Panel2AgentControllerPortMsgType.START_TASK, taskSpecification: taskSpec});
                    } catch (error: any) {
                        this.logger.error(`error while sending task start command to service worker: ${error.message}`);
                        this.reset();
                        return;
                    }
                    this.state = SidePanelMgrState.WAIT_FOR_TASK_STARTED;
                    this.logger.trace("sent START_TASK message to service worker port");
                    if (this.shouldWipeActionHistoryOnTaskStart) {
                        while (this.historyList.firstChild) { this.historyList.removeChild(this.historyList.firstChild);}
                    }
                }
            }
        });
    }

    killTaskClickHandler = async (): Promise<void> => {
        this.logger.trace('endTask button clicked');
        await this.mutex.runExclusive(async () => {
            this.logger.trace("end task button click being handled")
            if (this.state === SidePanelMgrState.IDLE || this.state === SidePanelMgrState.WAIT_FOR_TASK_ENDED) {
                const noTaskToKillMsg = 'task is not in progress, cannot kill task';
                this.logger.warn(noTaskToKillMsg);
                this.setAgentStatusWithDelayedClear(noTaskToKillMsg, 3);
                return;
            } else if (!this.agentControllerPort) {
                const missingConnectionMsg = 'connection to agent controller does not exist, cannot kill task';
                this.logger.warn(missingConnectionMsg);
                this.setAgentStatusWithDelayedClear(missingConnectionMsg, 3);
                return;
            }
            try {
                this.agentControllerPort.postMessage({type: Panel2AgentControllerPortMsgType.KILL_TASK});
            } catch (error: any) {
                this.logger.error(`error while sending task termination command to service worker: ${error.message}`);
                this.reset();
                return;
            }
            this.state = SidePanelMgrState.WAIT_FOR_TASK_ENDED;
        });
    }

    optionsButtonClickHandler = (): void => {
        this.logger.trace('options button clicked');

        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage().then(() => {
                this.logger.trace('options page opened');
            }, (err) => {
                this.logger.error('error while opening options page:', err);
            });
        } else {
            this.logger.trace('chrome.runtime.openOptionsPage() not available, opening options.html directly');
            window.open(chrome.runtime.getURL('src/options.html'));
        }
    }

    unaffiliatedLogsExportButtonClickHandler = async (): Promise<void> => {
        this.logger.trace('export unaffiliated logs button clicked');
        await this.mutex.runExclusive(async () => {
            if (!this.agentControllerPort) {
                this.logger.error('service worker port is broken or missing, cannot export non-task-specific logs');
                this.setAgentStatusWithDelayedClear('Connection to agent controller is missing, so cannot export non-task-specific logs (reopening the connection in background); please try again after status display shows that connection is working again', 3);

                try {
                    this.establishAgentControllerConnection();
                } catch (error: any) {
                    this.setAgentStatusWithDelayedClear('Error while trying to establish connection to agent controller; Please close and reopen the side panel to try again');
                    this.logger.error('error while establishing service worker connection after unaffiliated logs export button clicked', renderUnknownValue(error));
                }
            } else if (!this.agentControllerReady) {
                this.logger.info("unaffiliated logs export button clicked when port to service worker exists but service worker has not yet confirmed its readiness; ignoring");
                this.setAgentStatusWithDelayedClear("Agent controller not ready yet, please wait a moment and try again");
            } else {
                this.logger.trace("sending message to service worker to export non-task-specific logs");
                try {
                    this.agentControllerPort.postMessage({type: Panel2AgentControllerPortMsgType.EXPORT_UNAFFILIATED_LOGS});
                } catch (error: any) {
                    this.logger.error(`error while sending "export non-task-specific logs" command to service worker: ${error.message}`);
                    this.reset();
                    return;
                }
            }
        });
    }

    monitorApproveButtonClickHandler = async (): Promise<void> => {
        if (!this.cachedMonitorMode) {
            this.logger.error("monitor mode not enabled, approve button shouldn't be clickable; ignoring");
            return;
        }
        await this.mutex.runExclusive(() => {
            if (this.state !== SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
                this.logger.error("approve button clicked but state is not WAIT_FOR_MONITOR_RESPONSE; ignoring");
                return;
            } else if (!this.agentControllerPort) {
                this.logger.error("service worker port doesn't exist, can't approve the pending action");
                return;
            }
            try {
                this.agentControllerPort.postMessage({type: Panel2AgentControllerPortMsgType.MONITOR_APPROVED});
            } catch (error: any) {
                this.logger.error(`error while sending monitor approval message to service worker: ${error.message}`);
                this.reset();
                return;
            }
            this.state = SidePanelMgrState.WAIT_FOR_ACTION_PERFORMED_RECORD;
            this.pendingActionDiv.textContent = '';
            this.pendingActionDiv.title = '';
            this.testAndCleanUpTempMonitorMode();
        });
    }

    private testAndCleanUpTempMonitorMode() {
        if (this.isMonitorModeTempEnabled) {
            this.isMonitorModeTempEnabled = false;
            this.monitorApproveButton.disabled = true;
            this.monitorRejectButton.disabled = true;
            this.monitorFeedbackField.disabled = true;
            this.handleMonitorModeCacheUpdate(false);
        }
    }

    monitorRejectButtonClickHandler = async (): Promise<void> => {
        if (!this.cachedMonitorMode) {
            this.logger.error("monitor mode not enabled, reject button shouldn't be clickable; ignoring");
            return;
        }
        await this.mutex.runExclusive(() => {
            if (this.state !== SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
                this.logger.error("reject button clicked but state is not WAIT_FOR_MONITOR_RESPONSE; ignoring");
                return;
            } else if (!this.agentControllerPort) {
                this.logger.error("service worker port doesn't exist, can't reject the pending action");
                return;
            }
            const feedbackText = this.monitorFeedbackField.value;
            try {
                this.agentControllerPort.postMessage(
                    {type: Panel2AgentControllerPortMsgType.MONITOR_REJECTED, feedback: feedbackText});
            } catch (error: any) {
                this.logger.error(`error while sending monitor rejection message to service worker: ${error.message}`);
                this.reset();
                return;
            }
            this.state = SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO;
            this.pendingActionDiv.textContent = '';
            this.pendingActionDiv.title = '';
            this.monitorFeedbackField.value = '';
            this.testAndCleanUpTempMonitorMode();
        });
    }

    handleAgentControllerMsg = async (message: any): Promise<void> => {
        this.logger.trace(`message received from agent controller by side panel: ${JSON.stringify(message)
            .slice(0, 100)}...`);
        if (message.type === AgentController2PanelPortMsgType.AGENT_CONTROLLER_READY) {
            await this.mutex.runExclusive(() => this.processConnectionReady());
        } else if (message.type === AgentController2PanelPortMsgType.TASK_STARTED) {
            await this.mutex.runExclusive(() => this.processTaskStartConfirmation(message));
        } else if (message.type === AgentController2PanelPortMsgType.ACTION_CANDIDATE) {
            await this.mutex.runExclusive(() => this.processActionCandidate(message));
        } else if (message.type === AgentController2PanelPortMsgType.AUTO_MONITOR_ESCALATION) {
            await this.mutex.runExclusive(() => this.processAutoMonitorEscalation(message));
        } else if (message.type === AgentController2PanelPortMsgType.TASK_HISTORY_ENTRY) {
            await this.mutex.runExclusive(() => this.processActionPerformedRecord(message));
        } else if (message.type === AgentController2PanelPortMsgType.TASK_ENDED) {
            await this.mutex.runExclusive(() => this.processTaskEndConfirmation(message));
        } else if (message.type === AgentController2PanelPortMsgType.ERROR) {
            await this.mutex.runExclusive(() => this.processErrorFromController(message));
        } else if (message.type === AgentController2PanelPortMsgType.HISTORY_EXPORT) {
            if ('numChunks' in message) {
                await this.mutex.runExclusive(() => this.processChunkedDownloadSegment(message, true));
            } else { this.processFileDownload(message, true); }
        } else if (message.type === AgentController2PanelPortMsgType.ABORT_CHUNKED_DOWNLOAD) {
            await this.mutex.runExclusive(() => {
                this.chunkedDownloadHandler.reset();
                this.setAgentStatusWithDelayedClear("Aborted download of logs zip file due to an error", undefined, message.error);
            });
        } else if (message.type === AgentController2PanelPortMsgType.NOTIFICATION) {
            this.setAgentStatusWithDelayedClear(message.msg, 30, message.details);//give user plenty of time to read details
        } else {
            this.logger.warn(`unknown type of message from agent controller: ${JSON.stringify(message)}`);
        }
    }

    /**
     * Validates the message from the service worker and saves its contents to the user's downloads folder as a file
     * @param message the message from the service worker with data to be downloaded to the user's computer as a file
     * @param isForAgentOrAnnotation true means this is a file download from AgentController and false means it's from ActionAnnotationCoordinator
     */
    private processFileDownload(message: any, isForAgentOrAnnotation: boolean) {
        const data = message.data;
        const fileNameForDownload = message.fileName;
        if (this.isNumArrOfUint8(data) && typeof fileNameForDownload === "string") {
            this.convertBytesNumberArrToFileDownload(data, fileNameForDownload, isForAgentOrAnnotation);
        } else {
            const errMsg = `received invalid data for a file download from background script:`;
            const errDtls = `data is ${renderUnknownValue(data)
                .slice(0, 200)}, fileName is ${renderUnknownValue(fileNameForDownload).slice(0, 200)}`;
            this.logger.error(`${errMsg} ${errDtls}`);
            (isForAgentOrAnnotation ? this.setAgentStatusWithDelayedClear.bind(this)
                : this.setAnnotatorStatusWithDelayedClear.bind(this))(errMsg, undefined, errDtls)
        }
    }

    private isNumArrOfUint8(data: any): data is number[] {
        return Array.isArray(data) && data.every((value) =>
            typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255);
    }

    /**
     * Converts the given array of numbers to the bytes of a file, then saves that to the user's computer
     * @param data array of numbers, each representing a byte of the file to be downloaded
     * @param fileNameForDownload the name of the file to be saved to the user's computer
     * @param isForAgentOrAnnotation true means this is a file download from AgentController and false means it's from ActionAnnotationCoordinator
     */
    private convertBytesNumberArrToFileDownload(data: number[], fileNameForDownload: string, isForAgentOrAnnotation: boolean) {
        const statusSetter = isForAgentOrAnnotation ? this.setAgentStatusWithDelayedClear.bind(this)
            : this.setAnnotatorStatusWithDelayedClear.bind(this);
        try {
            this.logger.debug(`received array of data from background script for a file, length: ${data.length}`);
            const arrBuff = new Uint8Array(data).buffer;
            this.logger.debug(`converted array of data to array buffer, length: ${arrBuff.byteLength}`);
            const blob = new Blob([arrBuff]);
            this.logger.debug(`after converting array buffer to blob, length is ${blob.size} bytes`);
            this.logger.debug(`about to save file ${fileNameForDownload} to user's computer`);
            saveAs(blob, fileNameForDownload);
            this.logger.info(`successfully saved file ${fileNameForDownload}`);
            statusSetter(`Downloaded file ${fileNameForDownload}`, 3);
        } catch (error: any) {
            const errMsg = `error while trying to save file to user's computer: ${error.message}`;
            this.logger.error(errMsg);
            statusSetter(errMsg);
        }
    }

    /**
     * Validates and processes a message from the service worker that contains a segment of a chunked download
     * @param message the message from the service worker with a segment of a chunked download
     * @param isForAgentOrAnnotation true means this is a file download from AgentController and false means it's from ActionAnnotationCoordinator
     */
    private processChunkedDownloadSegment(message: any, isForAgentOrAnnotation: boolean): boolean {
        const statusSetter = isForAgentOrAnnotation ? this.setAgentStatusWithDelayedClear.bind(this) : this.setAnnotatorStatusWithDelayedClear.bind(this);
        let errMsg: string | undefined;
        let fullArrOfNumbers: number[] | undefined;
        let errDtls: string | undefined;

        const dataChunk = message.data;
        const chunkIndex = message.chunkIndex;
        const totalNumChunks = message.numChunks;

        if (!this.isNumArrOfUint8(dataChunk) || !Number.isInteger(chunkIndex) || !Number.isInteger(totalNumChunks)) {
            errMsg = `received invalid data for a chunked download segment from background script:`;
            errDtls = `data is ${renderUnknownValue(dataChunk)
                .slice(0, 200)}, chunkIndex is ${renderUnknownValue(chunkIndex)}, totalNumChunks is ${renderUnknownValue(totalNumChunks)}`;
        } else {
            try {
                [errMsg, fullArrOfNumbers] = this.chunkedDownloadHandler.processDownloadChunk(dataChunk, chunkIndex, totalNumChunks);
            } catch (error: any) {
                errMsg = `error while processing chunked download segment: ${error.message}`;
                errDtls = renderUnknownValue(error);
                this.chunkedDownloadHandler.reset();
            }
        }
        if (errMsg) {
            this.logger.error(`${errMsg} ${errDtls}`);
            statusSetter(errMsg, undefined, errDtls);
        } else if (fullArrOfNumbers) {
            const fileNameForDownload = message.fileName;
            if (typeof fileNameForDownload === "string") {
                this.convertBytesNumberArrToFileDownload(fullArrOfNumbers, fileNameForDownload, isForAgentOrAnnotation);
            } else {
                const errMsg = `received last segment of chunked download data but missing or invalid file name for download`;
                this.logger.error(`${errMsg}: ${renderUnknownValue(fileNameForDownload)}`);
                statusSetter(errMsg, undefined, renderUnknownValue(fileNameForDownload));
            }
        }
        return this.chunkedDownloadHandler.isChunkedDownloadInProgress();
    }

    private processErrorFromController(message: any) {
        this.logger.error(`error message from background script: ${message.msg}`);
        this.setAgentStatusWithDelayedClear(`Error: ${message.msg}`, 5);
        this.reset();
    }

    private reset() {
        this.state = SidePanelMgrState.IDLE;
        this.taskSpecField.value = '';
        this.startButton.disabled = false;
        this.killButton.disabled = true;
        this.pendingActionDiv.textContent = '';
        this.pendingActionDiv.title = '';
        this.monitorFeedbackField.value = '';
        this.monitorFeedbackField.disabled = true;
        this.monitorApproveButton.disabled = true;
        this.monitorRejectButton.disabled = true;

        if (this.isMonitorModeTempEnabled) {
            this.handleMonitorModeCacheUpdate(false);
            this.isMonitorModeTempEnabled = false;
        }

        if (this.cachedIsAnnotatorMode) {this.resetAnnotationUi();}
        if (this.chunkedDownloadHandler.isChunkedDownloadInProgress()) { this.chunkedDownloadHandler.reset(); }
    }

    private resetAnnotationUi(isEndOfBatch: boolean = true) {
        this.annotatorActionType.value = Action.CLICK;
        this.annotatorActionStateChangeSeverity.value = ActionStateChangeSeverity.LOW;
        this.annotatorExplanationField.value = '';
        if (isEndOfBatch) {
            this.annotatorStartButton.disabled = false;
            this.annotatorEndButton.disabled = true;
        }
    }

    processConnectionReady = (): void => {
        if (this.state !== SidePanelMgrState.WAIT_FOR_CONNECTION_INIT) {
            this.logger.error('received READY message from service worker port but state is not WAIT_FOR_CONNECTION_INIT');
            return;
        } else if (!this.agentControllerPort) {
            this.logger.error('received READY message from service worker port but serviceWorkerPort is undefined');
            return;
        } else if (this.agentControllerReady) {
            this.logger.warn("received notification of readiness from agent controller when side panel already thought agent controller was active and ready")
        }
        this.logger.trace("agent controller notified side panel of its readiness");
        this.agentControllerReady = true;
        this.setAgentStatusWithDelayedClear('Agent controller connection ready; you can now start a task, export non-task-specific logs, etc.');

        this.pingServiceWorkerForKeepAlive(this.agentControllerPort).catch((error) => {
            this.logger.error('error while starting keepalive pings to service worker:', renderUnknownValue(error));
        });

        this.state = SidePanelMgrState.IDLE;
    }

    processTaskStartConfirmation = (message: any): void => {
        if (this.state !== SidePanelMgrState.WAIT_FOR_TASK_STARTED) {
            this.logger.error('received TASK_STARTED message from service worker port but state is not WAIT_FOR_TASK_STARTED');
            return;
        }
        let newStatus = '';
        if (message.success) {
            this.logger.trace("received notification of successful task start from agent controller");
            newStatus = `Task ${message.taskId} started successfully`;
            this.state = SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO;

            this.addHistoryEntry(`Task started: ${message.taskSpec}`, `Task ID: ${message.taskId}`, "task_start")
            this.startButton.disabled = true;
            this.killButton.disabled = false;
            //this.taskSpecField.value = ''; disabled at Boyuan's request
            if (this.cachedMonitorMode) {
                this.monitorFeedbackField.disabled = false;
            }
        } else {
            newStatus = 'Task start failed: ' + message.message;
            this.state = SidePanelMgrState.IDLE;
        }
        this.setAgentStatusWithDelayedClear(newStatus);
    }

    processActionCandidate = (message: any): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
            this.logger.trace("received ACTION_CANDIDATE message from service worker port while waiting for monitor response from user; implies that a keyboard shortcut for a monitor rejection was used instead of the side panel ui");
            this.testAndCleanUpTempMonitorMode();
        } else if (this.state != SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO) {
            this.logger.error('received ACTION_CANDIDATE message from service worker port but state is not WAIT_FOR_PENDING_ACTION_INFO');
            return;
        }

        if (this.cachedMonitorMode) {
            this.monitorApproveButton.disabled = false;
            this.monitorRejectButton.disabled = false;

            this.state = SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE;
        } else {
            this.state = SidePanelMgrState.WAIT_FOR_ACTION_PERFORMED_RECORD;
        }

        const pendingActionInfo = message.actionInfo as ActionInfo;
        this.pendingActionDiv.textContent = pendingActionInfo.explanation;
        this.pendingActionDiv.title = buildGenericActionDesc(pendingActionInfo.action, pendingActionInfo.elementData, pendingActionInfo.value)
    }

    processAutoMonitorEscalation = (message: any): void => {
        this.isMonitorModeTempEnabled = true;
        this.handleMonitorModeCacheUpdate(true);
        this.setAgentStatusWithDelayedClear(`Pending action judged to be dangerous at level ${message.severity} (hover for reason); please review then approve or reject`, 15, `Explanation of judgement: ${message.explanation}`);
        this.monitorApproveButton.disabled = false;
        this.monitorRejectButton.disabled = false;
        this.monitorFeedbackField.disabled = false;

        this.state = SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE;
    }

    processActionPerformedRecord = (message: any): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
            this.logger.debug("received TASK_HISTORY_ENTRY message from service worker port while waiting for monitor response from user; implies that a keyboard shortcut for a monitor judgement was used instead of the side panel ui");
            this.testAndCleanUpTempMonitorMode();
        } else if (this.state !== SidePanelMgrState.WAIT_FOR_ACTION_PERFORMED_RECORD) {
            this.logger.error('received TASK_HISTORY_ENTRY message from service worker port but state is not WAIT_FOR_ACTION_PERFORMED_RECORD');
            return;
        }

        const actionDesc = message.actionDesc as string;
        const successful = message.success as boolean;
        const explanation = message.explanation as string;
        const actionInfo = message.actionInfo as ActionInfo | undefined;

        let displayText = "";
        let hoverText = "";
        const successTxt = successful ? "SUCCEEDED" : "FAILED";
        if (actionInfo) {
            const elementData = actionInfo.elementData;
            if (elementData) {
                const optionalValueMsg = actionInfo.value ? ` with value: ${actionInfo.value}` : '';
                displayText = `${successTxt}: ${actionInfo.action}${optionalValueMsg} on a ${elementData.tagName} element; ${explanation}`;
                hoverText = `Element description: ${elementData.description}; Action full description: ${actionDesc}`;
            } else {
                displayText = `${successTxt}: ${actionDesc}; ${explanation}`;
                hoverText = `Action name ${actionInfo.action}; action value: ${actionInfo.value}`;
            }
        } else {
            displayText = `${successTxt}: ${explanation}`;
            hoverText = `Action: ${actionDesc}`;
        }

        this.addHistoryEntry(displayText, hoverText);
        if (this.cachedMonitorMode) {
            this.monitorFeedbackField.value = '';
            this.monitorApproveButton.disabled = true;
            this.monitorRejectButton.disabled = true;
        }
        this.state = SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO;
        this.pendingActionDiv.textContent = '';
        this.pendingActionDiv.title = '';
    }


    processTaskEndConfirmation = (message: any): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_TASK_STARTED) {
            this.logger.warn("task start failed");
            this.setAgentStatusWithDelayedClear(`Task start failed`, 10, message.details);
        } else {
            if (this.state !== SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO
                && this.state !== SidePanelMgrState.WAIT_FOR_TASK_ENDED) {
                this.logger.error(`received TASK_ENDED message from service worker port unexpectedly (while in state ${SidePanelMgrState[this.state]})`);
            }
            this.setAgentStatusWithDelayedClear(`Task ${message.taskId} ended`, 30, message.details);
            this.addHistoryEntry(`Task ended`, `Ended task id: ${message.taskId} for reason ${message.details}`, "task_end");
        }
        this.reset();
    }


    private setAgentStatusWithDelayedClear(status: string, delay: number = 10, hovertext?: string) {
        this.agentStatusDiv.textContent = status;
        if (hovertext) {
            this.agentStatusPopup.innerHTML = marked.setOptions({async: false}).parse(hovertext) as string;
        }
        setTimeout(() => {
            if (this.agentStatusDiv.textContent === status) {
                this.logger.trace(`after ${delay} seconds, clearing agent status ${status} with hovertext ${hovertext?.slice(0, 100)}...`);
                this.agentStatusDiv.textContent = 'No status update available at the moment.';
                this.agentStatusPopup.innerHTML = '';
                this.agentStatusPopup.style.display = "none";
            } else {this.logger.trace(`skipping delayed-clear for status ${status} with hovertext ${hovertext?.slice(0, 100)}... which was already replaced by another status`);}
        }, delay * 1000)
    }

    private setAnnotatorStatusWithDelayedClear(status: string, delay: number = 10, hovertext?: string) {
        this.annotatorStatusDiv.textContent = status;
        if (hovertext) {
            this.annotatorStatusDiv.title = hovertext;
        }
        setTimeout(() => {
            if (this.annotatorStatusDiv.textContent === status && this.annotatorStatusDiv.title === hovertext) {
                this.logger.trace(`after ${delay} seconds, clearing annotator status ${status} with hovertext ${hovertext?.slice(0, 100)}...`);
                this.annotatorStatusDiv.textContent = 'No status update available at the moment.';
                this.annotatorStatusDiv.title = '';
            } else {this.logger.trace(`skipping delayed-clear for status ${status} with hovertext ${hovertext?.slice(0, 100)}... which was already replaced by another status`);}
        }, delay * 1000)
    }

    handleAgentControllerDisconnect = async (): Promise<void> => {
        this.logger.info('service worker port to agent controller disconnected unexpectedly; attempting to reestablish connection');
        this.setAgentStatusWithDelayedClear("Agent controller connection lost. Please wait while it is started up again");
        await this.mutex.runExclusive(() => {
            this.reset();
            try {
                this.establishAgentControllerConnection();
            } catch (error: any) {this.logger.error('error while reestablishing service worker connection:', renderUnknownValue(error));}
        });
    }

    addHistoryEntry = (displayedText: string, hoverText: string, specialClass?: string): void => {
        const newEntry = this.dom.createElement('li');
        if (specialClass) {
            newEntry.classList.add(specialClass);
        }
        newEntry.textContent = displayedText;
        newEntry.title = hoverText;
        this.historyList.appendChild(newEntry);
        //todo if mouse is not inside history element (i.e. if user isn't looking at an existing history entry),
        // automatically scroll the history element's contents to bottom to show the latest history entry
    }

    displayStatusPopup = (): void => {
        if (this.agentStatusPopup.style.display !== "block" && this.agentStatusPopup.innerHTML.trim() !== "") {
            this.agentStatusPopup.style.display = "block";
            const statusRect = this.agentStatusDiv.getBoundingClientRect();
            this.agentStatusPopup.style.maxHeight = `${statusRect.top}px`;
            this.agentStatusPopup.style.left = `0px`;
            //the addition of 7 is so the details popup overlaps a little with the status div and so you can move
            // the mouse from the div to the popup without the popup sometimes disappearing
            this.agentStatusPopup.style.top = `${statusRect.y + 7 - this.agentStatusPopup.offsetHeight + window.scrollY}px`;
        }
    }

    handleMouseLeaveStatus = (elementThatWasLeft: HTMLElement): void => {
        //using referential equality intentionally here
        const otherStatusElemRect = (elementThatWasLeft == this.agentStatusDiv ? this.agentStatusPopup : this.agentStatusDiv).getBoundingClientRect();
        const mX = this.mouseClientX;
        const mY = this.mouseClientY;
        const isMouseOutsideOtherElem = mX < otherStatusElemRect.left || mX > otherStatusElemRect.right
            || mY < otherStatusElemRect.top || mY > otherStatusElemRect.bottom;
        const divRect = this.agentStatusDiv.getBoundingClientRect();
        const popupRect = this.agentStatusPopup.getBoundingClientRect();
        //don't hide the popup if the mouse coords are in between the status div and the popup
        const isMouseBetweenElems = mX > divRect.left && mX > popupRect.left && mX < divRect.right
            && mX < popupRect.right && ((mY > divRect.bottom && mY < popupRect.top)
                || (mY > popupRect.bottom && mY < divRect.top));
        if (isMouseOutsideOtherElem && !isMouseBetweenElems) {this.agentStatusPopup.style.display = 'none';}
    }

    handleMonitorModeCacheUpdate = (newMonitorModeVal: boolean) => {
        this.mutex.runExclusive(() => {
            const priorCachedMonitorModeVal = this.cachedMonitorMode;
            this.cachedMonitorMode = newMonitorModeVal;
            if (priorCachedMonitorModeVal === newMonitorModeVal) {
                this.logger.trace(`side panel cache of monitor mode received an update which agreed with the existing cached value ${this.cachedMonitorMode}`)
                return;
            }
            const priorHistoryHeight = this.historyList.getBoundingClientRect().height;//px

            if (newMonitorModeVal) {//re-displaying monitor mode UI
                const newHistoryHeight = priorHistoryHeight - this.lastHeightOfMonitorModeContainer;//px
                this.historyList.style.height = `${(newHistoryHeight)}px`;
                this.monitorModeContainer.style.display = "block";
            } else {//collapsing monitor mode UI
                this.lastHeightOfMonitorModeContainer = this.monitorModeContainer.getBoundingClientRect().height;
                const newHistoryHeight = priorHistoryHeight + this.lastHeightOfMonitorModeContainer;//px
                this.historyList.style.height = `${(newHistoryHeight)}px`;
                this.monitorModeContainer.style.display = "none";
            }
        }).catch((error) => this.logger.error(`error while updating monitor mode cache: ${renderUnknownValue(error)}`));
    }

    handleAnnotatorModeCacheUpdate = (newAnnotatorModeVal: boolean) => {
        this.cachedIsAnnotatorMode = newAnnotatorModeVal;
        if (newAnnotatorModeVal) {
            this.annotatorContainer.style.display = "block";
            if (!this.annotationCoordinatorPort) {
                this.annotationCoordinatorPort = chrome.runtime.connect({name: panelToAnnotationCoordinatorPort});
                this.annotationCoordinatorPort.onMessage.addListener(this.handleAnnotationCoordinatorMsg);
                this.annotationCoordinatorPort.onDisconnect.addListener(this.handleAnnotationCoordinatorDisconnect);
            }
        } else {
            this.annotatorContainer.style.display = "none";
            this.resetAnnotationUi();
        }
    }

    handleAnnotationCoordinatorMsg = async (message: any, port: chrome.runtime.Port): Promise<void> => {
        this.logger.trace(`message received from annotation coordinator by side panel: ${JSON.stringify(message)
            .slice(0, 100)}...`);
        if (message.type === AnnotationCoordinator2PanelPortMsgType.REQ_ANNOTATION_DETAILS) {
            //just reads data from ui and doesn't modify state, no need for mutex
            port.postMessage({
                type: PanelToAnnotationCoordinatorPortMsgType.ANNOTATION_DETAILS,
                actionType: this.annotatorActionType.value, explanation: this.annotatorExplanationField.value,
                actionStateChangeSeverity: this.annotatorActionStateChangeSeverity.value
            });
        } else if (message.type === AnnotationCoordinator2PanelPortMsgType.ANNOTATED_ACTIONS_EXPORT) {
            await this.mutex.runExclusive(() => {
                if ('numChunks' in message) {
                    const isChunkedDownloadStillInProgress = this.processChunkedDownloadSegment(message, false);
                    if (!isChunkedDownloadStillInProgress) {this.reset();}
                } else {
                    this.processFileDownload(message, false);
                    this.reset();
                }
            });
        } else if (message.type === AnnotationCoordinator2PanelPortMsgType.ABORT_CHUNKED_DOWNLOAD) {
            await this.mutex.runExclusive(() => {
                this.chunkedDownloadHandler.reset();
                this.setAnnotatorStatusWithDelayedClear("Chunked download of annotations-batch aborted", undefined, message.error);
            });
        } else if (message.type === AnnotationCoordinator2PanelPortMsgType.NOTIFICATION) {
            this.setAnnotatorStatusWithDelayedClear(message.msg, 10, message.details);
        } else if (message.type === AnnotationCoordinator2PanelPortMsgType.ANNOTATION_CAPTURED_CONFIRMATION) {
            this.setAnnotatorStatusWithDelayedClear(`Annotation ${message.annotId.slice(0, 4)}... captured ${message.wasTargetIdentified ? `successfully${message.wasTargetNotRecognizedAsInteractive ? " but target element was not recognized as interactive (needs review by extension developer)" : ""}` : ", but target element couldn't be identified"}`, undefined, message.summary);
            await this.mutex.runExclusive(() => this.resetAnnotationUi(false));
        } else {
            this.logger.warn(`unknown type of message from annotation coordinator: ${JSON.stringify(message)}`);
        }
    }

    handleAnnotationCoordinatorDisconnect = async (): Promise<void> => {
        this.logger.info("annotation coordinator port disconnected unexpectedly; attempting to reopen");
        await this.mutex.runExclusive(() => {
            let annotationStatusText = "Annotation coordinator connection lost";
            let annotationHovertext = "Please wait while it is started up again";
            if (this.annotatorStartButton.disabled) {
                annotationStatusText += " (current batch aborted)";
                annotationHovertext += " and then try to begin a batch once more";
            }
            this.setAnnotatorStatusWithDelayedClear(annotationStatusText, undefined, annotationHovertext);
            this.resetAnnotationUi();
            this.annotationCoordinatorPort = chrome.runtime.connect({name: panelToAnnotationCoordinatorPort});
            this.annotationCoordinatorPort.onMessage.addListener(this.handleAnnotationCoordinatorMsg);
            this.annotationCoordinatorPort.onDisconnect.addListener(this.handleAnnotationCoordinatorDisconnect);
        });
    }

    startActionAnnotationBatch = (): void => {
        if (this.annotationCoordinatorPort) {
            this.annotationCoordinatorPort.postMessage({type: PanelToAnnotationCoordinatorPortMsgType.START_ANNOTATION_BATCH});
            this.annotatorEndButton.disabled = false;
            this.annotatorStartButton.disabled = true;
        } else {
            this.logger.error("annotation coordinator port doesn't exist, can't start action annotation capture");
            this.setAnnotatorStatusWithDelayedClear("Connection to annotation coordinator is missing, so cannot start action annotation capture (reopening the connection in background); please try again after this message disappears", 3);
        }
    }

    endActionAnnotationBatch = (): void => {
        if (this.annotationCoordinatorPort) {
            this.annotationCoordinatorPort.postMessage(
                {type: PanelToAnnotationCoordinatorPortMsgType.END_ANNOTATION_BATCH});
            this.resetAnnotationUi();
        } else {
            this.logger.error("annotation coordinator port doesn't exist, can't finish action annotations batch");
            this.setAnnotatorStatusWithDelayedClear("Connection to annotation coordinator is missing, so cannot finish action annotations batch (reopening the connection in background); please try again after this message disappears", 3);
        }
    }

}