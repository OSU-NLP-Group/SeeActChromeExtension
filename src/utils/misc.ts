import {SerializableElementData} from "./BrowserHelper";


export const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";


//todo jsdoc
export function buildGenericActionDesc(action: string, elementData?: SerializableElementData, value?: string): string {
    const valueDesc = value ? ` with value: ${(value)}` : "";
    return `[${elementData?.tagHead}] ${elementData?.description} -> ${action}${valueDesc}`;
}


export async function sleep(numMs: number) {
    await new Promise(resolve => setTimeout(resolve, numMs));
}