import {
    _formatOptions,
    _generateOptionName,
    basicPromptIntro,
    generateNewQueryPrompt,
    generateNewReferringPrompt,
    getIndexFromOptionName,
    noPrevActions,
    prevActionsIntro,
    StrPair
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
    it('should throw an error for index 702', () => {
        expect(() => _generateOptionName(25 + 26 * 26 + 1)).toThrow();
    });
});

describe('_formatOptions', () => {
    it('should return a string containing a none of the above option if given an empty array', () => {
        const emptyChoices: Array<StrPair> = [];
        const resultStr = _formatOptions(emptyChoices);
        expect(resultStr).toContain('If none of these elements match your target element, '
            + 'please select A. None of the other options match the correct element.\n'
            + 'A. None of the other options match the correct element');
    });
    it('should return a string containing the options and a none of the above option if given a non-empty array', () => {
        const realChoices: Array<StrPair> = [
            ["0", "<a id=\"0\">Skip to content</a>"],
            ["1", "<a id=\"1\">Skip to navigation</a>"],
            ["5", "button type=\"button\" id=\"5\">Product</button>"]
        ];
        const resultStr = _formatOptions(realChoices);
        const expectedHeader = 'If none of these elements match your target element, '
            + 'please select D. None of the other options match the correct element.\n';
        const expectedOptionA = 'A. <a id="0">Skip to content</a>\n';
        const expectedOptionB = 'B. <a id="1">Skip to navigation</a>\n';
        const expectedOptionC = 'C. button type="button" id="5">Product</button>\n';
        const expectedOptionD = 'D. None of the other options match the correct element';
        expect(resultStr).toContain(expectedHeader)
        expect(resultStr).toContain(expectedOptionA);
        expect(resultStr.indexOf(expectedHeader)).toBeLessThan(resultStr.indexOf(expectedOptionA));
        expect(resultStr).toContain(expectedOptionB);
        expect(resultStr.indexOf(expectedOptionA)).toBeLessThan(resultStr.indexOf(expectedOptionB));
        expect(resultStr).toContain(expectedOptionC);
        expect(resultStr.indexOf(expectedOptionB)).toBeLessThan(resultStr.indexOf(expectedOptionC));
        expect(resultStr).toContain(expectedOptionD);
        expect(resultStr.indexOf(expectedOptionC)).toBeLessThan(resultStr.lastIndexOf(expectedOptionD));
    });

});

describe('generateNewReferringPrompt', () => {
    it('should return proper referring prompt if all valid provided', () => {
        const referringDescription: string = "some referring description";
        const elementFormat: string = "some element format";
        const actionFormat: string = "some action format";
        const valueFormat: string = "some value format";
        const choices: Array<StrPair> = [
            ["0", "<a id=\"0\">Skip to content</a>"],
            ["1", "<a id=\"1\">Skip to navigation</a>"],
            ["5", "button type=\"button\" id=\"5\">Product</button>"]
        ];
        const expectedOptionsStr = _formatOptions(choices);
        const expectedPrompt = referringDescription + "\n\n" +
            expectedOptionsStr +
            elementFormat + "\n\n" +
            actionFormat + "\n\n" +
            valueFormat;
        expect(generateNewReferringPrompt(
            referringDescription, elementFormat, actionFormat, valueFormat, choices)).toBe(expectedPrompt);
    });
});

describe('getIndexFromOptionName', () => {
    it('should return 0 for "A"', () => {
        expect(getIndexFromOptionName("A")).toBe(0);
    });
    it('should return 25 for "Z"', () => {
        expect(getIndexFromOptionName("Z")).toBe(25);
    });
    it('should return 26 for "AA"', () => {
        expect(getIndexFromOptionName("AA")).toBe(26);
    });
    it('should return 51 for "AZ"', () => {
        expect(getIndexFromOptionName("AZ")).toBe(51);
    });
    it('should return 52 for "BA"', () => {
        expect(getIndexFromOptionName("BA")).toBe(52);
    });
    it('should return 77 for "BZ"', () => {
        expect(getIndexFromOptionName("BZ")).toBe(77);
    });
    it('should return 701 for "ZZ"', () => {
        expect(getIndexFromOptionName("ZZ")).toBe(701);
    });
    it('should return undefined for "AAA"', () => {
        expect(getIndexFromOptionName("AAA")).toBe(undefined);
    });
    it('should return undefined for ""', () => {
        expect(getIndexFromOptionName("")).toBe(undefined);
    });
    it('should return undefined for "A!"', () => {
        expect(getIndexFromOptionName("A!")).toBe(undefined);
    });
});