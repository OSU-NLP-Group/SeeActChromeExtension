import {
    _processString,
    formatChoices,
    generatePrompt,
    onlineActionFormat,
    onlineElementFormat,
    onlineQuestionDesc,
    onlineReferringPromptDesc,
    onlineSystemPrompt,
    onlineValueFormat,
    postProcessActionLlm,
    StrTriple
} from "../../src/utils/format_prompts";
import {generateNewQueryPrompt, generateNewReferringPrompt, StrPair} from "../../src/utils/format_prompt_utils";


describe('_processString', () => {
    it('should leave a normal string alone', () => {
        const input: string = "some string";
        expect(_processString(input)).toBe(input);
    });
    it('should remove double quotes from start and end of string', () => {
        expect(_processString("\"some string\"")).toBe("some string");
    });
    it('should not remove double quotes from middle of string', () => {
        const input: string = "some \"string\" containing \"-wrapped substring";
        expect(_processString(input)).toBe(input);
    });
    it('should not remove starting double quote if no ending double quote', () => {
        const input: string = "\"some string";
        expect(_processString(input)).toBe(input);
    });
    it('should not remove ending double quote if no starting double quote', () => {
        const input: string = "some string\"";
        expect(_processString(input)).toBe(input);
    });
    it('should remove period from end of string', () => {
        expect(_processString("some string.")).toBe("some string");
    });
    it('should not remove period from middle of string', () => {
        const input: string = "some. string";
        expect(_processString(input)).toBe(input);
    });
    it('should remove period from end of double-quote-wrapped string', () => {
        expect(_processString("\"some string.\"")).toBe("some string");
    });
    it('should remove ending period if starting double quote but no ending double quote', () => {
        expect(_processString("\"some string.")).toBe("\"some string");
    });
    //todo confirm with Boyuan about whether this aspect of existing behavior is desired
    it('should not remove period just before ending double quote if no starting double quote', () => {
        const input: string = "some string.\"";
        expect(_processString(input)).toBe(input);
    });
    //todo confirm with Boyuan about whether this aspect of existing behavior is desired
    it('should remove ending period but not double quotes from string with double quotes around it and period after the ending double quote', () => {
        expect(_processString("\"some string\".")).toBe("\"some string\"");
    });
});

describe('formatChoices', () => {
    it('should throw an error if a candidate index is out of range', () => {
        const elements: Array<StrTriple> = [['aria-label="Google apps"', 'a role="button"', "a"],
            ['title="Share"', "button", "button"]];
        const candidateIds: Array<number> = [0, -1, 2];
        expect(() => formatChoices(elements, candidateIds))
            .toThrowError("out of the candidate id's [0,-1,2], the id's [-1,2] were out of range");
    });
    it("should return a list of pairs of strings, where the first string in each pair is the index of the " +
        "element in the list of choices and the second string is an abbreviated representation of the element's html",
        () => {
            const elements: Array<StrTriple> = [['Gmail', "a", "a"],
                ['title="Share"', "button", "button"],
                ['aria-label="Clear"', 'div role="button"', "div"]];
            const candidateIds: Array<number> = [0, 2];
            expect(formatChoices(elements, candidateIds)).toEqual([["0", '<a id="0">Gmail</a>'],
                ["2", '<div role="button" id="2">aria-label="Clear"</div>']]);
        });

    it("shouldn't truncate the description of a select element with 29 whitespace-separated segments in the description string", () => {
        const hugeSelectDescWith29Segments = 'parent_node: COURSE TYPE Selected Options: Select Course Type - ' +
            'Options: Select Course Type | Juvenile training (422) | Behind-the-Wheel (406) | ' +
            'Three-time fail course (325) | In-person Course (229)';
        const elements: Array<StrTriple> = [['Gmail', "a", "a"],
            [hugeSelectDescWith29Segments, "select", "select"]
        ];
        const candidateIds: Array<number> = [1];
        expect(formatChoices(elements, candidateIds)).toEqual([["1",
            '<select id="1">' + hugeSelectDescWith29Segments + '</select>']]);
    });

    it("shouldn't truncate the description of a select element with 30 whitespace-separated segments in the description string", () => {
        const hugeSelectDescWith30Segments = 'parent_node: COURSE TYPE Selected Options: Select Course Type - ' +
            'Options: Select Course Type | Juvenile training (422) | Behind-the-Wheel (406) | ' +
            'Three-time fail course (325) | In person Course (229)';
        const elements: Array<StrTriple> = [['Gmail', "a", "a"],
            [hugeSelectDescWith30Segments, "select", "select"]
        ];
        const candidateIds: Array<number> = [1];
        expect(formatChoices(elements, candidateIds)).toEqual([["1",
            '<select id="1">' + hugeSelectDescWith30Segments + '</select>']]);
    });


    it("shouldn't truncate the description of a non-select element with 29 whitespace-separated segments in the description string", () => {
        const hugeInputDescWith29Segments = 'input value="Some Search String with an ' +
            'improbable number of words in it in total" parent_node: SEARCH name="keyword" placeholder="Search ' +
            '(by City, Location, Zip Code, Name, County, Township, or School District)"';
        const elements: Array<StrTriple> = [['Gmail', "a", "a"],
            [hugeInputDescWith29Segments, 'input type="text"', 'input']];
        const candidateIds: Array<number> = [0, 1];
        expect(formatChoices(elements, candidateIds)).toEqual([["0", '<a id="0">Gmail</a>'],
            ["1", '<input type="text" id="1">' + hugeInputDescWith29Segments + '</input>']]);
    });

    it("should truncate the description of a non-select element with 30 whitespace-separated segments in the description string", () => {
        const hugeInputDescWith30Segments = 'input value="Some Search String with an ' +
            'improbable number of words in it in total" parent_node: SEARCH name="keyword" placeholder="Search ' +
            '(by City, Location, Zip Code, Name, County, Township, Borough, or School District)"';
        const elements: Array<StrTriple> = [[hugeInputDescWith30Segments, 'input type="text"', 'input']];
        const candidateIds: Array<number> = [0];
        expect(formatChoices(elements, candidateIds)).toEqual([["0", '<input type="text" id="0">input ' +
        'value="Some Search String with an improbable ' +
        'number of words in it in total" parent_node: SEARCH name="keyword" placeholder="Search (by City, ' +
        'Location, Zip Code, Name, County, Township, Borough, or School...</input>']]);
    });
});

