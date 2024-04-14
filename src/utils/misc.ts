import {SerializableElementData} from "./BrowserHelper";


export const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";


/**
 * @description Builds a description of an action (which may have been performed on an element)
 * @param action name of the action
 * @param elementData optional data of the element on which the action was performed
 *                      (undefined if action didn't target an element)
 * @param value optional value of the action (e.g. text to be typed)
 * @return description of an action
 */
export function buildGenericActionDesc(action: string, elementData?: SerializableElementData, value?: string): string {
    if (elementData) {
        const valueDesc = value ? ` with value: ${(value)}` : "";
        return `[${elementData?.tagHead}] ${elementData?.description} -> ${action}${valueDesc}`;
    } else {
        return `Performed element-independent action ${action}`;
    }
}//todo 2 unit tests


export async function sleep(numMs: number) {
    await new Promise(resolve => setTimeout(resolve, numMs));
}