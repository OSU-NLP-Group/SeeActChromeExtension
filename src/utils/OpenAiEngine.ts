class OpenAiEngine {
    apiKeys: Array<string>;
    stop: string;
    model: string;
    temperature: number;

    requestInterval: number;
    nextAvailTime: Array<number>;
    currKeyIdx: number;

    //todo unit test
    /**
     * @description todo
     * @param apiKey todo
     * @param stop todo
     * @param rateLimit todo
     * @param model todo
     * @param temperature todo
     */
    constructor(apiKey: string | Array<string> | null, stop: string = "\n\n", rateLimit: number = -1,
                model: string, temperature: number = 0) {
        let apiKeys: Array<string> = [];
        if (apiKey === undefined || apiKey === null) {
            const envApiKey = process.env.OPENAI_API_KEY;
            if (envApiKey === undefined || envApiKey === null) {
                throw new Error("must pass on the api_key or set OPENAI_API_KEY in the environment");
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

        //todo calculate requestInterval from rateLimit
        this.requestInterval = -1000;

        this.nextAvailTime = new Array<number>(this.apiKeys.length).fill(0);
        this.currKeyIdx = 0;
    }


    //todo write stub for generate method
    //todo unit test the generate method
    //todo implement the generate method to pass unit tests

    //todo run the generate method in modified 'unit' tests a couple times where the openai stuff isn't being mocked

}