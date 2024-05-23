import {createNamedLogger} from "./utils/shared_logging_setup";
import {PageRequestType} from "./utils/misc";

const logger = createNamedLogger('side-panel', false);

const startButton = document.getElementById('start-agent');
if (!startButton) throw new Error('startAgent button not found');

const taskSpecField = document.getElementById('task-spec') as HTMLInputElement;
if (!taskSpecField) throw new Error('task-spec field not found');

const statusDiv = document.getElementById('status');
if (!statusDiv) throw new Error('status div not found');

const killButton = document.getElementById('end-task');
if (!killButton) throw new Error('endTask button not found');

const optionsButton = document.getElementById('options');
if (!optionsButton) throw new Error('options button not found');

const historyList = document.getElementById('history-list') as HTMLOListElement;
if (!historyList) throw new Error('history-list not found');

startButton.addEventListener('click', async () => {
    logger.trace('startAgent button clicked');
    if (!taskSpecField.value) {
        logger.warn("task spec field is empty, can't start agent");
        return;
    }
    const taskSpec = taskSpecField.value;
    const taskStartResponse = await chrome.runtime.sendMessage(
        {reqType: PageRequestType.START_TASK, taskSpecification: taskSpec});

    statusDiv.style.display = 'block';
    if (taskStartResponse.success) {
        statusDiv.textContent = `Task ${taskStartResponse.taskId} started successfully`;
    } else {
        statusDiv.textContent = 'Task start failed: ' + taskStartResponse.message;
    }

    //Hide the status div after 10 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }, 10000);

});

killButton.addEventListener('click', async () => {
    logger.trace('endTask button clicked');
    const taskEndResponse = await chrome.runtime.sendMessage({reqType: PageRequestType.END_TASK});

    if (taskEndResponse.success) {
        statusDiv.textContent = `Task ${taskEndResponse.taskId} ended successfully`;
    } else {
        statusDiv.textContent = 'Task end failed: ' + taskEndResponse.message;
    }
    statusDiv.style.display = 'block';

    // Hide the status div after 10 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }, 10000);
});

optionsButton.addEventListener('click', () => {
    logger.trace('options button clicked');

    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage().then(() => {
            logger.trace('options page opened');
        }, (err) => {
            logger.error('error while opening options page:', err);
        });
    } else {
        logger.trace('chrome.runtime.openOptionsPage() not available, opening options.html directly');
        window.open(chrome.runtime.getURL('src/options.html'));
    }
});

/*
const portToBackground: chrome.runtime.Port|undefined;

chrome.runtime.onConnect.addListener((port: chrome.runtime.Port): void => {
    //todo
});
*/

//todo add connection to background script to receive task history entries and display them in the history list
// I think this can/should be a listener here for connection requests from backend, or maybe just for messages from backend
// that are task history entries
