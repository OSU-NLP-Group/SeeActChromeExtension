import OpenAI from "openai";
import {APIConnectionError, APIConnectionTimeoutError, InternalServerError, RateLimitError} from "openai/error";
import {AiEngine, AiEngineCreateOptions, GenerateOptions} from "./AiEngine";
import {AiProviderDetails, AiProviders} from "./misc";
import ChatCompletionMessageParam = OpenAI.ChatCompletionMessageParam;
import ChatCompletionContentPart = OpenAI.ChatCompletionContentPart;

export class OpenAiEngine extends AiEngine {

    openAi: OpenAI;

    providerDetails(): AiProviderDetails { return AiProviders.OPEN_AI; }

    /**
     * @description Create an OpenAiEngine to call the OpenAI API for some particular model
     * @param creationOptions object with options for creating the engine
     * @param openAi object for accessing OpenAI API (dependency injection)
     */
    constructor(creationOptions: AiEngineCreateOptions, openAi?: OpenAI) {
        //todo automatic unpacking trick for effectively having named arguments in the constructor, b/c this is absurd

        //todo maybe validate model string against accepted (i.e. VLM) openai model names, which would be stored as static constants in this class?
        super(creationOptions);

        //only a person's own api key will be used, within their own browser instance, so it isn't dangerous
        // for this Chrome extension to use an api key in the browser
        this.openAi = openAi ?? new OpenAI({dangerouslyAllowBrowser: true, apiKey: this.apiKeys[0]});
    }


    generate = async ({
                          prompts, turnInStep, imgDataUrl, priorTurnOutput,
                          maxNewTokens = 4096, temp = this.temperature, model = this.model
                      }: GenerateOptions):
        Promise<string> => {

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

        const messages: Array<ChatCompletionMessageParam> = [
            {role: "system", content: prompts.sysPrompt},
            {role: "user", content: [{type: "text", text: prompts.queryPrompt}]}
        ];
        if (imgDataUrl) {
            (messages[1].content as Array<ChatCompletionContentPart>)
                .push({type: "image_url", image_url: {url: imgDataUrl, detail: "high"}});
        }

        let respStr: string | undefined | null;
        if (turnInStep === 0) {
            const response = await this.openAi.chat.completions.create(
                {messages: messages, model: model, temperature: temp, max_tokens: maxNewTokens});
            respStr = response.choices?.[0].message?.content;
            //confer with Boyuan- should this log warning with response object if respStr null? or throw error?
            // feedback - don't worry about the api being that weird/unreliable

        } else if (turnInStep === 1) {
            if (priorTurnOutput) {
                messages.push({role: "assistant", content: priorTurnOutput});
            } else {
                throw new Error("priorTurnOutput must be provided for turn 1");
            }

            if (priorTurnOutput.includes(AiEngine.ELEMENTLESS_GROUNDING_TRIGGER)) {
                messages.push({role: "user", content: prompts.elementlessActionPrompt});
            } else {
                messages.push({role: "user", content: prompts.groundingPrompt});
            }

            const response = await this.openAi.chat.completions.create({
                messages: messages, model: model, temperature: temp, max_tokens: maxNewTokens,
                response_format: {type: "json_object"}
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

        return respStr ?? `no model output in response from ${this.providerDetails().label} API`;
    }

    checkIfRateLimitError(err: any): boolean { return err instanceof RateLimitError; }

    extractRateLimitErrDetails(err: any): string | null {
        let errDetails = null;
        //sorry this is so hacky, but I want to keep some info without the retry log messages being massive
        // worst case, if/when the api rate limit message is restructured, all that will happen is that
        // these retry log messages become less detailed
        if (err instanceof RateLimitError) {
            const indexOfPrefix = err.message.indexOf(" on ");
            const indexOfSuffix = err.message.indexOf(". Visit");
            if (indexOfPrefix > 0 && indexOfSuffix > 0 && indexOfPrefix + 4 < indexOfSuffix) {
                errDetails = err.message.substring(indexOfPrefix + 4, indexOfSuffix);
            }
        } else { this.logger.warn("asked to extract details about hitting a rate limit from an object that wasn't actually a RateLimitError") }
        return errDetails;
    }

    checkIfNonfatalError(err: any): boolean {
        return err instanceof APIConnectionError || err instanceof APIConnectionTimeoutError
            || err instanceof InternalServerError;
    }

}