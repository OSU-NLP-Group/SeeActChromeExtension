// import {createNamedLogger} from "./utils/shared_logging_setup";
import {SidePanelManager} from "./utils/SidePanelManager";

//const logger = createNamedLogger('side-panel', false);

const startButton = document.getElementById('start-agent');
if (!startButton) throw new Error('startAgent button not found');

const taskSpecField = document.getElementById('task-spec');
if (!taskSpecField) throw new Error('task-spec field not found');

const statusDiv = document.getElementById('status');
if (!statusDiv) throw new Error('status div not found');

const killButton = document.getElementById('end-task');
if (!killButton) throw new Error('endTask button not found');

const optionsButton = document.getElementById('options');
if (!optionsButton) throw new Error('options button not found');

const unaffiliatedLogsExportButton = document.getElementById('export-unaffiliated-logs');
if (!unaffiliatedLogsExportButton) throw new Error('export-unaffiliated-logs button not found');

const historyList = document.getElementById('history');
if (!historyList) throw new Error('history list not found');

const pendingActionDiv = document.getElementById('pending-action');
if (!pendingActionDiv) throw new Error('pending-action div not found');

const monitorFeedbackField = document.getElementById('monitor-feedback');
if (!monitorFeedbackField) throw new Error('monitor-feedback field not found');

const monitorApproveButton = document.getElementById('approve');
if (!monitorApproveButton) throw new Error('approve button not found');

const monitorRejectButton = document.getElementById('reject');
if (!monitorRejectButton) throw new Error('reject button not found');

const manager = new SidePanelManager({
    startButton: startButton as HTMLButtonElement,
    taskSpecField: taskSpecField as HTMLTextAreaElement,
    statusDiv: statusDiv as HTMLDivElement,
    killButton: killButton as HTMLButtonElement,
    historyList: historyList as HTMLOListElement,
    pendingActionDiv: pendingActionDiv as HTMLDivElement,
    monitorFeedbackField: monitorFeedbackField as HTMLTextAreaElement,
    monitorApproveButton: monitorApproveButton as HTMLButtonElement,
    monitorRejectButton: monitorRejectButton as HTMLButtonElement
});

startButton.addEventListener('click', manager.startTaskClickHandler);

killButton.addEventListener('click', manager.killTaskClickHandler);

optionsButton.addEventListener('click', manager.optionsButtonClickHandler);
unaffiliatedLogsExportButton.addEventListener('click', manager.unaffiliatedLogsExportButtonClickHandler);

monitorApproveButton.addEventListener('click', manager.monitorApproveButtonClickHandler);
monitorRejectButton.addEventListener('click', manager.monitorRejectButtonClickHandler);
