import {generateNewQueryPrompt, generateNewReferringPrompt, StrPair} from "./format_prompt_utils";


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
 * @return a list of pairs of strings, where
 *        the first string in each pair is the index of the element from the original list of elements
 *        and the second string is an abbreviated version of the element's html
 *          (abbreviated start tag, some description, and end tag)
 */
export const formatChoices = (elements: Array<StrTriple>, candidateIds: Array<number>): Array<StrPair> => {
    const badCandidateIds = candidateIds.filter((id) => id < 0 || id >= elements.length);
    if (badCandidateIds.length > 0) {
        throw new Error(`out of the candidate id's [${candidateIds}], the id's [${badCandidateIds}] were out of range`);
    }

    //todo idea- get viewport dimensions here; meanwhile, modify formatChoices' elements argument
    // to include element's centercoords and then here we can normalize that to be fractions of viewport dimensions

    //todo can we maybe also filter out elements which aren't in viewport? or mark them as not being visible?

    return candidateIds.map((id) => {
        const [description, tagAndRoleType, tagName] = elements[id];

        let possiblyAbbrevDesc = description;
        const descriptionSplit: Array<string> = description.split(/\s+/);
        if ("select" !== tagName && descriptionSplit.length >= 30) {
            possiblyAbbrevDesc = descriptionSplit.slice(0, 29).join(" ") + "...";
        }

        const abbreviatedHtml = `<${tagAndRoleType} id="${id}">${possiblyAbbrevDesc}</${tagName}>`;
        return [`${id}`, abbreviatedHtml];
    });
}

/**
 * @description processes the output of the LLM and isolates a) the alphabetic name of the element which should be
 * interacted with, b) the action which should be performed on that element, and optionally c) the text value
 * which should be used in that action
 * @param llmText the output of the LLM when asked what element should be interacted with and how
 * @return a 3-tuple of strings, where the first string is the alphabetic name of the element which should be
 *          interacted with, the second string is the action which should be performed on that element, and the
 *          third string is the text value (empty string if no value was available)
 */
//todo later idea for improvement is to leverage open ai api's "forced json" output mode instead of this regex-based parsing
export const postProcessActionLlm = (llmText: string): [string, string, string] => {
    //sorted/deduplicated copy of list from src/format_prompt.py
    //todo confer with Boyuan about whether this particular pre-processing is actually adding any value at this point
    const llmJunkStrings = [
        "Choose an action from {CLICK, TYPE, SELECT}.",
        "Choose an action from {CLICK, TYPE, SELECT}.\n",
        "Choose an action from {CLICK, TYPE, SELECT}.\n\n",
        "Provide additional input based on ACTION.",
        "Provide additional input based on ACTION.\n",
        "Provide additional input based on ACTION.\n\n",
        "The correct choice based on the analysis would be ",
        "The correct choice based on the analysis would be :",
        "The correct choice based on the analysis would be:\n",
        "The correct choice based on the analysis would be:\n\n",
        "The correct element to select would be ",
        "The correct element to select would be:",
        "The correct element to select would be:\n",
        "The correct element to select would be:\n\n",
        "The uppercase letter of my choice based on the analysis is ",
        "The uppercase letter of my choice based on the analysis is:",
        "The uppercase letter of my choice based on the analysis is:\n",
        "The uppercase letter of my choice based on the analysis is:\n\n",
        "The uppercase letter of my choice is ",
        "The uppercase letter of my choice is \n",
        "The uppercase letter of my choice is \n\n",
        "The uppercase letter of my choice is:",
        "The uppercase letter of my choice is:\n",
        "The uppercase letter of my choice is:\n\n",
        "The uppercase letter of your choice based on my analysis is:",
        "The uppercase letter of your choice based on my analysis is:\n",
        "The uppercase letter of your choice based on my analysis is:\n\n",
        "The uppercase letter of your choice based on the analysis is ",
        "The uppercase letter of your choice based on the analysis is:",
        "The uppercase letter of your choice based on the analysis is:\n",
        "The uppercase letter of your choice based on the analysis is:\n\n",
        "The uppercase letter of your choice based on your analysis is:",
        "The uppercase letter of your choice based on your analysis is:\n",
        "The uppercase letter of your choice based on your analysis is:\n\n",
        "The uppercase letter of your choice is ",
        "The uppercase letter of your choice is \n",
        "The uppercase letter of your choice is \n\n",
        "The uppercase letter of your choice. Choose one of the following elements if it matches the target element based on your analysis:",
        "The uppercase letter of your choice. Choose one of the following elements if it matches the target element based on your analysis:\n",
        "The uppercase letter of your choice. Choose one of the following elements if it matches the target element based on your analysis:\n\n",
        "The uppercase letter of your choice.",
        "The uppercase letter of your choice.\n",
        "The uppercase letter of your choice.\n\n"
    ];
    for (const junkPattern of llmJunkStrings) {
        llmText = llmText.replace(junkPattern, "");
    }

    let elementChoice = "Invalid";
    const elementMatch: RegExpMatchArray | null = llmText.match(/ELEMENT: ([A-Z]{1,2})/);
    if (elementMatch) {
        elementChoice = elementMatch[1];
    }

    let actionChoice = "None";
    const actionMatch: RegExpMatchArray | null = llmText.match(/ACTION: (CLICK|SELECT|TYPE|HOVER|PRESS ENTER|TERMINATE|NONE)/);
    if (actionMatch) {
        actionChoice = actionMatch[1];
    }

    let valueChoice = "";
    const valueMatch: RegExpMatchArray | null = llmText.match(/VALUE: (.+)$/m);
    if (valueMatch) {
        valueChoice = valueMatch[1];
    }

    return [elementChoice, actionChoice, valueChoice];
}


