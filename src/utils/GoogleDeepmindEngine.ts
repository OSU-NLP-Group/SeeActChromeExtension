import {AiEngine} from "./AiEngine";
import {Action, ActionStateChangeSeverity} from "./misc";
import {
    actionJudgmentExplanationParamDesc,
    actionJudgmentFuncDesc, actionJudgmentRequiredProps, actionJudgmentSeverityParamDesc,
    browserActionFuncDesc,
    browserActionRequiredProps,
    browserActionSchemaActionDesc,
    groundingPromptElementParamDesc,
    groundingPromptExplanationParamDesc,
    groundingPromptValueParamDesc
} from "./format_prompts";
import {
    AiEngineCreateOptions,
    AiProviderDetails,
    AiProviders,
    GenerateMode,
    GenerateOptions
} from "./ai_misc";
import {
    FunctionCallingMode,
    GenerateContentRequest,
    GenerateContentResult,
    GoogleGenerativeAI,
    GoogleGenerativeAIFetchError,
    HarmBlockThreshold,
    HarmCategory,
    HarmProbability,
    Part,
    SafetyRating, SchemaType
} from "@google/generative-ai";


export class GoogleDeepmindEngine extends AiEngine {

    googleGenAi: GoogleGenerativeAI;

    providerDetails(): AiProviderDetails { return AiProviders.GOOGLE_DEEPMIND; }

