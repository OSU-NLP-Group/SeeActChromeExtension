import {createNamedLogger, defaultLogLevel, isLogLevelName} from "./utils/shared_logging_setup";
import {
    AiProviders,
    defaultIsMonitorMode,
    defaultMaxFailureOrNoopStreak,
    defaultMaxFailures,
    defaultMaxNoops,
    defaultMaxOps,
    defaultShouldWipeActionHistoryOnStart, storageKeyForAiProviderType,
    storageKeyForLogLevel, storageKeyForMaxFailureOrNoopStreak,
    storageKeyForMaxFailures,
    storageKeyForMaxNoops,
    storageKeyForMaxOps,
    storageKeyForMonitorMode,
    storageKeyForShouldWipeHistoryOnTaskStart,
    validateIntegerLimitUpdate
} from "./utils/misc";

import "./global_styles.css";
import "./options.css";

const logger = createNamedLogger('options-menu', false);

//todo select elem for provider type

const openAiApiKeyField = document.getElementById('open-ai-api-key') as HTMLInputElement;
if (!openAiApiKeyField) throw new Error('open-ai-api-key field not found');

//todo anthropic key field

//todo google deepmind key field

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


chrome.storage.local.get([storageKeyForAiProviderType, AiProviders.OPEN_AI.storageKeyForApiKey,
    AiProviders.ANTHROPIC.storageKeyForApiKey, AiProviders.GOOGLE_DEEPMIND.storageKeyForApiKey, storageKeyForLogLevel,
    storageKeyForMonitorMode, storageKeyForMaxOps, storageKeyForMaxNoops, storageKeyForMaxFailures,
    storageKeyForMaxFailureOrNoopStreak, storageKeyForShouldWipeHistoryOnTaskStart]).then(
    (items) => {

        //todo handle loading stored provider type

        openAiApiKeyField.value = '';
        const openAiApiKeyVal: unknown = items[AiProviders.OPEN_AI.storageKeyForApiKey];
        if (typeof openAiApiKeyVal === 'string') {
            openAiApiKeyField.value = openAiApiKeyVal;
        } else if (openAiApiKeyVal !== undefined) {logger.error(`invalid openAiApiKey value was found in local storage: ${openAiApiKeyVal}, ignoring it`);}

        //todo handle loading anthropic api key
        //todo handle loading google deepmind api key


        logLevelSelector.value = defaultLogLevel;
        const logLevelVal: unknown = items[storageKeyForLogLevel];
        if (isLogLevelName(logLevelVal)) {
            logLevelSelector.value = logLevelVal;
        } else if (logLevelVal !== undefined) {logger.error(`invalid log level value was found in local storage: ${logLevelVal}, ignoring it`);}

        monitorModeToggle.checked = defaultIsMonitorMode;
        const monitorModeVal = items[storageKeyForMonitorMode];
        if (typeof monitorModeVal === 'boolean') {
            monitorModeToggle.checked = monitorModeVal;
        } else if (monitorModeVal !== undefined) {logger.error(`invalid monitor mode value was found in local storage: ${monitorModeVal}, ignoring it`);}

        maxOpsField.value = String(defaultMaxOps);
        const maxOpsVal = items[storageKeyForMaxOps];
        if (validateIntegerLimitUpdate(maxOpsVal, 1)) {
            maxOpsField.value = String(maxOpsVal);
        } else if (maxOpsVal !== undefined) {logger.error(`invalid maxOps value was found in local storage: ${maxOpsVal}, ignoring it`);}

        maxNoopsField.value = String(defaultMaxNoops);
        const maxNoopsVal = items[storageKeyForMaxNoops];
        if (validateIntegerLimitUpdate(maxNoopsVal)) {
            maxNoopsField.value = String(maxNoopsVal);
        } else if (maxNoopsVal !== undefined) {logger.error(`invalid maxNoops value was found in local storage: ${maxNoopsVal}, ignoring it`);}

        maxFailuresField.value = String(defaultMaxFailures);
        const maxFailuresVal = items[storageKeyForMaxFailures];
        if (validateIntegerLimitUpdate(maxFailuresVal)) {
            maxFailuresField.value = String(maxFailuresVal);
        } else if (maxFailuresVal !== undefined) {logger.error(`invalid maxFailures value was found in local storage: ${maxFailuresVal}, ignoring it`);}

        maxFailOrNoopStreakField.value = String(defaultMaxFailureOrNoopStreak);
        const maxFailOrNoopStreakVal = items[storageKeyForMaxFailureOrNoopStreak];
        if (validateIntegerLimitUpdate(maxFailOrNoopStreakVal)) {
            maxFailuresField.value = String(maxFailOrNoopStreakVal);
        } else if (maxFailOrNoopStreakVal !== undefined) {logger.error(`invalid maxFailureOrNoopStreak value was found in local storage: ${maxFailOrNoopStreakVal}, ignoring it`);}

        wipeHistoryOnTaskStartToggle.checked = defaultShouldWipeActionHistoryOnStart;
        const wipeHistoryOnTaskStartVal = items[storageKeyForShouldWipeHistoryOnTaskStart];
        if (typeof wipeHistoryOnTaskStartVal === 'boolean') {
            wipeHistoryOnTaskStartToggle.checked = wipeHistoryOnTaskStartVal;
        } else if (wipeHistoryOnTaskStartVal !== undefined) {logger.error(`invalid shouldWipeHistoryOnTaskStart value was found in local storage: ${wipeHistoryOnTaskStartVal}, ignoring it`);}

        statusDisplay.textContent = "Loaded";
    }, (err) => {
        logger.error('error while fetching settings from storage:', err);
        statusDisplay.textContent = 'Error while fetching settings from storage: ' + err;
    }
)

