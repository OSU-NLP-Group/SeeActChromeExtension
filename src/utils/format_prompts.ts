import {_formatOptions, generateNewQueryPrompt} from "./format_prompt_utils";
import {Action} from "./misc";
import Ajv, {JTDSchemaType} from "ajv/dist/jtd"



export interface GroundingResponse {
    reasoning: string;
    explanation: string;
    element?: string;
    action: Action;
    value?: string;
}
export const groundingResponseJsonSchema: JTDSchemaType<GroundingResponse> = {
    properties: {
        reasoning: {type: "string"},
        explanation: {type: "string"},
        action: {
            enum: Object.values(Action)
        },
    }, optionalProperties: {
        element: {type: "string"},
        value: {type: "string"}
    }
};
const ajv = new Ajv();
export const groundingRespParser = ajv.compileParser(groundingResponseJsonSchema);

/**
 * Only exported for use in whitebox-type unit tests. Do not reference in application code outside this module.
 * @description clean some prefixes/suffixes from a string
 * @param input the string to be processed
 * @return the processed string
 */
export const _processString = (input: string): string => {
    if (input.startsWith('"') && input.endsWith('"')) {
        input = input.slice(1, -1);
    }
    if (input.endsWith(".")) {
        input = input.slice(0, -1);
    }

    return input;
}

export type StrTriple = [string, string, string];

export interface LmmPrompts {
    sysPrompt: string;
    queryPrompt: string;
    groundingPrompt: string;
    elementlessActionPrompt: string;
}

/**
 * @description format a list of choices for elements that might be interacted with
 * Note - relative to the original method format_choices() in src/format_prompt.py, the entries in the argument elements
 * have been simplified to just 3 strings because the original method didn't use the 0/3/4-index parts of each
 * 6-part entry in its elements argument
 * @param elements 3 pieces of information for each of the possibly interactable elements
 *                  0th piece is string containing a description of the element,
 *                  1st piece is string containing the element's tag name and potentially its role and/or type attributes
 *                  2nd piece is string containing just the element's tag name
 * @param candidateIds the indices of the elements to be included in the formatted list
 * @return an array of strings, where each string is an abbreviated version of the element's html
 *          (abbreviated start tag, some description, and end tag)
 */
export const formatChoices = (elements: Array<StrTriple>, candidateIds: Array<number>): Array<string> => {
    const badCandidateIds = candidateIds.filter((id) => id < 0 || id >= elements.length);
    if (badCandidateIds.length > 0) {
        throw new Error(`out of the candidate id's [${candidateIds}], the id's [${badCandidateIds}] were out of range`);
    }

    //todo idea- get viewport dimensions here; meanwhile, modify formatChoices' elements argument
    // to include element's centercoords and then here we can normalize that to be fractions of viewport dimensions
    // Boyu feedback - might be worthwhile

    //todo can we maybe also filter out elements which aren't in viewport? or mark them as not being visible?

    return candidateIds.map((id) => {
        const [description, tagAndRoleType, tagName] = elements[id];

        let possiblyAbbrevDesc = description;
        const descriptionSplit: Array<string> = description.split(/\s+/);
        if ("select" !== tagName && descriptionSplit.length >= 30) {
            possiblyAbbrevDesc = descriptionSplit.slice(0, 29).join(" ") + "...";
        }
        return `<${tagAndRoleType} id="${id}">${possiblyAbbrevDesc}</${tagName}>`;
    });
}

//todo ask Boyuan about changing system prompt to stop referring to playwright
// Boyu feedback - still need to include up-to-date information explaining exactly what the different action names mean
//todo figure out how to write appropriate new detailed explanation for click/type/select/press-enter options
export const onlineSystemPrompt = "Imagine that you are imitating humans doing web navigation for a task step by step. At each stage, you can see the webpage like humans by a screenshot and know the previous actions before the current step decided by yourself through recorded history. You need to decide on the first following action to take. You can click on an element with the mouse, select an option, type text, press Enter with the keyboard, scroll up by 3/4 of the current viewport height, scroll down by 3/4 of the current viewport height, or hover over an element. One next step means one operation within the 6. Unlike humans, for typing (e.g., in text areas, text boxes) and selecting (e.g., from dropdown menus or <select> elements), you should try directly typing the input or selecting the choice, bypassing the need for an initial click. You should not attempt to create accounts, log in or do the final submission. Terminate when you deem the task complete or if it requires potentially harmful actions.";

