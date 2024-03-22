import {StrTriple} from "./format_prompts";
import OpenAI from "openai";

export class OpenAiEngine {
    static readonly noApiKeyErrMsg = "must pass on the api_key or set OPENAI_API_KEY in the environment";

    openAi: OpenAI;
    apiKeys: Array<string>;
    stop: string;
    model: string;
    temperature: number;

    requestInterval: number;
    nextAvailTime: Array<number>;
    currKeyIdx: number;

    /**
     * @description Create an OpenAiEngine to call the OpenAI API for some particular model
     * @param model Model type to call in OpenAI API
     * @param apiKey one or more API keys to use for the OpenAI API (if more than one, will rotate through them)
     * @param openAi object for accessing OpenAI API (dependency injection)
     * @param stop Tokens indicate stop of sequence
     * @param rateLimit Max number of requests per minute
     * @param temperature what temperature to use when sampling from the model
     */
    constructor(model: string, apiKey?: string | Array<string>, openAi?: OpenAI, stop: string = "\n\n", rateLimit: number = -1,
                temperature: number = 0) {
        this.openAi = openAi ?? new OpenAI();
        let apiKeys: Array<string> = [];
        const apiKeyInputUseless = apiKey == undefined ||
            (Array.isArray(apiKey) && apiKey.length == 0);
        if (apiKeyInputUseless) {
            const envApiKey = process.env.OPENAI_API_KEY;
            if (envApiKey == undefined) {
                throw new Error(OpenAiEngine.noApiKeyErrMsg);
            } else {
                apiKeys.push(envApiKey);
            }
        } else {
            if (typeof apiKey === "string") {
                apiKeys.push(apiKey);
            } else {
                apiKeys = apiKey;
            }
        }
        this.apiKeys = apiKeys;

        this.stop = stop;
        this.model = model;
        this.temperature = temperature;

        this.requestInterval = rateLimit <= 0 ? 0 : 60 / rateLimit;

        this.nextAvailTime = new Array<number>(this.apiKeys.length).fill(0);
        this.currKeyIdx = 0;
    }


    /**
     * @description Generate a completion from the OpenAI API
     * @param prompts system prompt, prompt for planning the next action, and
     *                  prompt for identifying the specific next element to interact with next
     * @param turnInStep the 0-based index of the current query in the preparation for the current step's action
     *                      0 means we're asking the model to analyze situation and plan next move
     *                      1 means we're asking the model to identify the specific element to interact with next
     * @param imgDataUrl a data url containing a base-64 encoded image to be used as input to the model
     * @param priorStageOutput the output from the previous turn in the preparation for the current step's action
     * @param maxNewTokens the maximum number of tokens to generate in this turn
     * @param temp the temperature to use when sampling from the model
     *              (optional, by default uses the temperature set in the constructor)
     * @param model the model to use for this completion
     *               (optional, by default uses the model set in the constructor)
     * @return the model's response for the current query
     */
    generate = (prompts: StrTriple, turnInStep: number, imgDataUrl?: string, priorStageOutput?: string,
                maxNewTokens: number = 4096, temp?: number, model?: string): string => {
        //todo implement this method
        return "nonsense";
    }
}