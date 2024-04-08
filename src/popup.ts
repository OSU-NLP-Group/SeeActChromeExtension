import {createNamedLogger} from "./utils/shared_logging_setup";

const logger = createNamedLogger('main-popup', false);

const startButton = document.getElementById('startAgent');
if (!startButton) throw new Error('startAgent button not found');

const taskSpecField = document.getElementById('task-spec') as HTMLInputElement;
if (!taskSpecField) throw new Error('task-spec field not found');

const statusDiv = document.getElementById('status');
if (!statusDiv) throw new Error('status div not found');

const killButton = document.getElementById('endTask');
if (!killButton) throw new Error('endTask button not found');


startButton.addEventListener('click', async () => {
    logger.trace('startAgent button clicked');
    if (!taskSpecField.value) {
        logger.warn("task spec field is empty, can't start agent");
        return;
    }
    const taskSpec = taskSpecField.value;
    const taskStartResponse = await chrome.runtime.sendMessage({
        reqType: "startTask",
        taskSpecification: taskSpec
    });

    if (taskStartResponse.success) {
        statusDiv.textContent = `Task ${taskStartResponse.taskId} started successfully`;
    } else {
        statusDiv.textContent = 'Task start failed: ' + taskStartResponse.message;
    }
    statusDiv.style.display = 'block';

    // Hide the status div after 10 seconds
    setTimeout(() => {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }, 10000);


});
//todo is it worth unit testing the above handler?

killButton.addEventListener('click', async () => {
    logger.trace('endTask button clicked');
    const taskEndResponse = await chrome.runtime.sendMessage({
        reqType: "endTask"
    });

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