// todo ask Boyuan about changing system prompt to stop referring to playwright
export const onlineSystemPrompt = "Imagine that you are imitating humans doing web navigation for a task step by step. At each stage, you can see the webpage like humans by a screenshot and know the previous actions before the current step decided by yourself through recorded history. You need to decide on the first following action to take. You can click on an element with the mouse, select an option, type text or press Enter with the keyboard. (For your understanding, they are like the click(), select_option() type() and keyboard.press('Enter') functions in playwright respectively) One next step means one operation within the four. Unlike humans, for typing (e.g., in text areas, text boxes) and selecting (e.g., from dropdown menus or <select> elements), you should try directly typing the input or selecting the choice, bypassing the need for an initial click. You should not attempt to create accounts, log in or do the final submission. Terminate when you deem the task complete or if it requires potentially harmful actions.";
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
3. For handling the select dropdown elements on the webpage, it's not necessary for you to provide completely accurate options right now. The full list of options for these elements will be supplied later.`;
export const onlineReferringPromptDesc = `(Reiteration)
First, reiterate your next target element, its detailed location, and the corresponding operation.

(Multichoice Question)
Below is a multi-choice question, where the choices are elements in the webpage. All elements are arranged in the order based on their height on the webpage, from top to bottom (and from left to right). This arrangement can be used to locate them. From the screenshot, find out where and what each one is on the webpage, taking into account both their text content and HTML details. Then, determine whether one matches your target element. Please examine the choices one by one. Choose the matching one. If multiple options match your answer, choose the most likely one by re-examining the screenshot, the choices, and your further reasoning.`;
export const onlineElementFormat = `(Final Answer)
Finally, conclude your answer using the format below. Ensure your answer is strictly adhering to the format provided below. Please do not leave any explanation in your answers of the final standardized format part, and this final part should be clear and certain. The element choice, action, and value should be in three separate lines.

Format:

ELEMENT: The uppercase letter of your choice. (No need for PRESS ENTER)`;
export const onlineActionFormat = "ACTION: Choose an action from {CLICK, SELECT, TYPE, PRESS ENTER, TERMINATE, NONE}.";
export const onlineValueFormat = "VALUE: Provide additional input based on ACTION.\n\nThe VALUE means:\nIf ACTION == TYPE, specify the text to be typed.\nIf ACTION == SELECT, indicate the option to be chosen. Revise the selection value to align with the available options within the element.\nIf ACTION == CLICK, PRESS ENTER, TERMINATE or NONE, write \"None\".";

/**
 * @description generate the prompts for the web agent for the current step of the task
 * This was originally in src/prompts.py, but I put it here because almost everything from prompts.py was irrelevant
 * for the plugin
 * @param task the overall task which is being worked on
 * @param previousActions brief records of the previous actions taken by the web agent
 * @param choices describes the elements which might be interacted with; each entry in the top-level list is a length-2
 *                 list, with the first entry being the string version of the choice's index and the second entry
 *                 being an abbreviated version of the element's html
 * @return three prompts for the language model: 1) a system prompt (used with both of the other prompts);
 *          2) a prompt for the model planning its next step; and
 *          3) a prompt for the model identifying the element to interact with and how to interact with it
 */
export const generatePrompt = (task: string, previousActions: Array<string>, choices: Array<StrPair>): StrTriple => {
    const [sysPrompt, queryPrompt] = generateNewQueryPrompt(onlineSystemPrompt, task, previousActions, onlineQuestionDesc);
    const referringPrompt = generateNewReferringPrompt(onlineReferringPromptDesc, onlineElementFormat, onlineActionFormat, onlineValueFormat, choices);
    return [sysPrompt, queryPrompt, referringPrompt];
}

