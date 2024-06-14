import {_formatOptions, generateNewQueryPrompt} from "./format_prompt_utils";
import {Action, ViewportDetails} from "./misc";
import {SerializableElementData} from "./BrowserHelper";


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
 * @param elements information about the elements which might be interacted with
 * @param candidateIds the indices of the elements to be included in the formatted list
 * @param viewportInfo information about the viewport and about the dimensions of the page that it shows part of
 * @return an array of strings, where each string is an abbreviated version of the element's html
 *          (abbreviated start tag, some description, and end tag)
 */
export const formatChoices = (elements: Array<SerializableElementData>, candidateIds: Array<number>,
                              viewportInfo: ViewportDetails): Array<string> => {
    const badCandidateIds = candidateIds.filter((id) => id < 0 || id >= elements.length);
    if (badCandidateIds.length > 0) {
        throw new Error(`out of the candidate id's [${candidateIds}], the id's [${badCandidateIds}] were out of range`);
    }

    return candidateIds.map((id) => {
        const description = elements[id].description;
        const tagAndRoleType = elements[id].tagHead;
        const tagName = elements[id].tagName;

        const relElemWidth = 100*elements[id].width / viewportInfo.width;
        const relElemHeight = 100*elements[id].height / viewportInfo.height;
        const relElemX = 100*elements[id].centerCoords[0] / viewportInfo.width;
        const relElemY = 100*elements[id].centerCoords[1] / viewportInfo.height;

        let positionInfo: string;
        let sizeInfo = "";
        if (relElemY < 0) {
            positionInfo = "ABOVE viewport";
        } else if (relElemY > 100) {
            positionInfo = "BELOW viewport";
        } else if (relElemX < 0) {
            positionInfo = "LEFT of viewport";
        } else if (relElemX > 100) {
            positionInfo = "RIGHT of viewport";
        } else {
            positionInfo = `Position: ${relElemX.toFixed(1)}% from left, ${relElemY.toFixed(1)}% from top`;
            sizeInfo = `Size: ${relElemWidth.toFixed(1)}% x ${relElemHeight.toFixed(1)}%; `;
        }

        let possiblyAbbrevDesc = description;
        const descriptionSplit: Array<string> = description.split(/\s+/);
        if ("select" !== tagName && descriptionSplit.length >= 30) {
            possiblyAbbrevDesc = descriptionSplit.slice(0, 29).join(" ") + "...";
        }

        return `${positionInfo}; ${sizeInfo}Element: <${tagAndRoleType} id="${id}">${possiblyAbbrevDesc}</${tagName}>`;
    });
}

/**
 * @description processes the output of the LLM and isolates a) the alphabetic name of the element which should be
 * interacted with, b) the action which should be performed on that element, optionally c) the text value
 * which should be used in that action, and d) a 1-sentence explanation of the action
 * @param llmText the output of the LLM when asked what element should be interacted with and how
 * @return a 4-tuple of strings, where the first string is the alphabetic name of the element which should be
 *          interacted with, the second string is the action which should be performed on that element, the
 *          third string is the text value (empty string if no value was available), and the fourth string is a
 *          1-sentence explanation of the nature and purpose of the action
 */
