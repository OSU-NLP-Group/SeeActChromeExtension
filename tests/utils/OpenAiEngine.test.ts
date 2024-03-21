import {OpenAiEngine} from "../../src/utils/OpenAiEngine";

describe('OpenAiEngine', () => {
    const exampleModel = "gpt-4-vision-preview";

    it('should create an OpenAiEngine with a single api key', () => {
        const fakeApiKey = "some api key";
        const engine = new OpenAiEngine(exampleModel, fakeApiKey);
        expect(engine.apiKeys).toEqual([fakeApiKey]);
        expect(engine.model).toEqual(exampleModel);
        expect(engine.stop).toEqual("\n\n");
        expect(engine.temperature).toEqual(0);
        expect(engine.requestInterval).toEqual(0);
        expect(engine.nextAvailTime).toEqual([0]);
        expect(engine.currKeyIdx).toEqual(0);
    });

    it('should create an OpenAiEngine when api key only in environment variable', () => {
        process.env.OPENAI_API_KEY = "some api key";
        const customStopSeq = "---STOP---";
        const engine = new OpenAiEngine(exampleModel, undefined, customStopSeq, 0);
        expect(engine.apiKeys).toEqual([process.env.OPENAI_API_KEY]);
        expect(engine.stop).toEqual(customStopSeq);
        expect(engine.requestInterval).toEqual(0);
        expect(engine.nextAvailTime).toEqual([0]);
        delete process.env.OPENAI_API_KEY;
    });

    it('should error if no api key given and none in environment variable', () => {
        expect(() => new OpenAiEngine(exampleModel)).toThrow(OpenAiEngine.noApiKeyErrMsg);
    });

    it('should create an OpenAiEngine with multiple api keys', () => {
        const fakeApiKeys = ["key1", "key2"];
        const engine = new OpenAiEngine(exampleModel, fakeApiKeys, "\n\n", 10, 0.7);
        expect(engine.apiKeys).toEqual(fakeApiKeys);
        expect(engine.requestInterval).toEqual(6);
        expect(engine.nextAvailTime).toEqual([0, 0]);
        expect(engine.temperature).toEqual(0.7);
    });
});

