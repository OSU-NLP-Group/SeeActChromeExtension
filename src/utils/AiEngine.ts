import {Logger} from "loglevel";
import {LmmPrompts} from "./format_prompts";
import {retryAsync} from "ts-retry";
import {AiProviderDetails, AiProviderKey, AiProviders, defaultAiProvider, storageKeyForAiProviderType} from "./misc";
import {createNamedLogger} from "./shared_logging_setup";

/**
 * @description creates an AI engine instance based on what the user set in the options menu
 * @returns the AI engine for the API/provider which the user configured the extension to use
 */
export async function createSelectedAiEngine(): Promise<AiEngine> {
    let aiEngine: AiEngine;
    const aiProviderSelectionQuery = await chrome.storage.local.get(storageKeyForAiProviderType);
    const selectedAiProvider = String(aiProviderSelectionQuery[storageKeyForAiProviderType] ?? defaultAiProvider);
    if (selectedAiProvider in AiProviders) {
        const aiProviderDetails = AiProviders[selectedAiProvider as AiProviderKey];
        const apiKeyQuery = await chrome.storage.local.get(aiProviderDetails.storageKeyForApiKey);
        const userProvidedApiKey = String(apiKeyQuery[aiProviderDetails.storageKeyForApiKey] ?? "PLACEHOLDER_API_KEY");
        aiEngine = aiProviderDetails.engineCreator({apiKey: userProvidedApiKey});
    } else {//shouldn't be possible to reach this unless bug or else user seriously screwed with stuff via Chrome DevTools
        throw new Error(`invalid ai provider selected: ${selectedAiProvider}`);
    }
    return aiEngine;
}

/**
 * base type for all AI engines (each of which works with a different backend API that provides access to AI models)
 */
export abstract class AiEngine {
    static readonly NO_API_KEY_ERR = "must pass the api_key to the AI engine";
    static readonly ELEMENTLESS_GROUNDING_TRIGGER = "SKIP_ELEMENT_SELECTION";

    readonly logger: Logger;

    apiKeys: Array<string>;
    model: string;
    temperature: number;
    stop: string;//todo check with Boyuan- is it correct that the python code doesn't actually use this?

    requestInterval: number;
    nextAvailTime: Array<number>;
    currKeyIdx: number;

    protected constructor({loggerToUse, model, apiKey, stop, rateLimit = -1, temperature}:
                              AiEngineCreateOptions) {
        this.logger = loggerToUse ?? createNamedLogger(
            `${this.providerDetails().label.split(" ").join("-").toLowerCase()}-engine`, true);
        this.model = model ?? this.providerDetails().defaultModelName;
        this.stop = stop ?? "\n\n";
        this.temperature = temperature ?? 0;

        let apiKeys: Array<string> = [];
        const apiKeyInputUseless = apiKey == undefined ||
            (Array.isArray(apiKey) && apiKey.length == 0);
        if (apiKeyInputUseless) {//will need to change this when Ollama support is added
            throw new Error(AiEngine.NO_API_KEY_ERR);
        } else {
            if (typeof apiKey === "string") {
                apiKeys.push(apiKey);
            } else {
                apiKeys = apiKey;
            }
        }
        this.apiKeys = apiKeys;

        const storageKeyForCurrProviderApiKey = this.providerDetails().storageKeyForApiKey;
        if (storageKeyForCurrProviderApiKey && chrome?.storage?.local) {
            chrome.storage.local.onChanged.addListener((changes: { [p: string]: chrome.storage.StorageChange }) => {
                if (changes[storageKeyForCurrProviderApiKey] !== undefined) {
                    const newKey: string = changes[storageKeyForCurrProviderApiKey].newValue;
                    this.apiKeys = [newKey];
                }
            });
        }

        this.requestInterval = rateLimit <= 0 ? 0 : 60 / rateLimit;
        this.nextAvailTime = new Array<number>(this.apiKeys.length).fill(0);
        this.currKeyIdx = 0;
    }

