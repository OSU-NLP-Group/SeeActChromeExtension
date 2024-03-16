import {
    _generateOptionName,
    basicPromptIntro,
    generateNewQueryPrompt,
    noPrevActions,
    prevActionsIntro
} from "../../src/utils/format_prompt_utils";


describe('generateNewQueryPrompt', () => {
    it('should return proper query prompt when no prior actions', () => {
        const sysPrompt: string = "some sys prompt string";
        const task: string = "some task string";
        const questionDesc: string = "some question desc string";

        const [sysRole, queryText] = generateNewQueryPrompt(sysPrompt, task, [],
            questionDesc);
        expect(sysRole).toContain(sysPrompt);

        expect(queryText).toContain(basicPromptIntro);
        expect(queryText).toContain(task);
        expect(queryText.indexOf(basicPromptIntro)).toBeLessThan(queryText.indexOf(task));
        expect(queryText).toContain(prevActionsIntro);
        expect(queryText.indexOf(task)).toBeLessThan(queryText.indexOf(prevActionsIntro));
        expect(queryText).toContain(noPrevActions);
        expect(queryText.indexOf(prevActionsIntro)).toBeLessThan(queryText.indexOf(noPrevActions));
        expect(queryText).toContain(questionDesc);
        expect(queryText.indexOf(noPrevActions)).toBeLessThan(queryText.indexOf(questionDesc));
    });

    it('should return proper query prompt when prior actions', () => {
        const sysPrompt: string = "some sys prompt string";
        const task: string = "some task string";
        const prevActions: Array<string> = ["action 1", "action 2", "action 3"];
        const questionDesc: string = "some question desc string";

        const expectedPrevActionsStr: string = prevActions.join("\n");
        const [sysRole, queryText] = generateNewQueryPrompt(sysPrompt, task, prevActions,
            questionDesc);
        expect(sysRole).toContain(sysPrompt);

        expect(queryText).toContain(basicPromptIntro);
        expect(queryText).toContain(task);
        expect(queryText.indexOf(basicPromptIntro)).toBeLessThan(queryText.indexOf(task));
        expect(queryText).toContain(prevActionsIntro);
        expect(queryText.indexOf(task)).toBeLessThan(queryText.indexOf(prevActionsIntro));
        expect(queryText).toContain(expectedPrevActionsStr);
        expect(queryText.indexOf(prevActionsIntro)).toBeLessThan(queryText.indexOf(expectedPrevActionsStr));
        expect(queryText).toContain(questionDesc);
        expect(queryText.indexOf(expectedPrevActionsStr)).toBeLessThan(queryText.indexOf(questionDesc));
    });
});

describe('_generateOptionName', () => {
    it('should return "A" for index 0', () => {
        expect(_generateOptionName(0)).toBe("A");
    });
    it('should return "P" for index 15', () => {
        expect(_generateOptionName(15)).toBe("P");
    });
    it('should return "Z" for index 25', () => {
        expect(_generateOptionName(25)).toBe("Z");
    });
    it('should return "AA" for index 26', () => {
        expect(_generateOptionName(25 + 1)).toBe("AA");
    });
    it('should return "AL" for index 37', () => {
        expect(_generateOptionName(25 + 12)).toBe("AL");
    });
    it('should return "AZ" for index 51', () => {
        expect(_generateOptionName(25 + 26)).toBe("AZ");
    });
    it('should return "BA" for index 52', () => {
        expect(_generateOptionName(25 + 26 + 1)).toBe("BA");
    });
    it('should return "BF" for index 57', () => {
        expect(_generateOptionName(25 + 26 + 6)).toBe("BF");
    });
    it('should return "BZ" for index 77', () => {
        expect(_generateOptionName(25 + 2 * 26)).toBe("BZ");
    });
    it('should return "ZA" for index 677', () => {
        expect(_generateOptionName(25 + 25 * 26 + 1)).toBe("ZA");
    });
    it('should return "ZQ" for index 692', () => {
        expect(_generateOptionName(25 + 25 * 26 + 17)).toBe("ZQ");
    });
    it('should return "ZZ" for index 701', () => {
        expect(_generateOptionName(25 + 26 * 26)).toBe("ZZ");
    });
});
