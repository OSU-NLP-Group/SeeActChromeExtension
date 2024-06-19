// import {createNamedLogger} from "./utils/shared_logging_setup";
import {SidePanelManager} from "./utils/SidePanelManager";

// const logger = createNamedLogger('side-panel', false);

const startButton = document.getElementById('start-agent');
if (!startButton) throw new Error('startAgent button not found');

const startIcon = document.getElementById('start-task-icon');
if (!startIcon) throw new Error('start-task-icon not found');

const taskSpecField = document.getElementById('task-spec');
if (!taskSpecField) throw new Error('task-spec field not found');

const statusDiv = document.getElementById('status');
if (!statusDiv) throw new Error('status div not found');

const statusPopup = document.getElementById('status-details-tooltip');
if (!statusPopup) throw new Error('status-details-tooltip not found');

const killButton = document.getElementById('end-task');
if (!killButton) throw new Error('endTask button not found');

const killIcon = document.getElementById('terminate-task-icon');
if (!killIcon) throw new Error('terminate-task-icon not found');

const optionsButton = document.getElementById('options');
if (!optionsButton) throw new Error('options button not found');

const optionsIcon = document.getElementById('open-options-icon');
if (!optionsIcon) throw new Error('open-options-icon not found');

const unaffiliatedLogsExportButton = document.getElementById('export-unaffiliated-logs');
if (!unaffiliatedLogsExportButton) throw new Error('export-unaffiliated-logs button not found');

const unaffiliatedLogsExportIcon = document.getElementById('export-unaffiliated-logs-icon');
if (!unaffiliatedLogsExportIcon) throw new Error('export-unaffiliated-logs icon not found');

const historyList = document.getElementById('history');
if (!historyList) throw new Error('history list not found');

const pendingActionDiv = document.getElementById('pending-action');
if (!pendingActionDiv) throw new Error('pending-action div not found');

const monitorFeedbackField = document.getElementById('monitor-feedback');
if (!monitorFeedbackField) throw new Error('monitor-feedback field not found');

const monitorApproveButton = document.getElementById('approve');
if (!monitorApproveButton) throw new Error('approve button not found');

const monitorApproveIcon = document.getElementById('monitor-approve-icon');
if (!monitorApproveIcon) throw new Error('monitor-approve-icon not found');

const monitorRejectButton = document.getElementById('reject');
if (!monitorRejectButton) throw new Error('reject button not found');

const monitorRejectIcon = document.getElementById('monitor-reject-icon');
if (!monitorRejectIcon) throw new Error('monitor-reject-icon not found');

const manager = new SidePanelManager({
    startButton: startButton as HTMLButtonElement,
    taskSpecField: taskSpecField as HTMLTextAreaElement,
    statusDiv: statusDiv as HTMLDivElement,
    statusPopup: statusPopup as HTMLDivElement,
    killButton: killButton as HTMLButtonElement,
    historyList: historyList as HTMLOListElement,
    pendingActionDiv: pendingActionDiv as HTMLDivElement,
    monitorFeedbackField: monitorFeedbackField as HTMLTextAreaElement,
    monitorApproveButton: monitorApproveButton as HTMLButtonElement,
    monitorRejectButton: monitorRejectButton as HTMLButtonElement
});

document.addEventListener('mousemove', (e) => {
    manager.mouseClientX = e.clientX;
    manager.mouseClientY = e.clientY;
});

//redirecting click on icon to click on button so that disabling the button effectively disables its icon as well
startButton.addEventListener('click', manager.startTaskClickHandler);
startIcon.addEventListener('click', () => startButton.click());

killButton.addEventListener('click', manager.killTaskClickHandler);
killIcon.addEventListener('click', () => killButton.click());

optionsButton.addEventListener('click', manager.optionsButtonClickHandler);
optionsIcon.addEventListener('click', () => optionsButton.click());

unaffiliatedLogsExportButton.addEventListener('click', manager.unaffiliatedLogsExportButtonClickHandler);
unaffiliatedLogsExportIcon.addEventListener('click', () => unaffiliatedLogsExportButton.click());

monitorApproveButton.addEventListener('click', manager.monitorApproveButtonClickHandler);
monitorApproveIcon.addEventListener('click', () => monitorApproveButton.click());

monitorRejectButton.addEventListener('click', manager.monitorRejectButtonClickHandler);
monitorRejectIcon.addEventListener('click', () => monitorRejectButton.click());


statusDiv.addEventListener('mouseenter', manager.displayStatusPopup);
statusDiv.addEventListener('mouseleave', () => manager.handleMouseLeaveStatus(statusDiv));
statusPopup.addEventListener('mouseleave', () => manager.handleMouseLeaveStatus(statusPopup));
