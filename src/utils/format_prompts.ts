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

//todo unit test
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
 *        the first string in each pair is the index of the element in the list of choices
 *        and the second string is an abbreviated version of the element's html
 *          (abbreviated start tag, some description, and end tag)
 */
export const formatChoices = (elements: Array<StrTriple>, candidateIds: Array<number>): Array<StrPair> => {
    //todo implement
    return [["bleh", "blargh"]];
}