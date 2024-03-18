import {StrPair} from "./format_prompt_utils";

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
 * Note- relative to the original method format_choices() in src/format_prompt.py, the entries in the argument elements
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