//note - the model seems terrible at noticing that a previous attempted action didn't do what it was supposed to.
// is it worth fiddling with the prompt to encourage that sort of critical reflection?
export const onlineQuestionDesc = `The screenshot below shows the webpage you see. Follow the following guidance to think step by step before outlining the next action step at the current stage:

(Current Webpage Identification)
Firstly, think about what the current webpage is.

(Previous Action Analysis)
Secondly, combined with the screenshot, analyze each step of the previous action history and their intention one by one. Particularly, pay more attention to the last step, which may be more related to what you should do now as the next step. Specifically, if the last action involved a TYPE, always evaluate whether it necessitates a confirmation step, because typically a single TYPE action does not make effect. (often, simply pressing 'Enter', assuming the default element involved in the last action, unless other clear elements are present for operation).

(Screenshot Details Analysis)
Closely examine the screenshot to check the status of every part of the webpage to understand what you can operate with and what has been set or completed. You should closely examine the screenshot details to see what steps have been completed by previous actions even though you are given the textual previous actions. Because the textual history may not clearly and sufficiently record some effects of previous actions, you should closely evaluate the status of every part of the webpage to understand what you have done.

(Next Action Based on Webpage and Analysis)
Then, based on your analysis, in conjunction with human web browsing habits and the logic of web design, decide on the following action. And clearly outline which element in the webpage users will operate with as the first next target element, its detailed location, and the corresponding operation.

To be successful, it is important to follow the following rules: 
1. You should only issue a valid action given the current observation. 
2. You should only issue one action at a time
3. For handling the select dropdown elements on the webpage, it's not necessary for you to provide completely accurate options right now. The full list of options for these elements will be supplied later.

Sometimes the action won't require a target element: SCROLL_UP, SCROLL_DOWN, TERMINATE, or NONE; PRESS_ENTER also qualifies if your last action was TYPE.
In such a case, it is important that you include the exact string SKIP_ELEMENT_SELECTION in your planning output. DO NOT include it if you want to do something else first (e.g. TYPE before PRESS_ENTER).`;
//todo ask Boyuan about changing the action space- it keeps getting confused or doing things wrong related to the
// sequence "TYPE on one step then PRESS ENTER on next step"; why don't we just make 2 actions TYPE and TYPE_THEN_ENTER?
// and get rid of the PRESS_ENTER stand-alone action unless/until it becomes clear that it's needed?

export const onlineReferringPromptDesc = `(Reiteration)
First, reiterate your next target element, its detailed location, and the corresponding operation.

(Multichoice Question)
Below is a multi-choice question, where the choices are elements in the webpage. All elements are arranged in the order based on their height on the webpage, from top to bottom (and from left to right). This arrangement can be used to locate them. From the screenshot, find out where and what each one is on the webpage, taking into account both their text content and HTML details. Then, determine whether one matches your target element. Please examine the choices one by one. Choose the matching one. If multiple options match your answer, choose the most likely one by re-examining the screenshot, the choices, and your further reasoning. 
Note that a search bar might initially show up in html as a button which must be clicked to make the actual search bar available`;//todo confirm with Boyuan about whether this addition at the end is worth keeping or too specific to github.com
export const groundingOutputPromptIntro = `(Response Format)
Please present your output in JSON format, following the type definition below. When a key ("value" or sometimes even "element") is irrelevant for the current response, use the json syntax for null`;

export const groundingOutputPromptGeneralExplanation = `The parts of the JSON type definition are explained below
Generally-applicable response components:
- reasoning: Perform all reasoning (as guided by the above prompt) in this string.
- explanation: Provide a 1-sentence explanation of the action you are performing and what purpose it serves.`;
export const groundingOutputPromptExplanation = `
Response components for actions that might target an element:
- element: The uppercase letter of your chosen element. (Not needed for PRESS_ENTER, SCROLL_UP, or SCROLL_DOWN)
- action: Choose an action from {CLICK, SELECT, TYPE, PRESS_ENTER, SCROLL_UP, SCROLL_DOWN, HOVER, TERMINATE, NONE}.
- value: Provide additional input based on action. The value means:
    - If action == TYPE, specify the text to be typed.
    - If action == SELECT, indicate the option to be chosen. Revise the selection value to align with the available options within the element.
    - If action == CLICK, PRESS_ENTER, SCROLL_UP, SCROLL_DOWN, TERMINATE or NONE, set this to null.`;
export const groundingElementlessActionPromptExplanation = `
Based on your prior planning, the next action is not specific to an element.
Response component for actions that will not target an element:
- action: Choose an action from {SCROLL_UP, SCROLL_DOWN, PRESS_ENTER, TERMINATE, NONE}.`;

/**
 * @description generate the prompts for the web agent for the current step of the task
 * This was originally in src/prompts.py, but I put it here because almost everything from prompts.py was irrelevant
 * for the plugin
 * @param task the overall task which is being worked on
 * @param previousActions brief records of the previous actions taken by the web agent
 * @param choices describes the elements which might be interacted with; each entry in the top-level list is a length-2
 *                 list, with the first entry being the string version of the choice's index and the second entry
 *                 being an abbreviated version of the element's html
 * @return four prompts for the language model: 1) a system prompt (used with both of the other prompts);
 *          2) a prompt for the model planning its next step; and
 *          3) a prompt for the model identifying the element to interact with and how to interact with it
 *          4) a prompt for the model to choose an action when there is no specific element to interact with
 */
export const generatePrompt = (task: string, previousActions: Array<string>, choices: Array<string>): LmmPrompts => {
    const [sysPrompt, queryPrompt] = generateNewQueryPrompt(onlineSystemPrompt, task, previousActions, onlineQuestionDesc);
    let groundingPrompt: string = onlineReferringPromptDesc + "\n\n";
    if (choices) {
        groundingPrompt += _formatOptions(choices);
    }
    //todo check whether stringifying the schema is the right way to include it in the prompt
    groundingPrompt += groundingOutputPromptIntro + "\n" + JSON.stringify(groundingResponseJsonSchema) + "\n" + groundingOutputPromptGeneralExplanation + "\n" + groundingOutputPromptExplanation;

    return {
        sysPrompt: sysPrompt, queryPrompt: queryPrompt, groundingPrompt: groundingPrompt,
        elementlessActionPrompt: groundingOutputPromptIntro + "\n" + JSON.stringify(groundingResponseJsonSchema) + "\n" + groundingElementlessActionPromptExplanation
    };
}

