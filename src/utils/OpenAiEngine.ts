import {StrTriple} from "./format_prompts";
import OpenAI from "openai";
import {APIConnectionError, APIConnectionTimeoutError, InternalServerError, RateLimitError} from "openai/error";
import {retryAsync} from "ts-retry";
import ChatCompletionMessageParam = OpenAI.ChatCompletionMessageParam;
import ChatCompletionContentPart = OpenAI.ChatCompletionContentPart;

export class OpenAiEngine {
    static readonly NO_API_KEY_ERR = "must pass on the api_key or set OPENAI_API_KEY in the environment";

    openAi: OpenAI;
    apiKeys: Array<string>;
    stop: string;//todo check with Boyuan- is it correct that the python code doesn't actually use this?
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
        //only a person's own api key will be used, within their own browser instance, so it isn't dangerous
        // for this chrome extension to use an api key in the browser
        this.openAi = openAi ?? new OpenAI({dangerouslyAllowBrowser: true});
        let apiKeys: Array<string> = [];
        const apiKeyInputUseless = apiKey == undefined ||
            (Array.isArray(apiKey) && apiKey.length == 0);
        if (apiKeyInputUseless) {
            const envApiKey = process.env.OPENAI_API_KEY;
            if (envApiKey == undefined) {
                throw new Error(OpenAiEngine.NO_API_KEY_ERR);
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
     * @param priorTurnOutput the output from the previous turn in the preparation for the current step's action
     * @param maxNewTokens the maximum number of tokens to generate in this turn
     * @param temp the temperature to use when sampling from the model
     *              (optional, by default uses the temperature set in the constructor)
     * @param model the model to use for this completion
     *               (optional, by default uses the model set in the constructor)
     * @return the model's response for the current query
     */
    generate = async (prompts: StrTriple, turnInStep: 0 | 1, imgDataUrl?: string, priorTurnOutput?: string,
                      maxNewTokens: number = 4096, temp?: number, model?: string): Promise<string> => {
        this.currKeyIdx = (this.currKeyIdx + 1) % this.apiKeys.length;
        //todo unit test and implement rate-limit-respecting sleep code if Boyuan confirms it's still desired
        // feedback- low priority for now
        /*
            start_time = time.time()
        if (
                self.request_interval > 0
                and start_time < self.next_avil_time[self.current_key_idx]
        ):
            time.sleep(self.next_avil_time[self.current_key_idx] - start_time)
         */
        this.openAi.apiKey = this.apiKeys[this.currKeyIdx];

        const tempToUse = temp ?? this.temperature;
        const modelToUse = model ?? this.model;

        const messages: Array<ChatCompletionMessageParam> = [
            {
                role: "system",
                content: prompts[0]
            },
            {
                role: "user",
                content: [
                    {type: "text", text: prompts[1]}
                ]
            }
        ];
        if (imgDataUrl) {
            (messages[1].content as Array<ChatCompletionContentPart>)
                .push({type: "image_url", image_url: {url: imgDataUrl, detail: "high"}});
        }

        let respStr: string | undefined | null;
        if (turnInStep === 0) {
            const response = await this.openAi.chat.completions.create({
                messages: messages, model: modelToUse, temperature: tempToUse, max_tokens: maxNewTokens
            });
            respStr = response.choices?.[0].message?.content;
            //confer with Boyuan- should this log warning with response object if respStr null? or throw error?
            // feedback - don't worry about the api being that weird/unreliable

        } else if (turnInStep === 1) {
            if (priorTurnOutput) {
                messages.push({
                    role: "assistant",
                    content: priorTurnOutput
                });
            } else {
                throw new Error("priorTurnOutput must be provided for turn 1");
            }

            messages.push({
                role: "user",
                content: prompts[2]
            });

            const response = await this.openAi.chat.completions.create({
                messages: messages, model: modelToUse, temperature: tempToUse, max_tokens: maxNewTokens
            });
            respStr = response.choices?.[0].message?.content;
            //confer with Boyuan- should this log warning with response object if respStr null? or throw error?
            // feedback - don't worry about the api being that weird/unreliable
        }
        //todo unit test and implement rate-limit-respecting code if Boyuan confirms it's still desired
        // feedback- low priority for now
        /*
            if self.request_interval > 0:
                self.next_avil_time[self.current_key_idx] = time.time() + self.request_interval
         */

        return respStr ?? "no model output in response from OpenAI API";
    }

    /**
     * {@link generate} with retry logic
     * @param backoffBaseDelay the base delay in ms for the exponential backoff algorithm
     * @param backoffMaxTries maximum number of attempts for the exponential backoff algorithm
     */
    generateWithRetry = async (prompts: StrTriple, turnInStep: 0 | 1, imgDataUrl?: string, priorTurnOutput?: string,
                               maxNewTokens: number = 4096, temp?: number, model?: string,
                               backoffBaseDelay: number = 100, backoffMaxTries: number = 10): Promise<string> => {
        const generateCall = async () => this.generate(prompts, turnInStep, imgDataUrl, priorTurnOutput, maxNewTokens, temp, model);

        return await retryAsync(generateCall, {
            delay: (parameter: { currentTry: number, maxTry: number, lastDelay?: number, lastResult?: string }) => {
                return backoffBaseDelay * Math.pow(2, parameter.currentTry - 1);
            },
            maxTry: backoffMaxTries,
            onError: (err: Error) => {
                if (err instanceof APIConnectionError || err instanceof RateLimitError
                    || err instanceof APIConnectionTimeoutError || err instanceof InternalServerError) {
                    console.warn(`problem (${err.message}) with OpenAI API, retrying at ${new Date().toISOString()}...`);
                } else {
                    console.error(`problem (${err.message}) occurred at ${new Date().toISOString()} with OpenAI API that isn't likely to get better, not retrying`);
                    throw err;//todo test whether this properly prevents retries after authentication issues/etc.
                }
            }
        });

    }
}