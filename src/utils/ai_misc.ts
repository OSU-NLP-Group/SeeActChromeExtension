import {AiEngine} from "./AiEngine";
import {OpenAiEngine} from "./OpenAiEngine";
import {AnthropicEngine} from "./AnthropicEngine";
import {storageKeyForAiProviderType} from "./misc";
import {LmmPrompts} from "./format_prompts";
import { Logger } from "loglevel";
import {GoogleDeepmindEngine} from "./GoogleDeepmindEngine";



export interface AiProviderDetails {
    /**
     * unique identifier
     */
    id: AiProviderId;
    /**
     * human-readable name
     */
    label: string;
    /**
     * leaving nullable b/c some providers like locally-hosted Ollama won't have one
     */
    storageKeyForApiKey?: string;
    /**
     * exact value is based on the model names that the provider's api accepts
     */
    defaultModelName: string;
    /**
     * method for constructing the corresponding provider type's ai engine class; allows AiProviders to act like a Factory
     * @param creationOptions the options to use when constructing the appropriate type of ai engine
     */
    engineCreator: (creationOptions: AiEngineCreateOptions) => AiEngine;
    //later, can add list of acceptable model names (must be VLM's)
}

/**
 * mapping from the names of AI providers (as persisted in local storage in the provider option) to human-readable names
 */
export const AiProviders = {
    OPEN_AI: {
        id: "OPEN_AI", label: "OpenAI", storageKeyForApiKey: "openAiApiKey", defaultModelName: "gpt-4o-2024-05-13",
        engineCreator: (creationOptions: AiEngineCreateOptions) => new OpenAiEngine(creationOptions)
    },
    ANTHROPIC: {
        id: "ANTHROPIC", label: "Anthropic", storageKeyForApiKey: "anthropicApiKey",
        defaultModelName: "claude-3-5-sonnet-20240620",
        engineCreator: (creationOptions: AiEngineCreateOptions) => new AnthropicEngine(creationOptions)
    },
    GOOGLE_DEEPMIND: {
        id: "GOOGLE_DEEPMIND", label: "Google DeepMind", storageKeyForApiKey: "googleDeepmindApiKey",
        defaultModelName: "gemini-1.5-pro",
        engineCreator: (creationOptions: AiEngineCreateOptions) => new GoogleDeepmindEngine(creationOptions)
    }
    //can later add Aliyun API (for Qwen-VL-Max) and Ollama (for local/personal hosting of misc small VLM's like phi-3-vision or paligemma)
} as const;
//Ensure that each value in AiProviders satisfies the interface AiProviderDetails
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- it's a type check
const _typeCheck: Record<string, AiProviderDetails> = AiProviders;

export type AiProviderId = keyof typeof AiProviders;
export const defaultAiProvider: AiProviderId = AiProviders.OPEN_AI.id;

/**
 * @description creates an AI engine instance based on what the user set in the options menu
 * @returns the AI engine for the API/provider which the user configured the extension to use
 */
export async function createSelectedAiEngine(): Promise<AiEngine> {
    let aiEngine: AiEngine;
    const aiProviderSelectionQuery = await chrome.storage.local.get(storageKeyForAiProviderType);
    console.info(`aiProviderSelectionQuery: ${JSON.stringify(aiProviderSelectionQuery)}`);
    const selectedAiProvider = String(aiProviderSelectionQuery[storageKeyForAiProviderType] ?? defaultAiProvider);
    if (selectedAiProvider in AiProviders) {
        const aiProviderDetails = AiProviders[selectedAiProvider as AiProviderId];
        const apiKeyQuery = await chrome.storage.local.get(aiProviderDetails.storageKeyForApiKey);
        const userProvidedApiKey = String(apiKeyQuery[aiProviderDetails.storageKeyForApiKey] ?? AiEngine.PLACEHOLDER_API_KEY);
        aiEngine = aiProviderDetails.engineCreator({apiKey: userProvidedApiKey});
    } else {//shouldn't be possible to reach this unless bug or else user seriously screwed with stuff via Chrome DevTools
        throw new Error(`invalid ai provider selected: ${selectedAiProvider}`);
    }
    return aiEngine;
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