import {Logger} from "loglevel";
import {retryAsync} from "ts-retry";
import {createNamedLogger} from "./shared_logging_setup";
import {AiEngineCreateOptions, AiProviderDetails, GenerateOptions} from "./ai_misc";

/**
 * base type for all AI engines (each of which works with a different backend API that provides access to AI models)
 */
export abstract class AiEngine {
    static readonly NO_API_KEY_ERR = "must pass the api_key to the AI engine";
    static readonly ELEMENTLESS_GROUNDING_TRIGGER = "SKIP_ELEMENT_SELECTION";
    static readonly PLACEHOLDER_API_KEY = "PLACEHOLDER_API_KEY";

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
                } else if (this.checkIfNonfatalError(err)) {
                    this.logger.warn(`non-fatal problem with ${this.providerDetails().label} API, will retry; problem: ${err.message}`);
                } else {
                    this.logger.error(`problem (${err.message}) occurred with ${this.providerDetails().label} API that isn't likely to get better, not retrying`);
                    throw err;
                }
            }
        });
    }

    assemblePriorOutputsForAutoMonitoring = (planningOutput: string | undefined, groundingOutput: string | undefined
    ): string => {
        let priorModelOutputs = "PLANNING: \n\n";
        if (planningOutput === undefined) {
            throw new Error("planning Output must be provided for the auto-monitoring ai generation");
        } else if (planningOutput.length > 0) {
            priorModelOutputs += planningOutput + "\n\n-------------\n\n";
        } else {
            this.logger.info("LLM MALFUNCTION- planning output was empty string");
        }
        priorModelOutputs += "GROUNDING: \n\n";
        if (groundingOutput === undefined) {
            throw new Error("grounding Output must be provided for the auto-monitoring ai generation");
        } else if (groundingOutput.length > 0) {
            priorModelOutputs += groundingOutput;
        } else {
            this.logger.info("LLM MALFUNCTION- grounding output was empty string");
        }
        return priorModelOutputs;
    }
}