export const postProcessActionLlm = (llmText: string): [string|undefined, Action, string|undefined, string] => {
    let explanation = "";
    let elementChoice: string|undefined;
    let actionChoice: Action = Action.NONE;
    let valueChoice: string|undefined;

    let llmRespObj: any|undefined;
    try {
         llmRespObj = JSON.parse(llmText);
    } catch (e) {
        console.error(`Invalid JSON response from the model (which shouldn't be possible per OpenAI API docs): [<${llmText}>] with error ${e}`);
        explanation= "doing nothing because model didn't produce valid json";
    }
    //maybe should later add validation logic to confirm that the values being pulled from the json object are all strings
    if (llmRespObj !== undefined) {
        if (llmRespObj.explanation !== undefined) {
            explanation = llmRespObj.explanation;
        }
        if (llmRespObj.element !== undefined && llmRespObj.element !== null) {
            elementChoice = llmRespObj.element;
        }
        if (llmRespObj.action !== undefined) {
            actionChoice = llmRespObj.action;
        }
        if (llmRespObj.value !== undefined && llmRespObj.value !== null) {
            valueChoice = llmRespObj.value;
        }
    }

    return [elementChoice, actionChoice, valueChoice, explanation];
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

//todo update below prompt once formatted choices have been enriched with info about relative coordinates of elements within vs above/below the viewport
export const onlineReferringPromptDesc = `(Reiteration)
First, reiterate your next target element, its detailed location, and the corresponding operation.

(Multichoice Question)
Below is a multi-choice question, where the choices are elements in the webpage. All elements are arranged in the order based on their height on the webpage, from top to bottom (and from left to right). This arrangement can be used to locate them. 
From the screenshot, find out where and what each one is on the webpage, taking into account both their text content and HTML details. Then, determine whether one matches your target element. The element described in the planning output might be visible in the screenshot and yet not be listed in the grounding prompt because it was disabled.
Where the list below mentions an element's position, it should be interpreted as the element's position relative to the viewport (and the coordinate values are relative to the viewport's width/height). Likewise, where information about an element's size is provided as "Size: X% x Y%", it should be interpreted as the element's size relative to the viewport's width/height.
If the element you want to interact with is "BELOW viewport", you should scroll down to it before acting on it. Likewise with "ABOVE viewport" and scrolling up.
Please examine the choices one by one. Choose the matching one. If multiple options match your answer, choose the most likely one by re-examining the screenshot, the choices, and your further reasoning.
If your planning above sets out a multi-step plan for progressing from the current state, you must implement the first step in that plan, not the last`;//todo try removing this last reminder after next model update, in case improved base model 'smartness'/long-context-reliability makes it unnecessary

//todo above prompt might include a recommendation to assemble a list of most plausible candidates and then reason about which is best; perhaps this could lead to more consistent and/or higher-quality reasoning about grounding?

//todo find some way to include this in the prompt when appropriate (when prev action failed and the explanation string for that failed action included the substring "search bar"?)
// Note that a search bar might initially show up in html as a button which must be clicked to make the actual search bar available

export const groundingOutputPromptIntro = `(Response Format)
Please present your output in JSON format, following the schema below. When a key ("value" or sometimes even "element") is irrelevant for the current response, use the json syntax for null (no double quotes around the word null)`;
export const groundingResponseJsonSchema = `{
    "reasoning": { "type": ["string"] },
    "explanation": { "type": ["string"] },
    "element": { "type": ["string", "null"] },
    "action": { "type": ["string"] },
    "value": {"type": ["string", "null"] }
}`;
export const groundingOutputPromptGeneralExplanation = `The parts of the JSON schema are explained below
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
 * @param viewportInfo information about the viewport and the dimensions of the page that it's showing part of
 * @return four prompts for the language model: 1) a system prompt (used with both of the other prompts);
 *          2) a prompt for the model planning its next step; and
 *          3) a prompt for the model identifying the element to interact with and how to interact with it
 *          4) a prompt for the model to choose an action when there is no specific element to interact with
 */
export const generatePrompt = (task: string, previousActions: Array<string>, choices: Array<string>,
                               viewportInfo: ViewportDetails): LmmPrompts => {
    const [sysPrompt, queryPrompt] = generateNewQueryPrompt(onlineSystemPrompt, task, previousActions,
        onlineQuestionDesc, viewportInfo);
    let groundingPrompt: string = onlineReferringPromptDesc + "\n\n";
    if (choices) {
        groundingPrompt += _formatOptions(choices);
    }
    groundingPrompt += groundingOutputPromptIntro + "\n" + groundingResponseJsonSchema + "\n" + groundingOutputPromptGeneralExplanation + "\n" + groundingOutputPromptExplanation;

    return {
        sysPrompt: sysPrompt, queryPrompt: queryPrompt, groundingPrompt: groundingPrompt,
        elementlessActionPrompt: groundingOutputPromptIntro + "\n" + groundingResponseJsonSchema + "\n" + groundingElementlessActionPromptExplanation
    };
}