const pendingStatus = 'Pending changes not saved yet';

//todo consider making list of these interactable elements and then doing a foreach or something for adding change listeners

//todo change listener for provider select
openAiApiKeyField.addEventListener('input', () => {statusDisplay.textContent = pendingStatus;});
//todo change listener for anthropic api key
//todo change listener for google deepmind api key
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

    const newValsForStorage: any = {};
    //todo maybe add logic here to enforce maxOps having floor of 1

    //todo show error if a given ai provider (with associated api key field) is selected, but its associated api key
    // field is empty

    //todo save provider type
    newValsForStorage[AiProviders.OPEN_AI.storageKeyForApiKey] = openAiApiKeyField.value;
    //todo save anthropic api key
    //todo save google deepmind api key
    newValsForStorage[storageKeyForLogLevel] = logLevelSelector.value || defaultLogLevel;
    newValsForStorage[storageKeyForMonitorMode] = monitorModeToggle.checked;
    newValsForStorage[storageKeyForShouldWipeHistoryOnTaskStart] = wipeHistoryOnTaskStartToggle.checked;
    newValsForStorage[storageKeyForMaxOps] = Number.isNaN(maxOpsVal) ? defaultMaxOps : maxOpsVal;
    newValsForStorage[storageKeyForMaxNoops] = Number.isNaN(maxNoopsVal) ? defaultMaxNoops : maxNoopsVal;
    newValsForStorage[storageKeyForMaxFailures] = Number.isNaN(maxFailuresVal) ? defaultMaxFailures : maxFailuresVal;
    newValsForStorage[storageKeyForMaxFailureOrNoopStreak] = Number.isNaN(maxFailOrNoopStreakVal) ? defaultMaxFailureOrNoopStreak : maxFailOrNoopStreakVal;

    chrome.storage.local.set(newValsForStorage).then(() => {
        logger.debug("settings saved");
        statusDisplay.textContent = "Settings saved";
    }, (err) => {
        logger.error("error while saving settings:", err);
        statusDisplay.textContent = "Error while saving settings: " + err;
    });
});
