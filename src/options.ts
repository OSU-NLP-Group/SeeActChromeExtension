import {createNamedLogger, defaultLogLevel, isLogLevelName} from "./utils/shared_logging_setup";
import {
    defaultIsMonitorMode,
    defaultMaxFailureOrNoopStreak,
    defaultMaxFailures,
    defaultMaxNoops,
    defaultMaxOps,
    defaultShouldWipeActionHistoryOnStart,
    storageKeyForAiProviderType,
    storageKeyForLogLevel,
    storageKeyForMaxFailureOrNoopStreak,
    storageKeyForMaxFailures,
    storageKeyForMaxNoops,
    storageKeyForMaxOps,
    storageKeyForMonitorMode,
    storageKeyForShouldWipeHistoryOnTaskStart,
    validateIntegerLimitUpdate
} from "./utils/misc";

import "./global_styles.css";
import "./options.css";
import {AiProviders, defaultAiProvider} from "./utils/ai_misc";

const logger = createNamedLogger('options-menu', false);

const aiProviderElem = document.getElementById('model-provider');
if (!(aiProviderElem && aiProviderElem instanceof HTMLSelectElement)) throw new Error('valid ai-model-provider select not found');
const aiProviderSelect = aiProviderElem as HTMLSelectElement;

const openAiApiKeyElem = document.getElementById('open-ai-api-key');
if (!(openAiApiKeyElem && openAiApiKeyElem instanceof HTMLInputElement)) throw new Error('valid open-ai-api-key field not found');
const openAiApiKeyField = openAiApiKeyElem as HTMLInputElement;

const anthropicApiKeyElem = document.getElementById('anthropic-api-key');
if (!(anthropicApiKeyElem && anthropicApiKeyElem instanceof HTMLInputElement)) throw new Error('valid anthropic api-key field not found');
const anthropicApiKeyField = anthropicApiKeyElem as HTMLInputElement;

const googleDeepmindApiKeyElem = document.getElementById('google-deepmind-api-key');
if (!(googleDeepmindApiKeyElem && googleDeepmindApiKeyElem instanceof HTMLInputElement)) throw new Error('valid google deepmind api-key field not found');
const googleDeepmindApiKeyField = googleDeepmindApiKeyElem as HTMLInputElement;

const logLevelElem = document.getElementById('log-level');
if (!(logLevelElem && logLevelElem instanceof HTMLSelectElement)) throw new Error('valid log-level select not found');
const logLevelSelector = logLevelElem as HTMLSelectElement;

const monitorModeElem = document.getElementById('monitor-mode');
if (!(monitorModeElem && monitorModeElem instanceof HTMLInputElement)) throw new Error('valid monitor-mode toggle not found');
const monitorModeToggle = monitorModeElem as HTMLInputElement;

const maxOpsElem = document.getElementById('max-operations');
if (!(maxOpsElem && maxOpsElem instanceof HTMLInputElement)) throw new Error('valid max-operations field not found');
const maxOpsField = maxOpsElem as HTMLInputElement;

const maxNoopsElem = document.getElementById('max-noops');
if (!(maxNoopsElem && maxNoopsElem instanceof HTMLInputElement)) throw new Error('valid max-noops field not found');
const maxNoopsField = maxNoopsElem as HTMLInputElement;

const maxFailuresElem = document.getElementById('max-failures');
if (!(maxFailuresElem && maxFailuresElem instanceof HTMLInputElement)) throw new Error('valid max-failures field not found');
const maxFailuresField = maxFailuresElem as HTMLInputElement;

const maxFailOrNoopStreakElem = document.getElementById('max-failure-or-noop-streak');
if (!(maxFailOrNoopStreakElem && maxFailOrNoopStreakElem instanceof HTMLInputElement)) throw new Error('valid max-failure-or-noop-streak field not found');
const maxFailOrNoopStreakField = maxFailOrNoopStreakElem as HTMLInputElement;

const wipeHistoryOnTaskStartElem = document.getElementById('wipe-prior-history-on-task-start');
if (!(wipeHistoryOnTaskStartElem && wipeHistoryOnTaskStartElem instanceof HTMLInputElement)) throw new Error('valid wipe-history-on-task-start toggle not found');
const wipeHistoryOnTaskStartToggle = wipeHistoryOnTaskStartElem as HTMLInputElement;

const statusDisplayElem = document.getElementById('status-display');
if (!(statusDisplayElem && statusDisplayElem instanceof HTMLDivElement)) throw new Error('valid status-display div not found');
const statusDisplay = statusDisplayElem as HTMLDivElement;

const saveButtonElem = document.getElementById('save');
if (!(saveButtonElem && saveButtonElem instanceof HTMLButtonElement)) throw new Error('valid save button not found');
const saveButton = saveButtonElem as HTMLButtonElement;

