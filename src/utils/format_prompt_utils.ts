/**
 * @fileoverview This file contains utility functions for formatting prompts
 */

import _ from "lodash";

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
 * @param task the current task specification from the user
 * @param previousActions an array of string descriptions of previous actions by the web agent
 * @param questionDescription the immediate question to the web agent (e.g. about what it should do next)
 * @return an array with the 'system role' (i.e. system prompt) and the full query/main-prompt for the model
 */
export const generateNewQueryPrompt =
    (systemPrompt: string, task: string, previousActions: Array<string> | null,
     questionDescription: string
    ): Array<string> => {
        //can make this a let if a requirement comes in that we should add to or modify it
        const sysRole: string = systemPrompt;

        let queryText: string = basicPromptIntro + task + "\n\n" + prevActionsIntro;
        if (_.isEmpty(previousActions)) {
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
 * Only exported for use in whitebox-type unit tests. Do not reference in application code outside this module.
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

// todo unit tests
/**
 * Only exported for use in whitebox-type unit tests. Do not reference in application code outside this module.
 * @description convert a list of choices to a string, with an introduction at the start and
 *  a 'none of the above' option added at the end
 * @param choices a list of lists of strings; each entry in the top-level list represents a choice
 *                 a given sublist contains the string version of the choice's index
 *                 and the string describing the option
 * @return a string representation of the choices, with a 'none of the above' option added at the end
 */
export const _formatOptions = (choices: Array<Array<string>>): string => {
    //todo implement
    return "dummy";
}


/* todo finish making signature (and then tests) for this once format_options() is done
const generateNewReferringPrompt = (referringDescription: string, elementFormat: string, actionFormat: string,
                                    valueFormat: string, choices: Array<string> | null
): string => {

}*/


/*
//todo docstring
//todo unit test
export const getIndexFromOptionName = (optName: string): number => {
    return 0;//todo implement
}*/
