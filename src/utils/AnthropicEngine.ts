import {
    ImageBlockParam, MessageCreateParamsNonStreaming, TextBlock, TextBlockParam,
    ToolResultBlockParam, ToolUseBlock, ToolUseBlockParam
} from "@anthropic-ai/sdk/resources/index.mjs";
import {AiEngine} from "./AiEngine";
import {Action, ActionStateChangeSeverity} from "./misc";
import Anthropic, {
    APIConnectionError,
    APIConnectionTimeoutError,
    InternalServerError,
    RateLimitError
} from "@anthropic-ai/sdk";
import {
    actionJudgmentFuncDesc, actionJudgmentSeverityParamDesc,
    actionJudgmentRequiredProps,
    browserActionFuncDesc, browserActionRequiredProps, browserActionSchemaActionDesc,
    groundingPromptElementParamDesc,
    groundingPromptExplanationParamDesc,
    groundingPromptValueParamDesc, actionJudgmentExplanationParamDesc
} from "./format_prompts";
import {
    AiEngineCreateOptions,
    AiProviderDetails,
    AiProviders,
    GenerateMode,
    GenerateOptions
} from "./ai_misc";

const anthropicSupportedMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
function checkImageTypeIsAnthropicSupported(dataUrlImageType: string): dataUrlImageType is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
    return anthropicSupportedMediaTypes.includes(dataUrlImageType);
}

const anthropicSupportedEncodingTypes = ["base64"];
function checkImageEncodingTypeIsAnthropicSupported(dataUrlEncodingType: string): dataUrlEncodingType is "base64" {
    return anthropicSupportedEncodingTypes.includes(dataUrlEncodingType);
}


export class AnthropicEngine extends AiEngine {

    anthropic: Anthropic;

    providerDetails(): AiProviderDetails { return AiProviders.ANTHROPIC; }

    /**
     * @description Create an Anthropic AI Engine to call the Anthropic API for some particular model
     * @param creationOptions object with options for creating the engine
     * @param anthropic object for accessing Anthropic API (dependency injection)
     */
    constructor(creationOptions: AiEngineCreateOptions, anthropic?: Anthropic) {
        //todo maybe validate model string against accepted (i.e. VLM) anthropic model names, which would be stored as static constants in this class?
        super(creationOptions);
        this.anthropic = anthropic ?? new Anthropic({apiKey: this.apiKeys[0]});
    }


    generate = async ({
                          prompts, generationType, imgDataUrl, planningOutput, groundingOutput,
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
            let ssMediaType = "";
            let ssEncodingType = "";
            let ssEncodedBytes = "";
            const dataUrlRegex = /^data:([^;]+);([^,]+),(.*)$/;
            const matches = imgDataUrl.match(dataUrlRegex);
            if (matches && matches.length === 4) {
                ssMediaType = matches[1];
                ssEncodingType = matches[2];
                ssEncodedBytes = matches[3];
            } else { throw new Error("imgDataUrl is not a valid data URL") }

            const anthropicSupportedEncodingTypes = ["base64"]
            if (!(checkImageTypeIsAnthropicSupported(ssMediaType)
                && checkImageEncodingTypeIsAnthropicSupported(ssEncodingType))) {
                throw new Error(`imgDataUrl is not a valid data URL for Anthropic API; its media type is ${ssMediaType} and its encoding type is ${ssEncodingType}, while Anthropic supports media types ${JSON.stringify(anthropicSupportedMediaTypes)} and encoding types ${JSON.stringify(anthropicSupportedEncodingTypes)}`);
            }

            (requestBody.messages[0].content as Array<TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam>)
                .push({type: "image", source: {data: ssEncodedBytes, media_type: ssMediaType, type: ssEncodingType}});
        }

        let respStr: string | undefined;
        if (generationType === GenerateMode.PLANNING) {
            const response = await this.anthropic.messages.create(requestBody);
            respStr = (response.content[0] as TextBlock).text;
        } else if (generationType === GenerateMode.GROUNDING) {
            if (planningOutput === undefined) {
                throw new Error("planning output must be provided for the grounding ai generation");
            } else if (planningOutput.length > 0) {
                requestBody.messages.push({role: "assistant", content: planningOutput});
            } else {
                this.logger.info("LLM MALFUNCTION- planning output was empty string");
            }

            requestBody.tools = [{
                name: "browser_action",
                description: browserActionFuncDesc,
                input_schema: {
                    type: "object",
                    properties: {
                        explanation: {type: ["string"], description: groundingPromptExplanationParamDesc},
                        element: {type: ["string", "null"], description: groundingPromptElementParamDesc},
                        action: {
                            type: ["string"], description: browserActionSchemaActionDesc,
                            enum: Object.keys(Action)
                        },
                        value: {type: ["string", "null"], description: groundingPromptValueParamDesc},
                    },
                    required: browserActionRequiredProps
                }
            }];

            if (planningOutput.includes(AiEngine.ELEMENTLESS_GROUNDING_TRIGGER)) {
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
        } else if (generationType === GenerateMode.AUTO_MONITORING) {
            if (planningOutput === undefined) {
                throw new Error("planning Output must be provided for the auto-monitoring ai generation");
            } else if (planningOutput.length > 0) {
                requestBody.messages.push({role: "assistant", content: planningOutput});
            } else {
                this.logger.info("LLM MALFUNCTION- planning output was empty string");
            }

            requestBody.messages.push({role: "user", content: prompts.autoMonitorPrompt});

            if (groundingOutput === undefined) {
                throw new Error("grounding Output must be provided for the auto-monitoring ai generation");
            } else if (groundingOutput.length > 0) {
                requestBody.messages.push({role: "assistant", content: groundingOutput});
            } else {
                this.logger.info("LLM MALFUNCTION- grounding output was empty string");
            }

            requestBody.tools = [{
                name: "action_judgment",
                description: actionJudgmentFuncDesc,
                input_schema: {
                    type: "object",
                    properties: {
                        severity: {
                            type: ["string"], description: actionJudgmentSeverityParamDesc,
                            enum: Object.keys(ActionStateChangeSeverity)
                        },
                        explanation: {type: ["string"], description: actionJudgmentExplanationParamDesc},
                    },
                    required: actionJudgmentRequiredProps
                }
            }];

            const response = await this.anthropic.messages.create(requestBody);
            if (response.stop_reason === "tool_use") {
                const reasoningBlock = response.content.find((block) => block.type === "text") as TextBlock;
                const toolUseBlock = response.content.find((block) => block.type === "tool_use") as ToolUseBlock;
                const inputsToTool: any = toolUseBlock?.input ?? {explanation: "no input to tool"};
                inputsToTool["reasoning"] = reasoningBlock?.text;
                respStr = JSON.stringify(inputsToTool);
            } else { this.logger.info("PROMPTING_FAILURE- Claude failed to use the 'action_judgment' tool for auto-monitoring step") }
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