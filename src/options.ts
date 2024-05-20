import {createNamedLogger, defaultLogLevel} from "./utils/shared_logging_setup";

const logger = createNamedLogger('options-menu', false);

const openAiApiKeyField = document.getElementById('open-ai-api-key') as HTMLInputElement;
if (!openAiApiKeyField) throw new Error('open-ai-api-key field not found');

const logLevelSelector = document.getElementById('log-level') as HTMLSelectElement;
if (!logLevelSelector) throw new Error('log-level selector not found');

const monitorModeToggle = document.getElementById('monitor-mode') as HTMLInputElement;
if(!monitorModeToggle) throw new Error('monitor-mode toggle not found');

const statusDisplay = document.getElementById('status-display');
if (!statusDisplay) throw new Error('status-display div not found');

const saveButton = document.getElementById('save');
if (!saveButton) throw new Error('save button not found');

chrome.storage.local.get(['openAiApiKey', 'logLevel', 'isMonitorMode']).then(
    (items) => {
        openAiApiKeyField.value = items.openAiApiKey ?? "";
        logLevelSelector.value = items.logLevel ?? defaultLogLevel;
        monitorModeToggle.checked = items.isMonitorMode;
        statusDisplay.textContent = "Loaded";
    }, (err) => {
        logger.error('error while fetching settings from storage:', err);
        statusDisplay.textContent = 'Error while fetching settings from storage: ' + err;
    }
)

const pendingStatus = 'Pending changes not saved yet';

openAiApiKeyField.addEventListener('input', () => {
    statusDisplay.textContent = pendingStatus;
});
logLevelSelector.addEventListener('change', () => {
    statusDisplay.textContent = pendingStatus;
});
monitorModeToggle.addEventListener('change', () => {
    statusDisplay.textContent = pendingStatus;
});
saveButton.addEventListener('click', () => {
    if (statusDisplay.textContent !== pendingStatus) {
        logger.warn('save button clicked when no changes were pending');
        statusDisplay.textContent = "Cannot save with no pending changes";
        return;
    }
    statusDisplay.textContent = "Saving";
    chrome.storage.local.set({
        openAiApiKey: openAiApiKeyField.value,
        logLevel: logLevelSelector.value,
        isMonitorMode: monitorModeToggle.checked
    }).then(() => {
        logger.debug("settings saved");
        statusDisplay.textContent = "Settings saved";
    }, (err) => {
        logger.error("error while saving settings:", err);
        statusDisplay.textContent = "Error while saving settings: " + err;
    });
});
