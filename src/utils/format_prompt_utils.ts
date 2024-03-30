/**
 * @fileoverview This file contains utility functions for formatting prompts
 */

import {isEmpty} from "lodash";

export const basicPromptIntro: string = "You are asked to complete the following task: ";
export const prevActionsIntro: string = "Previous Actions:\n";
export const noPrevActions: string = "No prior actions\n";

/**
 * @description Generate the first phase prompt to ask model to generate general descriptions about
 * {environment, high-level plans, next step action}
 *     Each experiment will have a similar prompt in this phase
 *     This prompt is used to generate models' thoughts without disrupt of formatting/referring prompts
 * @param systemPrompt the system prompt for the web agent
 *                      todo confer with Boyuan about why this string is passed to the method
 *                          and then returned untouched as part of the return array
 *                          Feedback- allowed to refactor this to stop passing-in/returning the sys prompt without modification
 * @param task the current task specification from the user
 * @param previousActions an array of string descriptions of previous actions by the web agent
 * @param questionDescription the immediate question to the web agent (e.g. about what it should do next)
 * @return an array with the 'system role' (i.e. system prompt) and the full query/main-prompt for the model
 */
//todo can rename 'query' to analysis or analysisPlanning or something
export const generateNewQueryPrompt =
    (systemPrompt: string, task: string, previousActions: Array<string> | null,
     questionDescription: string
    ): Array<string> => {
        //can make this a let if a requirement comes in that we should add to or modify it
        const sysRole: string = systemPrompt;

        let queryText: string = basicPromptIntro + task + "\n\n" + prevActionsIntro;
        if (isEmpty(previousActions)) {
            queryText += noPrevActions;
        } else {
            //previousActions can't be null here b/c of the contract of _.isEmpty()
            queryText += (previousActions as Array<string>).join("\n") + "\n";
            //todo ask Boyuan- was the python code supposed to add a newline after the last previous action?
            // that behavior's been reproduced here for now
        }
        queryText += "\n" + questionDescription;

        return [sysRole, queryText];
    }

/**
 * Only exported for use in white-box-type unit tests. Do not reference in application code outside this module.
 * @description convert index to name consisting of one or two letters
 * A-Z
 * AA-AZ
 * BA-BZ
 * ...
 * ZA-ZZ
 * @param index the 0-based index of an option
 * @throws Error if index > (25 + 26*26), i.e. index > 701
 * @return an alphabetic identifier for the option
 */
export const _generateOptionName = (index: number): string => {
    const indexToCapitalLetter = (capitalLetterIndex: number): string =>
        String.fromCharCode('A'.charCodeAt(0) + capitalLetterIndex);

    if (index < 26) {
        return indexToCapitalLetter(index);
    } else if (index < 702) {
        const firstLetterIndex: number = Math.floor(index / 26) - 1;
        const secondLetterIndex: number = index % 26;
        return indexToCapitalLetter(firstLetterIndex) + indexToCapitalLetter(secondLetterIndex);
    } else {
        throw new Error("index out of range");
    }
}

/**
 * @description Convert an option name to an index
 * Inverts the operation of _generateOptionName
 * @param optName a 1 or 2 letter string representing an option
 * @throws Error if given a string of length 0, of length > 2, or containing characters that aren't in [A-Z]
 * @return the 0-based index of the option
 */
export const getIndexFromOptionName = (optName: string): number => {
    if (!optName.match(/^[A-Z]{1,2}$/)) {
        throw new Error("Invalid option name");
    }

    const capitalLetterToIndex = (capitalLetter: string): number =>
        capitalLetter.charCodeAt(0) - 'A'.charCodeAt(0);

    if (optName.length === 1) {
        return capitalLetterToIndex(optName);
    } else {
        return (capitalLetterToIndex(optName[0]) + 1) * 26 + capitalLetterToIndex(optName[1]);
    }
}


export type StrPair = [string, string];

/**
 * Only exported for use in white-box-type unit tests. Do not reference in application code outside this module.
 * @description convert a list of choices to a string, with an introduction at the start and
 *  a 'none of the above' option added at the end
 * @param choices a list of lists of strings; each entry in the top-level list represents a choice
 *                 a given sublist contains the string version of the choice's index
 *                 and the string describing the option
 * @return a string representation of the choices, with a 'none of the above' option added at the end
 */
export const _formatOptions = (choices: Array<StrPair>): string => {
    const noneOfAboveOptionName: string = _generateOptionName(choices.length);

    return `If none of these elements match your target element, please select ${noneOfAboveOptionName}. ` +
        'None of the other options match the correct element.\n' +
        choices.map((value, index) => `${_generateOptionName(index)}. ${value[1]}\n`).join('') +
        `${noneOfAboveOptionName}. None of the other options match the correct element\n\n`;
}

/**
 * @description Generate a new referring prompt based on several components
 * @param referringDescription describes the overall purpose of the prompt,
 *                              which involves 'referring' to a particular element in the page
 * @param elementFormat instructions about how to specify the target element
 * @param actionFormat instructions about how to specify what action should be performed on the target element
 * @param valueFormat instructions about whether/how to specify a text value
 *                      that would be used by that action on the target element
 * @param choices describes the elements which might be interacted with; each entry in the top-level list is a length-2
 *                 list, with the first entry being the string version of the choice's index and the second entry
 *                 being an abbreviated version of the element's html
 * @return a full prompt for the model to generate an action that refers to a particular element in the page
 */
//todo can rename to grounding over referring
export const generateNewReferringPrompt = (referringDescription: string, elementFormat: string, actionFormat: string,
                                           valueFormat: string, choices: Array<StrPair> | null
): string => {
    let referringPrompt: string = "";

    //TODO check with Boyuan- I didn't implement the "if some string arg is empty, skip it when building the prompt"
    // logic from the python code b/c online SeeAct scenarios in python code would always provide all 4 strings
    // If he's ok with that, maybe inline this method?
    // confirmed that's ok

    //Add description about how to format output
    referringPrompt += referringDescription + "\n\n";

    //Add element prediction format and choices
    if (choices) {
        referringPrompt += _formatOptions(choices);
    }

    referringPrompt += elementFormat + "\n\n";

    //Format Action Prediction
    referringPrompt += actionFormat + "\n\n";

    //Format Value Prediction
    referringPrompt += valueFormat;

    return referringPrompt;
}