import {
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
        const [sysRole, queryText] = generateNewQueryPrompt(sysPrompt, task, [],
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
