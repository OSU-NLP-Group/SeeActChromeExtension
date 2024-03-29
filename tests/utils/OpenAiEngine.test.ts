import 'openai/shims/node';
import {OpenAiEngine} from "../../src/utils/OpenAiEngine";
import OpenAI, {AuthenticationError} from "openai";
import {Mock, mock} from "ts-jest-mocker";
import {ChatCompletion} from "openai/resources";
import {StrTriple} from "../../src/utils/format_prompts";
import {APIConnectionError, InternalServerError, RateLimitError} from "openai/error";

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
        expect(() => new OpenAiEngine(exampleModel, [])).toThrow(OpenAiEngine.NO_API_KEY_ERR);
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


const dummyImgDataUrl = "data:image/jpeg;base64,9j4AAQSkZJRgABAQAAAQABAAD2wCEAAkGBxMTEhUTExMWFhUXGBgYGBgYGBgYGBgYGBgYGBgYGBgYHSggGBolGxgXITEhJSkrLi4uGB8zODMtNygtLisBCgoKDg0OGxAQGy0lICY";

describe('OpenAiEngine.generate', () => {

    let mockOpenAi: Mock<OpenAI>;
    let mockCompletions: Mock<OpenAI.Chat.Completions>;
    beforeEach(() => {
        jest.resetAllMocks();

        mockOpenAi = mock(OpenAI);
        mockOpenAi.chat = mock(OpenAI.Chat);
        mockCompletions = mock(OpenAI.Chat.Completions);
        mockOpenAi.chat.completions = mockCompletions;

    });


    it('should generate turn 0 and turn 1 completions with 3 keys', async () => {
        const dummyApiKeys = ["key1", "key2", "key3"];
        const prompts: StrTriple = ["some sys prompt", "some query prompt", "some referring prompt"];

        const baseTemp = 0.7;
        const engine = new OpenAiEngine(exampleModel, dummyApiKeys, mockOpenAi, "\n\n", -1, baseTemp);

        const t0RespTxt = "turn 0 completion";
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {message: {content: t0RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
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
        const result0 = await engine.generate(prompts, 0, dummyImgDataUrl, undefined, req0MaxTokens, req0Temp);
        expect(engine.currKeyIdx).toEqual(1);
        expect(engine.nextAvailTime).toEqual([0, 0, 0]);
        expect(mockOpenAi.apiKey).toEqual(dummyApiKeys[1]);
        // @ts-expect-error testing, will fail if create not called
        const request0Body = mockCompletions.create.mock.lastCall[0];
        expect(request0Body.model).toEqual(exampleModel);
        expect(request0Body.temperature).toEqual(req0Temp);
        expect(request0Body.max_tokens).toEqual(req0MaxTokens);
        expect(request0Body.messages).toEqual(expectedReq0Msgs);
        expect(result0).toEqual(t0RespTxt);

        const t1RespTxt = "turn 1 completion";
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {message: {content: t1RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
            ]
        } as ChatCompletion);

        const req1Model = "gpt-4-vision-preview-alt";
        const result1 = await engine.generate(prompts, 1, dummyImgDataUrl, t0RespTxt, undefined, undefined, req1Model);
        expect(engine.currKeyIdx).toEqual(2);
        expect(engine.nextAvailTime).toEqual([0, 0, 0]);
        expect(mockOpenAi.apiKey).toEqual(dummyApiKeys[2]);
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

    it('should error if given no previous turn input for turn 1', async () => {
        await expect(() => new OpenAiEngine(exampleModel, "key1")
            .generate(["sys", "query", "referring"], 1, dummyImgDataUrl)).rejects
            .toThrow("priorTurnOutput must be provided for turn 1")
    });


    //todo (low priority) tests for rate limiting sleep behavior
});

describe('OpenAiEngine.generateWithRetry', () => {

    const prompts: StrTriple = ["some sys prompt", "some query prompt", "some referring prompt"];

    let mockOpenAi: Mock<OpenAI>;
    let mockCompletions: Mock<OpenAI.Chat.Completions>;
    beforeEach(() => {
        jest.resetAllMocks();

        mockOpenAi = mock(OpenAI);
        mockOpenAi.chat = mock(OpenAI.Chat);
        mockCompletions = mock(OpenAI.Chat.Completions);
        mockOpenAi.chat.completions = mockCompletions;

    });

    //this is also serving as a basic test of the key wrap-around scenario in generate()
    it('should succeed immediately if no api problems', async () => {
        const apiKeys = ["key1", "key2"];

        const engine = new OpenAiEngine(exampleModel, apiKeys, mockOpenAi, undefined, -1, undefined);

        const t0RespTxt = "turn 0 completion";
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {message: {content: t0RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
            ]
        } as ChatCompletion);

        const increasedBaseBackoffDelay = 500;

        const req0Start = Date.now();
        const result0 = await engine.generateWithRetry(prompts, 0, dummyImgDataUrl,
            undefined, undefined, undefined, undefined, increasedBaseBackoffDelay);
        const req0Time = Date.now() - req0Start;
        expect(req0Time).toBeLessThan(increasedBaseBackoffDelay);
        expect(result0).toEqual(t0RespTxt);
        expect(mockOpenAi.apiKey).toEqual(apiKeys[1]);
        expect(engine.currKeyIdx).toEqual(1);

        const t1RespTxt = "turn 1 completion";
        mockCompletions.create.mockResolvedValueOnce({
            choices: [
                {message: {content: t1RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
            ]
        } as ChatCompletion);

        const req1Start = Date.now();
        const result1 = await engine.generateWithRetry(prompts, 1, dummyImgDataUrl, t0RespTxt);
        const req1Time = Date.now() - req1Start;
        expect(req1Time).toBeLessThan(increasedBaseBackoffDelay);
        expect(result1).toEqual(t1RespTxt);
        expect(mockOpenAi.apiKey).toEqual(apiKeys[0]);
        expect(engine.currKeyIdx).toEqual(0);
    });

    //this is also serving as a basic test of the single key scenario in generate()
    it('should do exponential backoff and succeed despite 3 or 5 failures', async () => {
        const soleApiKey = "key1";
        const engine = new OpenAiEngine(exampleModel, soleApiKey, mockOpenAi);

        const t0RespTxt = "turn 0 completion";
        mockCompletions.create.mockImplementationOnce(() => {
            throw new APIConnectionError({message: "some error message"});
        })
            .mockImplementationOnce(() => {
                throw new RateLimitError(429, undefined, "some error message", undefined);
            })
            .mockImplementationOnce(() => {
                throw new InternalServerError(500, undefined, "some error message", undefined);
            })
            .mockResolvedValueOnce({
                choices: [
                    {message: {content: t0RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
                ]
            } as ChatCompletion);

        const req0Start = Date.now();
        const result0 = await engine.generateWithRetry(prompts, 0, dummyImgDataUrl, undefined);
        const req0Time = Date.now() - req0Start;
        expect(req0Time).toBeGreaterThan(100 + 200 + 400);
        expect(req0Time).toBeLessThan(100 + 200 + 400 + 800);
        expect(result0).toEqual(t0RespTxt);
        expect(mockOpenAi.apiKey).toEqual(soleApiKey);
        expect(engine.currKeyIdx).toEqual(0);

        const t1RespTxt = "turn 1 completion";
        mockCompletions.create.mockImplementationOnce(() => {
            throw new APIConnectionError({message: "some error message"});
        })
            .mockImplementationOnce(() => {
                throw new RateLimitError(429, undefined, "some error message", undefined);
            })
            .mockImplementationOnce(() => {
                throw new RateLimitError(429, undefined, "some error message", undefined);
            })
            .mockImplementationOnce(() => {
                throw new InternalServerError(500, undefined, "some error message", undefined);
            })
            .mockImplementationOnce(() => {
                throw new RateLimitError(429, undefined, "some error message", undefined);
            })
            .mockResolvedValueOnce({
                choices: [
                    {message: {content: t1RespTxt}, index: 0, finish_reason: "stop"} as ChatCompletion.Choice
                ]
            } as ChatCompletion);

        const req1Start = Date.now();
        const result1 = await engine.generateWithRetry(prompts, 1, dummyImgDataUrl, t0RespTxt);
        const req1Time = Date.now() - req1Start;
        expect(req1Time).toBeGreaterThan(100 + 200 + 400 + 800 + 1600);
        expect(req1Time).toBeLessThan(100 + 200 + 400 + 800 + 1600 + 3200);
        expect(result1).toEqual(t1RespTxt);
        expect(mockOpenAi.apiKey).toEqual(soleApiKey);
        expect(engine.currKeyIdx).toEqual(0);


    }, 30_000);

    it('should fail if maxTries exceeded', async () => {
        const soleApiKey = "key1";
        const engine = new OpenAiEngine(exampleModel, soleApiKey, mockOpenAi);

        const finalError = new InternalServerError(500, undefined, "some error message3", undefined);
        mockCompletions.create.mockImplementationOnce(() => {
            throw new APIConnectionError({message: "some error message1"});
        })
            .mockImplementationOnce(() => {
                throw new RateLimitError(429, undefined, "some error message2", undefined);
            })
            .mockImplementationOnce(() => {
                throw finalError;
            });
        await expect(async () => {
            await engine.generateWithRetry(prompts, 0, dummyImgDataUrl, undefined, undefined, undefined, undefined, undefined, 3)
        }).rejects.toThrow(finalError);
    });

    it('should fail if non-backoff-able error', async () => {
        const soleApiKey = "key1";
        const engine = new OpenAiEngine(exampleModel, soleApiKey, mockOpenAi);

        const authenticationError = new AuthenticationError(401, undefined, "some error message", undefined);
        mockCompletions.create.mockImplementationOnce(() => {
            throw authenticationError;
        })

        const increasedBaseBackoffDelay = 500;
        const start = Date.now();
        await expect(async () => {
            await engine.generateWithRetry(prompts, 0, dummyImgDataUrl, undefined,
                undefined, undefined, undefined, increasedBaseBackoffDelay)
        })
            .rejects.toThrow(authenticationError);
        const time = Date.now() - start;
        expect(time).toBeLessThan(increasedBaseBackoffDelay);
    });

})