    /**
     * @description a human-readable label/name for the engine's AI model provider
     */
    abstract providerDetails(): AiProviderDetails;

    abstract checkIfRateLimitError(err: any): boolean;

    abstract extractRateLimitErrDetails(err: any): string | null;

    abstract checkIfNonfatalError(err: any): boolean;

    /**
     * @description Generate a completion from some LMM provider's API
     * @param generationOptions the options for the generate call
     * @return the model's response for the current query
     */
    abstract generate(generationOptions: GenerateOptions): Promise<string>;

    /**
     * {@link generate} with retry logic
     * @param options the options for the generate call
     * @param backoffBaseDelay the base delay in ms for the exponential backoff algorithm
     * @param backoffMaxTries maximum number of attempts for the exponential backoff algorithm
     */
    generateWithRetry = async (options: GenerateOptions,
                               backoffBaseDelay: number = 100, backoffMaxTries: number = 10): Promise<string> => {
        const generateCall = async () => this.generate(options);

        return await retryAsync(generateCall, {
            delay: (parameter: { currentTry: number, maxTry: number, lastDelay?: number, lastResult?: string }) => {
                return backoffBaseDelay * Math.pow(3, parameter.currentTry - 1);
            },
            maxTry: backoffMaxTries,
            onError: (err: Error) => {
                if (this.checkIfRateLimitError(err)) {
                    const rateLimitIssueDetails = this.extractRateLimitErrDetails(err) ?? "details couldn't be parsed";
                    this.logger.info(`hit ${this.providerDetails().label} rate limit but will retry: ${rateLimitIssueDetails}`);
                }
                else if (this.checkIfNonfatalError(err)) {
                    this.logger.warn(`non-fatal problem with ${this.providerDetails().label} API, will retry; problem: ${err.message}`);
                } else {
                    this.logger.error(`problem (${err.message}) occurred with ${this.providerDetails().label} API that isn't likely to get better, not retrying`);
                    throw err;
                }
            }
        });
    }
}

/**
 * options for creating an AiEngine
 */
export interface AiEngineCreateOptions {
    /**
     * Model type to call in provider's API
     */
    model?: string;
    /**
     * one or more API keys to use for the AI engine's API (if more than one key, will rotate through them)
     * this is not required for provider/engine types that don't use API keys (e.g. eventually Ollama)
     */
    apiKey?: string | Array<string>;
    /**
     * Tokens indicate stop of sequence
     */
    stop?: string;
    /**
     * Max number of requests per minute
     */
    rateLimit?: number,
    /**
     * what temperature to use when sampling from the model
     */
    temperature?: number
    /**
     * optional way to inject a safe logger during testing or to override default logger naming behavior
     */
    loggerToUse?: Logger;
}

/**
 * @description Options for generating a completion from an API using an AiEngine
 */
export interface GenerateOptions {
    /**
     * system prompt, prompt for planning the next action,
     *  prompt for identifying the specific next element to interact with next,
     *  and alternative prompt for deciding on an element-independent action
     */
    prompts: LmmPrompts;
    /**
     * the 0-based index of the current query in the preparation for the current step's action
     *  0 means we're asking the model to analyze situation and plan next move
     *  1 means we're asking the model to identify the specific element to interact with next
     */
    turnInStep: 0 | 1;
    /**
     * a data url containing a base-64 encoded image to be used as input to the model
     */
    imgDataUrl?: string;
    /**
     * the output from the previous turn in the preparation for the current step's action
     */
    priorTurnOutput?: string;
    /**
     * the maximum number of tokens to generate in this turn
     */
    maxNewTokens?: number;
    /**
     * the temperature to use when sampling from the model
     *  (optional, by default uses the temperature set in the engine's constructor)
     */
    temp?: number;
    /**
     * the model to use for this completion  (optional, by default uses the model set in the engine's constructor)
     */
    model?: string;
}