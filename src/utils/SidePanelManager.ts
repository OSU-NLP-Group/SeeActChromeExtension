import {ChromeWrapper} from "./ChromeWrapper";
import {createNamedLogger} from "./shared_logging_setup";
import {Logger} from "loglevel";
import {
    Background2PanelPortMsgType, buildGenericActionDesc,
    Panel2BackgroundPortMsgType,
    panelToControllerPort, setupMonitorModeCache
} from "./misc";
import {Mutex} from "async-mutex";
import {ActionInfo} from "./AgentController";
import saveAs from "file-saver";


export interface SidePanelElements {
    startButton: HTMLButtonElement;
    taskSpecField: HTMLTextAreaElement;
    statusDiv: HTMLDivElement;
    killButton: HTMLButtonElement;
    historyList: HTMLOListElement;
    pendingActionDiv: HTMLDivElement;
    monitorFeedbackField: HTMLTextAreaElement;
    monitorApproveButton: HTMLButtonElement;
    monitorRejectButton: HTMLButtonElement;
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
    private readonly startButton: HTMLButtonElement;
    private readonly taskSpecField: HTMLTextAreaElement;
    private readonly statusDiv: HTMLDivElement;
    private readonly killButton: HTMLButtonElement;
    private readonly historyList: HTMLOListElement;
    private readonly pendingActionDiv: HTMLDivElement;
    private readonly monitorFeedbackField: HTMLTextAreaElement;
    private readonly monitorApproveButton: HTMLButtonElement;
    private readonly monitorRejectButton: HTMLButtonElement;

    private readonly chromeWrapper: ChromeWrapper;
    readonly logger: Logger;
    private readonly dom: Document;

    readonly mutex = new Mutex();

    //allow read access to this without mutex because none of this class's code should _ever_ mutate it (only updated by storage change listener that was set up in constructor)
    cachedMonitorMode = false;


    private state: SidePanelMgrState = SidePanelMgrState.IDLE;
    public serviceWorkerPort?: chrome.runtime.Port;


    constructor(elements: SidePanelElements, chromeWrapper?: ChromeWrapper, logger?: Logger, overrideDoc?: Document) {
        this.startButton = elements.startButton;
        this.taskSpecField = elements.taskSpecField;
        this.statusDiv = elements.statusDiv;
        this.killButton = elements.killButton;
        this.historyList = elements.historyList;
        this.pendingActionDiv = elements.pendingActionDiv;
        this.monitorFeedbackField = elements.monitorFeedbackField;
        this.monitorApproveButton = elements.monitorApproveButton;
        this.monitorRejectButton = elements.monitorRejectButton;

        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = logger ?? createNamedLogger('side-panel-mgr', false);
        this.dom = overrideDoc ?? document;

        setupMonitorModeCache(this);
    }

    startTaskClickHandler = async (): Promise<void> => {
        this.logger.trace('startAgent button clicked');
        await this.mutex.runExclusive(async () => {
            this.logger.trace("start task button click being handled")
            if (this.taskSpecField.value.trim() === '') {
                const taskEmptyWhenStartMsg = "task specification field is empty (or all whitespace), can't start agent";
                this.logger.warn(taskEmptyWhenStartMsg);
                this.setStatusWithDelayedClear(taskEmptyWhenStartMsg, 3);
                return;
            } else if (this.state !== SidePanelMgrState.IDLE) {
                const existingTaskMsg = 'another task is already running, cannot start task';
                this.logger.warn(existingTaskMsg);
                this.setStatusWithDelayedClear(existingTaskMsg, 3);
                return;
            } else if (this.serviceWorkerPort) {
                this.logger.error('service worker port still exists despite state being IDLE, something probably went wrong; restarting service worker port');
                this.serviceWorkerPort.disconnect();
            }

            this.state = SidePanelMgrState.WAIT_FOR_CONNECTION_INIT;
            this.serviceWorkerPort = chrome.runtime.connect({name: panelToControllerPort});
            this.serviceWorkerPort.onMessage.addListener(this.handleAgentControllerMsg);
            this.serviceWorkerPort.onDisconnect.addListener(this.handleAgentControllerDisconnect);
        });
    }

