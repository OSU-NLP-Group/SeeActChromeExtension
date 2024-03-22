import {OpenAiEngine} from "../../src/utils/OpenAiEngine";
import OpenAI from "openai";
import {Mock, mock} from "ts-jest-mocker";
import {ChatCompletion, CompletionChoice} from "openai/resources";
import {StrTriple} from "../../src/utils/format_prompts";

const exampleModel = "gpt-4-vision-preview";


describe('OpenAiEngine', () => {

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
        const engine = new OpenAiEngine(exampleModel, undefined, undefined, customStopSeq, 0);
        expect(engine.apiKeys).toEqual([process.env.OPENAI_API_KEY]);
        expect(engine.stop).toEqual(customStopSeq);
        expect(engine.requestInterval).toEqual(0);
        expect(engine.nextAvailTime).toEqual([0]);
        delete process.env.OPENAI_API_KEY;
    });

    it('should error if no api key given and none in environment variable', () => {
        expect(() => new OpenAiEngine(exampleModel, [])).toThrow(OpenAiEngine.noApiKeyErrMsg);
    });

    it('should create an OpenAiEngine with multiple api keys', () => {
        const fakeApiKeys = ["key1", "key2"];
        const engine = new OpenAiEngine(exampleModel, fakeApiKeys, undefined, "\n\n", 10, 0.7);
        expect(engine.apiKeys).toEqual(fakeApiKeys);
        expect(engine.requestInterval).toEqual(6);
        expect(engine.nextAvailTime).toEqual([0, 0]);
        expect(engine.temperature).toEqual(0.7);
    });
});


describe('OpenAiEngine.generate', () => {
    const dummyImgDataUrl = "data:image/jpeg;base64,9j4AAQSkZJRgABAQAAAQABAAD2wCEAAkGBxMTEhUTExMWFhUXGBgYGBgYGBgYGBgYGBgYGBgYGBgYHSggGBolGxgXITEhJSkrLi4uGB8zODMtNygtLisBCgoKDg0OGxAQGy0lICY";

    let mockOpenAi: Mock<OpenAI>;
    let mockCompletions: Mock<OpenAI.Chat.Completions>;
    beforeEach(() => {
        jest.resetAllMocks();

        mockOpenAi = mock(OpenAI);
        mockOpenAi.chat = mock(OpenAI.Chat);
        mockCompletions = mock(OpenAI.Chat.Completions);
        mockOpenAi.chat.completions = mockCompletions;

    });


    it('should generate turn 0 and turn 1 completions with 3 keys', () => {
        const dummyApiKeys = ["key1", "key2", "key3"];
        const prompts: StrTriple = ["some sys prompt", "some query prompt", "some referring prompt"];

        const baseTemp = 0.7;
        const engine = new OpenAiEngine(exampleModel, dummyApiKeys, mockOpenAi, "\n\n", -1, baseTemp);

        const t0RespTxt = "turn 0 completion";
        // @ts-expect-error testing, will fail if code starts needing more members of ChatCompletion or CompletionChoice
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {text: t0RespTxt, index: 0, finish_reason: "stop"} as CompletionChoice
            ]
        } as ChatCompletion);

        const expectedReq0Msgs = [
            {role: "system", content: prompts[0]},
            {
                role: "user", content: [{type: "text", text: prompts[1]},
                    {type: "image_url", image_url: {url: dummyImgDataUrl, detail: "high"}}]
            }
        ];

        const req0Temp = 0.1;
        const req0MaxTokens = 8192;
        const result0 = engine.generate(prompts, 0, dummyImgDataUrl, undefined, req0MaxTokens, req0Temp);
        expect(engine.currKeyIdx).toEqual(1);
        expect(engine.nextAvailTime).toEqual([0, 0, 0]);
        expect(mockOpenAi.apiKey).toEqual(dummyApiKeys[0]);
        // @ts-expect-error testing, will fail if create not called
        const request0Body = mockCompletions.create.mock.lastCall[0];
        expect(request0Body.model).toEqual(exampleModel);
        expect(request0Body.temperature).toEqual(req0Temp);
        expect(request0Body.max_tokens).toEqual(req0MaxTokens);
        expect(request0Body.messages).toEqual(expectedReq0Msgs);
        expect(result0).toEqual(t0RespTxt);

        const t1RespTxt = "turn 1 completion";
        // @ts-expect-error testing, will fail if code starts needing more members of ChatCompletion or CompletionChoice
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {text: t1RespTxt, index: 0, finish_reason: "stop"} as CompletionChoice
            ]
        } as ChatCompletion);

        const req1Model = "gpt-4-vision-preview-alt";
        const result1 = engine.generate(prompts, 1, dummyImgDataUrl, t0RespTxt, undefined, undefined, req1Model);
        expect(engine.currKeyIdx).toEqual(2);
        expect(engine.nextAvailTime).toEqual([0, 0, 0]);
        expect(mockOpenAi.apiKey).toEqual(dummyApiKeys[1]);
        //@ts-expect-error testing, will fail if create not called
        const request1Body = mockCompletions.create.mock.lastCall[0];
        expect(request1Body.model).toEqual(req1Model);
        expect(request1Body.temperature).toEqual(baseTemp);
        expect(request1Body.max_tokens).toEqual(4096);
        expect(request1Body.messages).toEqual([
            expectedReq0Msgs[0],
            expectedReq0Msgs[1],
            {role: "assistant", content: t0RespTxt},
            {role: "user", content: prompts[2]}
        ]);

        expect(result1).toEqual(t1RespTxt);
    });


    //todo tests for backoff behavior

    //todo tests for rate limiting sleep behavior

    //todo reminders- need some tests to just use 1 key
    //  need some test to start with index pointing to 3rd key


});
