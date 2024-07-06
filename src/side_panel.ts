// import {createNamedLogger} from "./utils/shared_logging_setup";
import {SidePanelManager} from "./utils/SidePanelManager";

import "./global_styles.css";
import "./side_panel.css";

// const logger = createNamedLogger('side-panel', false);

const eulaComplaintElem = document.getElementById('eula-complaint');
if (!(eulaComplaintElem && eulaComplaintElem instanceof HTMLDivElement)) throw new Error('valid eula-complaint div not found');

const eulaReviewButton = document.getElementById('eula-review');
if (!(eulaReviewButton && eulaReviewButton instanceof HTMLButtonElement)) throw new Error('valid eula-review button not found');

//button rather than link b/c we want to open in new tab and <a> behaves unintuitively in side panel
const userGuideButton = document.getElementById('user-guide');
if (!(userGuideButton && userGuideButton instanceof HTMLButtonElement)) throw new Error('valid user-guide button not found');

const startButton = document.getElementById('start-agent');
if (!(startButton && startButton instanceof HTMLButtonElement)) throw new Error('valid startAgent button not found');

const taskSpecField = document.getElementById('task-spec');
if (!(taskSpecField && taskSpecField instanceof HTMLTextAreaElement)) throw new Error('valid task-spec field not found');

const statusDiv = document.getElementById('status');
if (!(statusDiv && statusDiv instanceof HTMLDivElement)) throw new Error('valid status div not found');

const statusPopup = document.getElementById('status-details-tooltip');
if (!(statusPopup && statusPopup instanceof HTMLSpanElement)) throw new Error('valid status-details-tooltip not found');

const killButton = document.getElementById('end-task');
if (!(killButton && killButton instanceof HTMLButtonElement)) throw new Error('valid endTask button not found');

const optionsButton = document.getElementById('options');
if (!(optionsButton && optionsButton instanceof HTMLButtonElement)) throw new Error('valid options button not found');

const unaffiliatedLogsExportButton = document.getElementById('export-unaffiliated-logs');
if (!(unaffiliatedLogsExportButton && unaffiliatedLogsExportButton instanceof HTMLButtonElement)) throw new Error('valid export-unaffiliated-logs button not found');

const historyList = document.getElementById('history');
if (!(historyList && historyList instanceof HTMLOListElement)) throw new Error('valid history list not found');

const pendingActionDiv = document.getElementById('pending-action');
if (!(pendingActionDiv && pendingActionDiv instanceof HTMLDivElement)) throw new Error('valid pending-action div not found');

const monitorModeContainer = document.getElementById('monitor-mode-container');
if (!(monitorModeContainer && monitorModeContainer instanceof HTMLDivElement)) throw new Error('valid monitor-mode-container not found');

const monitorFeedbackField = document.getElementById('monitor-feedback');
if (!(monitorFeedbackField && monitorFeedbackField instanceof HTMLTextAreaElement)) throw new Error('valid monitor-feedback field not found');

const monitorApproveButton = document.getElementById('approve');
if (!(monitorApproveButton && monitorApproveButton instanceof HTMLButtonElement)) throw new Error('valid approve button not found');

const monitorRejectButton = document.getElementById('reject');
if (!(monitorRejectButton && monitorRejectButton instanceof HTMLButtonElement)) throw new Error('valid reject button not found');

const manager = new SidePanelManager({
    eulaComplaintContainer: eulaComplaintElem as HTMLDivElement,
    startButton: startButton as HTMLButtonElement,
    taskSpecField: taskSpecField as HTMLTextAreaElement,
    statusDiv: statusDiv as HTMLDivElement,
    statusPopup: statusPopup as HTMLSpanElement,
    killButton: killButton as HTMLButtonElement,
    historyList: historyList as HTMLOListElement,
    pendingActionDiv: pendingActionDiv as HTMLDivElement,
    monitorModeContainer: monitorModeContainer as HTMLDivElement,
    monitorFeedbackField: monitorFeedbackField as HTMLTextAreaElement,
    monitorApproveButton: monitorApproveButton as HTMLButtonElement,
    monitorRejectButton: monitorRejectButton as HTMLButtonElement,
    unaffiliatedLogsExportButton: unaffiliatedLogsExportButton as HTMLButtonElement
});

document.addEventListener('mousemove', (e) => {
    manager.mouseClientX = e.clientX;
    manager.mouseClientY = e.clientY;
});

eulaReviewButton.addEventListener('click', () => chrome.tabs.create({url: './src/installation_greeting.html'}));
userGuideButton.addEventListener('click', () => chrome.tabs.create({url: 'user_manual.pdf'}));

//redirecting click on icon to click on button so that disabling the button effectively disables its icon as well
startButton.addEventListener('click', manager.startTaskClickHandler);

killButton.addEventListener('click', manager.killTaskClickHandler);

optionsButton.addEventListener('click', manager.optionsButtonClickHandler);

unaffiliatedLogsExportButton.addEventListener('click', manager.unaffiliatedLogsExportButtonClickHandler);

monitorApproveButton.addEventListener('click', manager.monitorApproveButtonClickHandler);

monitorRejectButton.addEventListener('click', manager.monitorRejectButtonClickHandler);


statusDiv.addEventListener('mouseenter', manager.displayStatusPopup);
statusDiv.addEventListener('mouseleave', () => manager.handleMouseLeaveStatus(statusDiv));
statusPopup.addEventListener('mouseleave', () => manager.handleMouseLeaveStatus(statusPopup));