    killTaskClickHandler = async (): Promise<void> => {
        this.logger.trace('endTask button clicked');
        await this.mutex.runExclusive(async () => {
            this.logger.trace("end task button click being handled")
            if (this.state === SidePanelMgrState.IDLE || this.state === SidePanelMgrState.WAIT_FOR_TASK_ENDED) {
                const noTaskToKillMsg = 'task is not in progress, cannot kill task';
                this.logger.warn(noTaskToKillMsg);
                this.setStatusWithDelayedClear(noTaskToKillMsg, 3);
                return;
            } else if (!this.serviceWorkerPort) {
                const missingConnectionMsg = 'connection to agent controller does not exist, cannot kill task';
                this.logger.warn(missingConnectionMsg);
                this.setStatusWithDelayedClear(missingConnectionMsg, 3);
                return;
            }
            this.serviceWorkerPort.postMessage({type: Panel2BackgroundPortMsgType.KILL_TASK});
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

    monitorApproveButtonClickHandler = async (): Promise<void> => {
        if (!this.cachedMonitorMode) {
            this.logger.error("monitor mode not enabled, approve button shouldn't be clickable; ignoring");
            return;
        }
        await this.mutex.runExclusive(() => {
            if (this.state !== SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
                this.logger.error("approve button clicked but state is not WAIT_FOR_MONITOR_RESPONSE; ignoring");
                return;
            } else if (!this.serviceWorkerPort) {
                this.logger.error("service worker port doesn't exist, can't approve the pending action");
                return;
            }
            this.serviceWorkerPort.postMessage({type: Panel2BackgroundPortMsgType.MONITOR_APPROVED});
            this.state = SidePanelMgrState.WAIT_FOR_ACTION_PERFORMED_RECORD;
            this.pendingActionDiv.textContent = '';
            this.pendingActionDiv.title = '';
        });
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
            } else if (!this.serviceWorkerPort) {
                this.logger.error("service worker port doesn't exist, can't reject the pending action");
                return;
            }
            const feedbackText = this.monitorFeedbackField.value;
            this.serviceWorkerPort.postMessage(
                {type: Panel2BackgroundPortMsgType.MONITOR_REJECTED, feedback: feedbackText});
            this.state = SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO;
            this.pendingActionDiv.textContent = '';
            this.pendingActionDiv.title = '';
        });
    }

    handleAgentControllerMsg = async (message: any): Promise<void> => {
        this.logger.trace(`message received from background script: ${JSON.stringify(message).slice(0,100)} by side panel`);
        if (message.type === Background2PanelPortMsgType.AGENT_CONTROLLER_READY) {
            await this.mutex.runExclusive(() => this.processConnectionReady());
        } else if (message.type === Background2PanelPortMsgType.TASK_STARTED) {
            await this.mutex.runExclusive(() => this.processTaskStartConfirmation(message));
        } else if (message.type === Background2PanelPortMsgType.ACTION_CANDIDATE) {
            await this.mutex.runExclusive(() => this.processActionCandidate(message));
        } else if (message.type === Background2PanelPortMsgType.TASK_HISTORY_ENTRY) {
            await this.mutex.runExclusive(() => this.processActionPerformedRecord(message));
        } else if (message.type === Background2PanelPortMsgType.TASK_ENDED) {
            await this.mutex.runExclusive(() => this.processTaskEndConfirmation(message));
        } else if (message.type === Background2PanelPortMsgType.ERROR) {
            await this.mutex.runExclusive(() => this.processErrorFromController(message));
        } else if (message.type === Background2PanelPortMsgType.TASK_HISTORY_EXPORT) {
            this.exportTaskHistoryToFileDownload(message);
        } else {
            this.logger.warn("unknown type of message from background script: " + JSON.stringify(message));
        }
    }

    private exportTaskHistoryToFileDownload(message: any) {
        try {
            this.logger.debug(`received array of data from background script for a zip file, length: ${message.data.length}`);
            const arrBuff = new Uint8Array(message.data).buffer;
            this.logger.debug(`converted array of data to array buffer, length: ${arrBuff.byteLength}`);
            const blob = new Blob([arrBuff]);
            this.logger.debug(`after converting array buffer to blob, length is ${blob.size} bytes`);
            this.logger.debug(`about to save zip file ${message.fileName} to user's computer`);
            saveAs(blob, message.fileName);
            this.logger.info(`successfully saved zip file ${message.fileName}`);
        } catch (error: any) {
            const errMsg = `error while trying to save zip file to user's computer: ${error.message}`;
            this.logger.error(errMsg);
            this.setStatusWithDelayedClear(errMsg);
        }
    }

    private processErrorFromController(message: any) {
        this.logger.error(`error message from background script: ${message.msg}`);
        this.setStatusWithDelayedClear(`Error: ${message.msg}`, 5);
        this.serviceWorkerPort?.disconnect();
        this.reset();
    }

    private reset() {
        this.state = SidePanelMgrState.IDLE;
        this.serviceWorkerPort = undefined;
        this.taskSpecField.value = '';
        this.startButton.disabled = false;
        this.killButton.disabled = true;
        this.pendingActionDiv.textContent = '';
        this.pendingActionDiv.title = '';
        this.monitorFeedbackField.value = '';
        this.monitorFeedbackField.disabled = true;
        this.monitorApproveButton.disabled = true;
        this.monitorRejectButton.disabled = true;
    }

