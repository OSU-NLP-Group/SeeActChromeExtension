import {createNamedLogger, defaultLogLevel, isLogLevelName} from "./utils/shared_logging_setup";
import {
    defaultIsMonitorMode,
    defaultMaxFailureOrNoopStreak,
    defaultMaxFailures,
    defaultMaxNoops,
    defaultMaxOps, defaultShouldWipeActionHistoryOnStart, validateIntegerLimitUpdate
} from "./utils/misc";

import "./styles/global_styles.css";
import "./options.css";

const logger = createNamedLogger('options-menu', false);

const openAiApiKeyField = document.getElementById('open-ai-api-key') as HTMLInputElement;
if (!openAiApiKeyField) throw new Error('open-ai-api-key field not found');

const logLevelSelector = document.getElementById('log-level') as HTMLSelectElement;
if (!logLevelSelector) throw new Error('log-level selector not found');

const monitorModeToggle = document.getElementById('monitor-mode') as HTMLInputElement;
if (!monitorModeToggle) throw new Error('monitor-mode toggle not found');

const maxOpsField = document.getElementById('max-operations') as HTMLInputElement;
if (!maxOpsField) throw new Error('max-ops field not found');

const maxNoopsField = document.getElementById('max-noops') as HTMLInputElement;
if (!maxNoopsField) throw new Error('max-noops field not found');

const maxFailuresField = document.getElementById('max-failures') as HTMLInputElement;
if (!maxFailuresField) throw new Error('max-failures field not found');

const maxFailOrNoopStreakField = document.getElementById('max-failure-or-noop-streak') as HTMLInputElement;
if (!maxFailOrNoopStreakField) throw new Error('max-failure-or-noop-streak field not found');

const wipeHistoryOnTaskStartToggle = document.getElementById('wipe-prior-history-on-task-start') as HTMLInputElement;
if (!wipeHistoryOnTaskStartToggle) throw new Error('wipe-history-on-task-start toggle not found');

const statusDisplay = document.getElementById('status-display');
if (!statusDisplay) throw new Error('status-display div not found');

const saveButton = document.getElementById('save');
if (!saveButton) throw new Error('save button not found');


chrome.storage.local.get(['openAiApiKey', 'logLevel', 'isMonitorMode', 'maxOps', 'maxNoops', 'maxFailures',
    'maxFailureOrNoopStreak', 'shouldWipeHistoryOnTaskStart']).then(
    (items) => {
        openAiApiKeyField.value = '';
        if (typeof items.openAiApiKey === 'string') {
            openAiApiKeyField.value = items.openAiApiKey;
        } else if (items.openAiApiKey !== undefined) {logger.error(`invalid openAiApiKey value was found in local storage: ${items.openAiApiKey}, ignoring it`);}

        logLevelSelector.value = defaultLogLevel;
        if (isLogLevelName(items.logLevel)) {
            logLevelSelector.value = items.logLevel;
        } else if (items.logLevel !== undefined) {logger.error(`invalid log level value was found in local storage: ${items.logLevel}, ignoring it`);}

        monitorModeToggle.checked = defaultIsMonitorMode;
        if (typeof items.isMonitorMode === 'boolean') {
            monitorModeToggle.checked = items.isMonitorMode;
        } else if (items.isMonitorMode !== undefined) {logger.error(`invalid monitor mode value was found in local storage: ${items.isMonitorMode}, ignoring it`);}

        maxOpsField.value = String(defaultMaxOps);
        if (validateIntegerLimitUpdate(items.maxOps, 1)) {
            maxOpsField.value = String(items.maxOps);
        } else if (items.maxOps !== undefined) {logger.error(`invalid maxOps value was found in local storage: ${items.maxOps}, ignoring it`);}

        maxNoopsField.value = String(defaultMaxNoops);
        if (validateIntegerLimitUpdate(items.maxNoops)) {
            maxNoopsField.value = String(items.maxNoops);
        } else if (items.maxNoops !== undefined) {logger.error(`invalid maxNoops value was found in local storage: ${items.maxNoops}, ignoring it`);}

        maxFailuresField.value = String(defaultMaxFailures);// items.maxFailures
        if (validateIntegerLimitUpdate(items.maxFailures)) {
            maxFailuresField.value = String(items.maxFailures);
        } else if (items.maxFailures !== undefined) {logger.error(`invalid maxFailures value was found in local storage: ${items.maxFailures}, ignoring it`);}

        maxFailOrNoopStreakField.value = String(defaultMaxFailureOrNoopStreak);
        if (validateIntegerLimitUpdate(items.maxFailureOrNoopStreak)) {
            maxFailuresField.value = String(items.maxFailureOrNoopStreak);
        } else if (items.maxFailureOrNoopStreak !== undefined) {logger.error(`invalid maxFailureOrNoopStreak value was found in local storage: ${items.maxFailureOrNoopStreak}, ignoring it`);}

        wipeHistoryOnTaskStartToggle.checked = defaultShouldWipeActionHistoryOnStart;
        if (typeof items.shouldWipeHistoryOnTaskStart === 'boolean') {
            wipeHistoryOnTaskStartToggle.checked = items.shouldWipeHistoryOnTaskStart;
        } else if (items.shouldWipeHistoryOnTaskStart !== undefined) {logger.error(`invalid shouldWipeHistoryOnTaskStart value was found in local storage: ${items.shouldWipeHistoryOnTaskStart}, ignoring it`);}

        statusDisplay.textContent = "Loaded";
    }, (err) => {
        logger.error('error while fetching settings from storage:', err);
        statusDisplay.textContent = 'Error while fetching settings from storage: ' + err;
    }
)

const pendingStatus = 'Pending changes not saved yet';

openAiApiKeyField.addEventListener('input', () => {statusDisplay.textContent = pendingStatus;});
logLevelSelector.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
monitorModeToggle.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
maxOpsField.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
maxNoopsField.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
maxFailuresField.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
maxFailOrNoopStreakField.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});
wipeHistoryOnTaskStartToggle.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;});

saveButton.addEventListener('click', () => {
    if (statusDisplay.textContent !== pendingStatus) {
        logger.warn('save button clicked when no changes were pending');
        statusDisplay.textContent = "Cannot save with no pending changes";
        return;
    }
    statusDisplay.textContent = "Saving";
    const maxOpsVal = parseInt(maxOpsField.value);
    const maxNoopsVal = parseInt(maxNoopsField.value);
    const maxFailuresVal = parseInt(maxFailuresField.value);
    const maxFailOrNoopStreakVal = parseInt(maxFailOrNoopStreakField.value);
    chrome.storage.local.set({
        openAiApiKey: openAiApiKeyField.value,
        logLevel: logLevelSelector.value || defaultLogLevel,
        isMonitorMode: monitorModeToggle.checked,
        shouldWipeHistoryOnTaskStart: wipeHistoryOnTaskStartToggle.checked,
        maxOps: maxOpsVal || defaultMaxOps,
        maxNoops: maxNoopsVal || defaultMaxNoops,
        maxFailures: maxFailuresVal || defaultMaxFailures,
        maxFailureOrNoopStreak: maxFailOrNoopStreakVal || defaultMaxFailureOrNoopStreak
    }).then(() => {
        logger.debug("settings saved");
        statusDisplay.textContent = "Settings saved";
    }, (err) => {
        logger.error("error while saving settings:", err);
        statusDisplay.textContent = "Error while saving settings: " + err;
    });
});
