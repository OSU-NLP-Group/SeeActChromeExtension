import {createNamedLogger} from "./utils/shared_logging_setup";
import {PageRequestType} from "./utils/misc";

const logger = createNamedLogger('side-panel', false);

const startButton = document.getElementById('startAgent');
if (!startButton) throw new Error('startAgent button not found');

const taskSpecField = document.getElementById('task-spec') as HTMLInputElement;
if (!taskSpecField) throw new Error('task-spec field not found');

const statusDiv = document.getElementById('status');
if (!statusDiv) throw new Error('status div not found');

const killButton = document.getElementById('endTask');
if (!killButton) throw new Error('endTask button not found');

const optionsButton = document.getElementById('options');
if (!optionsButton) throw new Error('options button not found');

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
        setTimeout(() => {
            window.close();
        }, 2000);

        //todo allow user in config menu to decide whether or not they want pop-up to automatically/immediately close on successful task start
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