    processConnectionReady = (): void => {
        if (this.state !== SidePanelMgrState.WAIT_FOR_CONNECTION_INIT) {
            this.logger.error('received READY message from service worker port but state is not WAIT_FOR_CONNECTION_INIT');
            return;
        } else if (!this.serviceWorkerPort) {
            this.logger.error('received READY message from service worker port but serviceWorkerPort is undefined');
            return;
        }
        const taskSpec = this.taskSpecField.value;
        if (taskSpec.trim() === '') {
            const cantStartErrMsg = 'task specification field became empty (or all whitespace) since Start Task button was clicked, cannot start task';
            this.logger.error(cantStartErrMsg);
            this.setStatusWithDelayedClear(cantStartErrMsg);
            this.serviceWorkerPort.disconnect();
            this.state = SidePanelMgrState.IDLE;
        } else {
            this.serviceWorkerPort.postMessage(
                {type: Panel2BackgroundPortMsgType.START_TASK, taskSpecification: taskSpec});
            this.state = SidePanelMgrState.WAIT_FOR_TASK_STARTED;
        }
    }

    processTaskStartConfirmation = (message: any): void => {
        if (this.state !== SidePanelMgrState.WAIT_FOR_TASK_STARTED) {
            this.logger.error('received TASK_STARTED message from service worker port but state is not WAIT_FOR_TASK_STARTED');
            return;
        }
        let newStatus = '';
        if (message.success) {
            newStatus = `Task ${message.taskId} started successfully`;
            this.state = SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO;
            //wipe history from previous task
            while (this.historyList.firstChild) { this.historyList.removeChild(this.historyList.firstChild);}

            this.addHistoryEntry(`Task started: ${message.taskSpec}`, `Task ID: ${message.taskId}`, "task_start")
            this.startButton.disabled = true;
            this.killButton.disabled = false;
            this.taskSpecField.value = '';
            if (this.cachedMonitorMode) {
                this.monitorFeedbackField.disabled = false;
            }
        } else {
            newStatus = 'Task start failed: ' + message.message;
            this.state = SidePanelMgrState.IDLE;
        }
        this.setStatusWithDelayedClear(newStatus);
    }

    processActionCandidate = (message: any): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
            this.logger.trace("received ACTION_CANDIDATE message from service worker port while waiting for monitor response from user; implies that a keyboard shortcut for a monitor rejection was used instead of the side panel ui")
        } else if (this.state != SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO) {
            this.logger.error('received ACTION_CANDIDATE message from service worker port but state is not WAIT_FOR_PENDING_ACTION_INFO');
            return;
        }

        if (this.cachedMonitorMode) {
            this.monitorApproveButton.disabled= false;
            this.monitorRejectButton.disabled = false;

            this.state = SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE;
        } else {
            this.state = SidePanelMgrState.WAIT_FOR_ACTION_PERFORMED_RECORD;
        }

        const pendingActionInfo = message.actionInfo as ActionInfo;
        this.pendingActionDiv.textContent = pendingActionInfo.explanation;
        this.pendingActionDiv.title = buildGenericActionDesc(pendingActionInfo.action, pendingActionInfo.elementData, pendingActionInfo.value)
    }

    processActionPerformedRecord = (message: any): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_MONITOR_RESPONSE) {
            this.logger.debug("received TASK_HISTORY_ENTRY message from service worker port while waiting for monitor response from user; implies that a keyboard shortcut for a monitor judgement was used instead of the side panel ui");
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
            this.setStatusWithDelayedClear(`Task start failed`);
        } else {
            if (this.state !== SidePanelMgrState.WAIT_FOR_PENDING_ACTION_INFO
                && this.state !== SidePanelMgrState.WAIT_FOR_TASK_ENDED) {
                this.logger.error(`received TASK_ENDED message from service worker port unexpectedly (while in state ${SidePanelMgrState[this.state]})`);
            }
            this.setStatusWithDelayedClear(`Task ${message.taskId} ended`);
            this.addHistoryEntry(`Task ended`, `Ended task id: ${message.taskId}`, "task_end");
        }
        this.reset();
    }


    private setStatusWithDelayedClear(status: string, delay: number = 10) {
        this.statusDiv.style.display = 'block';
        this.statusDiv.textContent = status;
        setTimeout(() => {
            this.statusDiv.style.display = 'none';
            this.statusDiv.textContent = '';
        }, delay * 1000)
    }

    handleAgentControllerDisconnect = (): void => {
        if (this.state === SidePanelMgrState.WAIT_FOR_TASK_ENDED || this.state === SidePanelMgrState.IDLE) {
            //including IDLE in addition to WAIT_FOR_TASK_ENDED because the service worker would usually disconnect the
            // port right after sending the "task ended" message to us, so most of the time this will've received that
            // message and gone to IDLE state before the port disconnects
            this.logger.trace('service worker port disconnected as expected at end of task');
        } else {
            this.logger.error('service worker port disconnected unexpectedly');
        }
        this.serviceWorkerPort = undefined;
    }

    addHistoryEntry = (displayedText: string, hoverText: string, specialClass?: string): void => {
        const newEntry = this.dom.createElement('li');
        if (specialClass) {
            newEntry.classList.add(specialClass);
        }
        newEntry.textContent = displayedText;
        newEntry.title = hoverText;
        this.historyList.appendChild(newEntry);
    }

}