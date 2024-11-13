/**
 * @fileoverview This file contains utility functions for formatting prompts
 */
import {ViewportDetails} from "./misc";
import {createNamedLogger} from "./shared_logging_setup";

const logger = createNamedLogger("format-prompt-utils", true);

export const basicPromptIntro: string = "You are asked to complete the following task: ";
export const prevActionsIntro: string = "Previous Actions:\n";
export const noPrevActions: string = "No prior actions\n";

/**
 * @description Generate the first phase prompt to ask model to generate general descriptions about
 * {environment, high-level plans, next step action}
 *     Each experiment will have a similar prompt in this phase
 *     This prompt is used to generate models' thoughts without disrupt of formatting/referring prompts
 * @param task the current task specification from the user
 * @param previousActions an array of string descriptions of previous actions by the web agent
 * @param questionDescription the immediate question to the web agent (e.g. about what it should do next)
 * @param viewportInfo information about the viewport and the dimensions of the page that it's showing part of
 * @return an array with the 'system role' (i.e. system prompt) and the full query/main-prompt for the model
 */
export const generateNewPlanningPrompt =
    (task: string, previousActions: Array<string> | null, questionDescription: string, viewportInfo: ViewportDetails
    ): string => {

        let queryText: string = basicPromptIntro + task + "\n\n" + prevActionsIntro;
        if (previousActions === null || previousActions.length === 0) {
            queryText += noPrevActions;
        } else {
            queryText += (previousActions).join("\n") + "\n";
            //todo ask Boyuan- was the python code supposed to add a newline after the last previous action?
            // that behavior's been reproduced here for now
        }
        queryText += "\n" + questionDescription;
        const scrollableDistance = viewportInfo.pageScrollHeight - viewportInfo.height;
        if (scrollableDistance > 0) {
            const scrollRelativeYPos = 100*viewportInfo.scrollY / scrollableDistance;
            queryText += `\nViewport is scrolled ${scrollRelativeYPos.toFixed(1)}% down the page.`;
        } else {
            logger.debug("page is not scrollable vertically because the viewport is taller than the page's content");
        }

        return queryText;
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
 * @return the non-negative 0-based index of the option, or undefined if invalid input
 */
export const getIndexFromOptionName = (optName: string|undefined): number|undefined => {
    let index: number|undefined;
    if (optName?.match(/^[A-Z]{1,2}$/)) {
        const capitalLetterToIndex = (capitalLetter: string): number =>
            capitalLetter.charCodeAt(0) - 'A'.charCodeAt(0);

        if (optName.length === 1) {
            index = capitalLetterToIndex(optName);
        } else {
            index = (capitalLetterToIndex(optName[0]) + 1) * 26 + capitalLetterToIndex(optName[1]);
        }
    }
    return index;
}

/**
 * Only exported for use in white-box-type unit tests. Do not reference in application code outside this module.
 * @description convert a list of choices to a string, with an introduction at the start and
 *  a 'none of the above' option added at the end
 * @param choices a list of lists of strings; each entry in the top-level list represents a choice
 *                 a given sublist contains the string version of the choice's index
 *                 and the string describing the option
 * @return a string representation of the choices, with a 'none of the above' option added at the end
 */
export const _formatOptions = (choices: Array<string>): string => {
    const noneOfAboveOptionName: string = _generateOptionName(choices.length);

    return `If none of these elements match your target element, please select ${noneOfAboveOptionName}. ` +
        'None of the other options match the correct element.\n' +
        choices.map((value, index) => `${_generateOptionName(index)}. ${value}\n`).join('') +
        `${noneOfAboveOptionName}. None of the other options match the correct element\n\n`;
}