    /**
     * @description Create an Anthropic AI Engine to call the Anthropic API for some particular model
     * @param creationOptions object with options for creating the engine
     * @param googleGenAi object for accessing Google Deepmind API (dependency injection)
     */
    constructor(creationOptions: AiEngineCreateOptions, googleGenAi?: GoogleGenerativeAI) {
        //once multiple models supported, maybe validate model string against accepted (i.e. VLM) google deepmind model names
        super(creationOptions);
        this.googleGenAi = googleGenAi ?? new GoogleGenerativeAI(this.apiKeys[0]);
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
        this.googleGenAi.apiKey = this.apiKeys[this.currKeyIdx];

        const chosenModel = this.googleGenAi.getGenerativeModel({
            model: model,
            systemInstruction: prompts.sysPrompt,
            tools: [{
                functionDeclarations: [{
                    name: "browser_action",
                    description: browserActionFuncDesc,
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            explanation: {
                                type: SchemaType.STRING,
                                description: groundingPromptExplanationParamDesc
                            },
                            element: {
                                type: SchemaType.STRING, nullable: true,
                                description: groundingPromptElementParamDesc
                            },
                            action: {
                                type: SchemaType.STRING,
                                //todo try reenabling this and removing the hacky addition to the description once the
                                // function calling feature is no longer in beta (and so is more likely to actually
                                // follow its API schema)
                                //enum: Object.keys(Action),
                                description: browserActionSchemaActionDesc + `; possible values are: ${Object.keys(Action)
                                    .join(", ")}`
                            },
                            value: {
                                type: SchemaType.STRING, nullable: true,
                                description: groundingPromptValueParamDesc
                            },
                        },
                        required: browserActionRequiredProps
                    }
                }, {
                    name: "action_judgment",
                    description: actionJudgmentFuncDesc,
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            severity: {
                                type: SchemaType.STRING,
                                //todo try reenabling this and removing the hacky addition to the description once the
                                // function calling feature is no longer in beta (and so is more likely to actually
                                // follow its API schema)
                                //enum: Object.keys(ActionStateChangeSeverity),
                                description: actionJudgmentSeverityParamDesc + `; possible values are: ${Object.keys(ActionStateChangeSeverity)
                                    .join(", ")}`

                            },
                            explanation: {
                                type: SchemaType.STRING,
                                description: actionJudgmentExplanationParamDesc
                            }
                        },
                        required: actionJudgmentRequiredProps
                    }
                }]
            }]
        });

        const requestBody: GenerateContentRequest = {
            contents: [
                {role: "user", parts: [{text: prompts.queryPrompt}]}
            ],
            generationConfig: {
                maxOutputTokens: maxNewTokens,
                temperature: temp
            },
            safetySettings: [{
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
            }]
        };
        if (imgDataUrl) {
            let ssMediaType = "";
            let ssEncodedBytes = "";
            const dataUrlRegex = /^data:([^;]+);([^,]+),(.*)$/;
            const matches = imgDataUrl.match(dataUrlRegex);
            if (matches && matches.length === 4) {
                ssMediaType = matches[1];
                ssEncodedBytes = matches[3];
            } else { throw new Error("imgDataUrl is not a valid data URL") }

            (requestBody.contents[0].parts as Part[])
                .push({inlineData: {data: ssEncodedBytes, mimeType: ssMediaType}});
        }

        let respStr: string | undefined;
        if (generationType === GenerateMode.PLANNING) {
            //because google API mandates specifying the tool when model object is being created, but the tool shouldn't
            // be used during the planning step
            requestBody.toolConfig = {functionCallingConfig: {mode: FunctionCallingMode.NONE}};

            //this.logger.debug(`calling google deepmind model for planning with requestBody: ${JSON.stringify(requestBody)}`);
            const result = await chosenModel.generateContent(requestBody);
            this.checkAndLogNegativeGoogleApiResult(result);
            respStr = result.response.text();
        } else if (generationType === GenerateMode.GROUNDING) {
            if (planningOutput === undefined) {
                throw new Error("planning Output must be provided for the grounding ai generation");
            } else if (planningOutput.length > 0) {
                requestBody.contents.push({role: "model", parts: [{text: planningOutput}]});
            } else {
                this.logger.info("LLM MALFUNCTION- planning output was empty string");
            }

            if (planningOutput.includes(AiEngine.ELEMENTLESS_GROUNDING_TRIGGER)) {
                requestBody.contents.push({role: "user", parts: [{text: prompts.elementlessActionPrompt}]});
            } else {
                requestBody.contents.push({role: "user", parts: [{text: prompts.groundingPrompt}]});
            }
            //this.logger.debug(`calling google deepmind model for grounding with requestBody: ${JSON.stringify(requestBody)}`);
            const result = await chosenModel.generateContent(requestBody);
            this.checkAndLogNegativeGoogleApiResult(result);

            const reasoningText = result.response.text();
            const functionUses = result.response.functionCalls() ??
                [{name: "fakeFallbackFunction", args: {explanation: "no input to tool"}}];
            const inputsToTool: any = functionUses[0].args;
            inputsToTool["reasoning"] = reasoningText;
            respStr = JSON.stringify(inputsToTool);
        } else if (generationType === GenerateMode.AUTO_MONITORING) {
            const priorModelOutputs = this.assemblePriorOutputsForAutoMonitoring(planningOutput, groundingOutput);
            requestBody.contents.push({role: "model", parts: [{text: priorModelOutputs}]});
            requestBody.contents.push({role: "user", parts: [{text: prompts.autoMonitorPrompt}]});

            const result = await chosenModel.generateContent(requestBody);
            this.checkAndLogNegativeGoogleApiResult(result);

            const reasoningText = result.response.text();
            const functionUses = result.response.functionCalls() ??
                [{name: "fakeFallbackFunction", args: {explanation: "no input to tool"}}];
            const inputsToTool: any = functionUses[0].args;
            inputsToTool["reasoning"] = reasoningText;
            respStr = JSON.stringify(inputsToTool);
        }
        //todo unit test and implement rate-limit-respecting code if Boyuan confirms it's still desired
        // feedback- low priority for now
        /*
            if self.request_interval > 0:
                self.next_avil_time[self.current_key_idx] = time.time() + self.request_interval
         */

        return respStr ?? `no model output in response from ${this.providerDetails().label} API`;
    }

    /**
     * Provides informative error logging when the google deepmind model returns a negative result
     * This merely log additional details because any subsequent call to result.response.text() or
     * result.response.functionCalls() will throw an error if the result is negative
     * @param result the object returned when calling the google deepmind model
     */
    checkAndLogNegativeGoogleApiResult = (result: GenerateContentResult): void => {
        if (result.response.promptFeedback) {
            this.logger.error(`google deepmind model returned prompt feedback: ${JSON.stringify(result.response.promptFeedback)}`);
        }
        if (result.response.candidates && result.response.candidates[0].safetyRatings) {
            const genCandidate = result.response.candidates[0];
            const safetyRatings = genCandidate.safetyRatings as SafetyRating[];
            if (safetyRatings.map(rating =>
                rating.probability !== HarmProbability.NEGLIGIBLE && rating.probability !== HarmProbability.HARM_PROBABILITY_UNSPECIFIED
            ).includes(true)) {
                this.logger.warn(`google deepmind model returned safety ratings: ${JSON.stringify(safetyRatings)}; finish reason was ${genCandidate.finishReason}; finish message was ${genCandidate.finishMessage}`);
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- override
    checkIfRateLimitError(err: any): boolean {
        return false;//google deepmind library doesn't break its errors into subtypes in a way that would make this easy
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- override
    extractRateLimitErrDetails(err: any): string | null {
        return "no useful details in google deepmind rate limit response message";
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- override
    checkIfNonfatalError(err: any): boolean {
        //google deepmind library doesn't break its errors into subtypes in a way that would make this easy
        return err instanceof GoogleGenerativeAIFetchError && err.status != undefined && err.status >= 500;
    }

}