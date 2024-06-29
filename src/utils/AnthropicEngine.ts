import {
    ImageBlockParam, MessageCreateParamsNonStreaming, TextBlock, TextBlockParam,
    ToolResultBlockParam, ToolUseBlock, ToolUseBlockParam
} from "@anthropic-ai/sdk/resources/index.mjs";
import {AiEngine, AiEngineCreateOptions, GenerateOptions} from "./AiEngine";
import {Action, AiProviderDetails, AiProviders} from "./misc";
import Anthropic, {
    APIConnectionError,
    APIConnectionTimeoutError,
    InternalServerError,
    RateLimitError
} from "@anthropic-ai/sdk";
import {
    groundingPromptElementParamDesc,
    groundingPromptExplanationParamDesc,
    groundingPromptValueParamDesc
} from "./format_prompts";

export class AnthropicEngine extends AiEngine {

    anthropic: Anthropic;

    providerDetails(): AiProviderDetails { return AiProviders.ANTHROPIC; }

    /**
     * @description Create an Anthropic AI Engine to call the Anthropic API for some particular model
     * @param creationOptions object with options for creating the engine
     * @param anthropic object for accessing Anthropic API (dependency injection)
     */
    constructor(creationOptions: AiEngineCreateOptions, anthropic?: Anthropic) {
        //todo maybe validate model string against accepted (i.e. VLM) openai model names, which would be stored as static constants in this class?
        super(creationOptions);
        this.anthropic = anthropic ?? new Anthropic({apiKey: this.apiKeys[0]});
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
        this.anthropic.apiKey = this.apiKeys[this.currKeyIdx];

        const requestBody: MessageCreateParamsNonStreaming = {
            max_tokens: maxNewTokens,
            model: model,
            temperature: temp,
            system: prompts.sysPrompt,
            messages: [
                {role: "user", content: [{type: "text", text: prompts.queryPrompt}]}
            ]
        };
        if (imgDataUrl) {
            (requestBody.messages[0].content as Array<TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam>)
                .push({type: "image", source: {data: imgDataUrl, media_type: "image/png", type: "base64"}});
        }

        let respStr: string | undefined;
        if (turnInStep === 0) {
            const response = await this.anthropic.messages.create(requestBody);
            respStr = (response.content[0] as TextBlock).text;
        } else if (turnInStep === 1) {
            if (priorTurnOutput) {
                requestBody.messages.push({role: "assistant", content: priorTurnOutput});
            } else {
                throw new Error("priorTurnOutput must be provided for turn 1");
            }

            requestBody.tools = [{
                name: "browser_action",
                description: "mechanism for acting on the web page on the user's behalf",
                input_schema: {
                    type: "object",
                    properties: {
                        explanation: {type: ["string"], description: groundingPromptExplanationParamDesc},
                        element: {type: ["string", "null"], description: groundingPromptElementParamDesc},
                        action: {
                            type: ["string"], description: "the type of the next action that should be taken",
                            enum: Object.keys(Action)
                        },
                        value: {type: ["string", "null"], description: groundingPromptValueParamDesc},
                    },
                    required: ["explanation", "element", "action", "value"]
                }
            }];

            if (priorTurnOutput.includes(AiEngine.ELEMENTLESS_GROUNDING_TRIGGER)) {
                requestBody.messages.push({role: "user", content: prompts.elementlessActionPrompt});
            } else {
                requestBody.messages.push({role: "user", content: prompts.groundingPrompt});
            }

            const response = await this.anthropic.messages.create(requestBody);
            if (response.stop_reason === "tool_use") {
                const reasoningBlock = response.content.find((block) => block.type === "text") as TextBlock;
                const toolUseBlock = response.content.find((block) => block.type === "tool_use") as ToolUseBlock;
                const inputsToTool: any = toolUseBlock?.input ?? {explanation: "no input to tool"};
                inputsToTool["reasoning"] = reasoningBlock?.text;
                respStr = JSON.stringify(inputsToTool);
            } else { this.logger.info("PROMPTING_FAILURE- Claude failed to use the 'browser_action' tool for grounding step") }
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- override
    extractRateLimitErrDetails(err: any): string | null {
        return "no useful details in anthropic rate limit response message";
    }

    checkIfNonfatalError(err: any): boolean {
        return err instanceof APIConnectionError || err instanceof APIConnectionTimeoutError
            || err instanceof InternalServerError;
    }

}