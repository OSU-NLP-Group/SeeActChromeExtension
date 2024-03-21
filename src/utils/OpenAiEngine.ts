export class OpenAiEngine {
    static readonly noApiKeyErrMsg = "must pass on the api_key or set OPENAI_API_KEY in the environment";

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
     * @param stop Tokens indicate stop of sequence
     * @param rateLimit Max number of requests per minute
     * @param temperature what temperature to use when sampling from the model
     */
    constructor(model: string, apiKey?: string | Array<string>, stop: string = "\n\n", rateLimit: number = -1,
                temperature: number = 0) {
        let apiKeys: Array<string> = [];
        if (apiKey == undefined) {
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


    //todo write stub for generate method
    //todo unit test the generate method
    //todo implement the generate method to pass unit tests

    //todo run the generate method in modified 'unit' tests a couple times where the openai stuff isn't being mocked

}