chrome.storage.local.get([storageKeyForAiProviderType, AiProviders.OPEN_AI.storageKeyForApiKey,
    AiProviders.ANTHROPIC.storageKeyForApiKey, AiProviders.GOOGLE_DEEPMIND.storageKeyForApiKey, storageKeyForLogLevel,
    storageKeyForMonitorMode, storageKeyForMaxOps, storageKeyForMaxNoops, storageKeyForMaxFailures,
    storageKeyForMaxFailureOrNoopStreak, storageKeyForShouldWipeHistoryOnTaskStart]).then(
    (items) => {

        aiProviderSelect.value = defaultAiProvider;
        const aiProviderVal: unknown = items[storageKeyForAiProviderType];
        if (typeof aiProviderVal === 'string' && aiProviderVal in AiProviders) {
            aiProviderSelect.value = aiProviderVal;
        } else if (aiProviderVal !== undefined) {logger.error(`invalid aiProvider value was found in local storage: ${aiProviderVal}, ignoring it`);}

        openAiApiKeyField.value = '';
        const openAiApiKeyVal: unknown = items[AiProviders.OPEN_AI.storageKeyForApiKey];
        if (typeof openAiApiKeyVal === 'string') {
            openAiApiKeyField.value = openAiApiKeyVal;
        } else if (openAiApiKeyVal !== undefined) {logger.error(`invalid OpenAI ApiKey value was found in local storage: ${openAiApiKeyVal}, ignoring it`);}

        anthropicApiKeyField.value = '';
        const anthropicApiKeyVal: unknown = items[AiProviders.ANTHROPIC.storageKeyForApiKey];
        if (typeof anthropicApiKeyVal === 'string') {
            anthropicApiKeyField.value = anthropicApiKeyVal;
        } else if (anthropicApiKeyVal !== undefined) {logger.error(`invalid Anthropic ApiKey value was found in local storage: ${anthropicApiKeyVal}, ignoring it`);}

        googleDeepmindApiKeyField.value = '';
        const googleDeepmindApiKeyVal: unknown = items[AiProviders.GOOGLE_DEEPMIND.storageKeyForApiKey];
        if (typeof googleDeepmindApiKeyVal === 'string') {
            googleDeepmindApiKeyField.value = googleDeepmindApiKeyVal;
        } else if (googleDeepmindApiKeyVal !== undefined) {logger.error(`invalid Google Deepmind ApiKey value was found in local storage: ${googleDeepmindApiKeyVal}, ignoring it`);}

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

const configInputElems = [aiProviderSelect, openAiApiKeyField, anthropicApiKeyField,
    googleDeepmindApiKeyField, logLevelSelector, monitorModeToggle, maxOpsField, maxNoopsField, maxFailuresField,
    maxFailOrNoopStreakField, wipeHistoryOnTaskStartToggle];
for (const configElem of configInputElems) {
    configElem.addEventListener('change', () => {statusDisplay.textContent = pendingStatus;})
}

saveButton.addEventListener('click', () => {
    if (statusDisplay.textContent !== pendingStatus) {
        logger.info('Options saving problem: save button clicked when no changes were pending');
        statusDisplay.textContent = "Cannot save with no pending changes";
        return;
    }
    statusDisplay.textContent = "Saving";
    const maxOpsVal = parseInt(maxOpsField.value);
    const maxNoopsVal = parseInt(maxNoopsField.value);
    const maxFailuresVal = parseInt(maxFailuresField.value);
    const maxFailOrNoopStreakVal = parseInt(maxFailOrNoopStreakField.value);

    const newValsForStorage: any = {};

    if (!Number.isNaN(maxOpsVal) && maxOpsVal < 1) {
        logger.info(`Options saving problem: user attempted to save max operations value that was less than 1: ${maxOpsVal}`);
        statusDisplay.textContent = "Error: maxOps must be at least 1";
        return;
    }

    if ((aiProviderSelect.value === AiProviders.OPEN_AI.id && openAiApiKeyField.value === '')
        || (aiProviderSelect.value === AiProviders.ANTHROPIC.id && anthropicApiKeyField.value === '')
        || (aiProviderSelect.value === AiProviders.GOOGLE_DEEPMIND.id && googleDeepmindApiKeyField.value === '')) {
        logger.info(`Options saving problem: user attempted to save '${(aiProviderSelect.selectedOptions[0].value)}' choice of provider while that provider's api key field was empty`);
        statusDisplay.textContent = `Error: API key must be provided for selected AI provider ${aiProviderSelect.selectedOptions[0].text}`;
        return;
    }

    newValsForStorage[storageKeyForAiProviderType] = aiProviderSelect.value;
    newValsForStorage[AiProviders.OPEN_AI.storageKeyForApiKey] = openAiApiKeyField.value;
    newValsForStorage[AiProviders.ANTHROPIC.storageKeyForApiKey] = anthropicApiKeyField.value;
    newValsForStorage[AiProviders.GOOGLE_DEEPMIND.storageKeyForApiKey] = googleDeepmindApiKeyField.value;
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