describe('postProcessActionLlm', () => {
    it('should extract element name, TYPE action, and value when LLM follows instructions', () => {
        const valueStr = "GPT-4V(ision) is a Generalist Web Agent, if Grounded arXiv";
        expect(postProcessActionLlm("ELEMENT: I\nACTION: TYPE\nVALUE: " + valueStr))
            .toEqual(["I", "TYPE", valueStr]);
    });
    it('should extract element name, SELECT action, and value even when LLM adds junk', () => {
        const optionValue: string = "Three time fail course (325)";
        expect(postProcessActionLlm("The uppercase letter of your choice. Choose one of the following " +
            "elements if it matches the target element based on your analysis:\nELEMENT: AJ" +
            "\nChoose an action from {CLICK, TYPE, SELECT}.ACTION: SELECT\nProvide additional input based on ACTION." +
            "\nVALUE: " + optionValue + "\nother random stuff"))
            .toEqual(["AJ", "SELECT", optionValue]);
    });
    it('should extract non-existent element, TERMINATE action, and no value even when LLM adds junk', () => {
        expect(postProcessActionLlm("The uppercase letter of my choice based on the analysis is "
            + "ELEMENT: not applicable.\nChoose an action from {CLICK, TYPE, SELECT}.\n\nACTION: TERMINATE\nVALUE: None"))
            .toEqual(["Invalid", "TERMINATE", "None"]);
    });

    it('should extract element name, PRESS_ENTER action, and no value even when LLM adds junk', () => {
        expect(postProcessActionLlm("The uppercase letter of your choice based on your analysis is:\n\n"
            + "ELEMENT: BL\nACTION: PRESS_ENTER")).toEqual(["BL", "PRESS_ENTER", ""]);
    });
    it('should extract element name, CLICK action, and no value even when LLM adds junk', () => {
        expect(postProcessActionLlm("The uppercase letter of my choice is:\n"
            + "ELEMENT: JD\nThe correct choice based on the analysis would be:\n" +
            "ACTION: CLICK\nVALUE: None")).toEqual(["JD", "CLICK", "None"]);
    });
    it('should return default values if llm text has nothing relevant', () => {
        expect(postProcessActionLlm("")).toEqual(["Invalid", "None", ""]);
    });
});

describe('generatePrompt', () => {
    it('should produce the system prompt for online activity, a query prompt that reflects the current task ' +
        'and previous actions, and a referring prompt that reflects the current choices', () => {
        const task = "some task";
        const previousActions = ["previous action 1 description", "previous action 2 description",
            "previous action 3 description"];
        const choices: Array<StrPair> = [
            ["0", "<a id=\"0\">Skip to content</a>"],
            ["1", "<a id=\"1\">Skip to navigation</a>"],
            ["5", "button type=\"button\" id=\"5\">Product</button>"]
        ];
        const [expectedSysPrompt, expectedQueryPrompt] = generateNewQueryPrompt(onlineSystemPrompt, task, previousActions, onlineQuestionDesc);
        const expectedReferringPrompt = generateNewReferringPrompt(onlineReferringPromptDesc, onlineElementFormat, onlineActionFormat, onlineValueFormat, choices);

        const [actualSysPrompt, actualQueryPrompt, actualReferringPrompt] = generatePrompt(task, previousActions, choices);
        expect(actualSysPrompt).toEqual(expectedSysPrompt);
        expect(actualQueryPrompt).toEqual(expectedQueryPrompt);
        expect(actualReferringPrompt).toEqual(expectedReferringPrompt);
    });
});
