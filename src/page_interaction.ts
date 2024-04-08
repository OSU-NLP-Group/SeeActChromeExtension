import {BrowserHelper, ElementData, SerializableElementData} from "./utils/BrowserHelper";
import {createNamedLogger} from "./utils/shared_logging_setup";

const logger = createNamedLogger('agent-page-interaction', false);
logger.trace("successfully injected page_interaction script in browser");

//todo to make this testable, need to have a class which has instance variables for
// browserHelper, currInteractiveElements, and portToBackground
const browserHelper = new BrowserHelper();

let currInteractiveElements: ElementData[] | undefined;

const portToBackground = chrome.runtime.connect({name: "content-script-2-agent-controller"});

//todo jsdoc
function getElementText(elementToActOn: HTMLElement) {
    let priorElementText = elementToActOn.textContent;
    if (elementToActOn instanceof HTMLInputElement || elementToActOn instanceof HTMLTextAreaElement) {
        priorElementText = elementToActOn.value;
    }
    return priorElementText;
}

//todo jsdoc and break up body into multiple methods
async function handleRequestFromAgentControlLoop(message: any) {
    logger.trace("message received from background script: " + JSON.stringify(message));
    if (message.msg === "get interactive elements") {
        if (currInteractiveElements) {
            logger.error("interactive elements already exist; background script might've asked for interactive elements twice in a row without in between instructing that an action be performed or without waiting for the action to be finished")
            portToBackground.postMessage({msg: "terminal page-side error", error: "interactive elements already exist"});
            return;
        }

        currInteractiveElements = browserHelper.getInteractiveElements();
        const elementsInSerializableForm = currInteractiveElements.map((elementData) => {
            const serializableElementData: SerializableElementData = {...elementData};
            if ('element' in serializableElementData) {
                delete serializableElementData['element'];
            }
            return serializableElementData;
        });

        //todo also retrieve current viewport position and provide that to controller logic in background script
        portToBackground.postMessage({
            msg: "sending interactive elements", interactiveElements: elementsInSerializableForm
        });
    } else if (message.msg === "perform action") {
        if (!currInteractiveElements) {
            logger.error("perform action message received from background script but no interactive elements are currently stored");
            portToBackground.postMessage({msg: "terminal page-side error", error: "no interactive elements stored to be acted on"});
            return;
        }
        const actionToPerform: string = message.action;//maybe make interface or enum for this
        let valueForAction: string | undefined = message.value;

        let actionSuccessful: boolean = false;
        let actionResult: string | undefined = undefined;

        if (message.elementIndex) {
            const elementToActOnData = currInteractiveElements[message.elementIndex];
            const tagName = elementToActOnData.tagName;
            const elementToActOn = elementToActOnData.element;

            //try reusing buildGenericActionDesc() once it's in a class file and not in background.ts
            const valueDesc = valueForAction ? ` with value ]${valueForAction}[` : "";
            actionResult = `[${elementToActOnData.tagHead}] ${elementToActOnData.description} -> ${actionToPerform}${valueDesc}`;

            /*
            todo consider implementing in js a conditional polling/wait for 'stability'
             https://playwright.dev/docs/actionability#stable
            todo might also need to implement a 'receives events' polling check
             https://playwright.dev/docs/actionability#receives-events
            todo note that a given action type would only need some of the actionability checks
             https://playwright.dev/docs/actionability#introduction
            todo above goals for conditional polling/waiting could be one (or a few) helper methods
             */

            //todo use actionResult to mimic the seeact.py code's use of new_action variable to build a more description of the action that was taken by adding a record of fall-back behavior

            logger.trace("performing action <" + actionToPerform + "> on element <" + elementToActOnData.tagHead + "> " + elementToActOnData.description);

            //todo perform action on an interactable element
            if (actionToPerform === "CLICK") {
                logger.trace("clicking element");
                elementToActOn.click();
                //todo since this doesn't throw error, need to figure out how to decide when to fall back on some alternative method of clicking
                // maybe can have 2 types of clicking, in the action space, and the prompt be conditionally augmented
                // to nudge the model to consider whether previous round's click attempt did anything, and if not to try the alternative click method
                actionSuccessful = true;
            } else if (actionToPerform === "TYPE") {
                const priorElementText = getElementText(elementToActOn);

                logger.trace("typing value ]" + valueForAction + "[ into element with prior text ]" + priorElementText + "[");
                if (valueForAction === undefined) {
                    logger.warn("no value provided for TYPE action; using empty string as value")
                    valueForAction = "";
                }

                if (priorElementText === valueForAction) {
                    logger.warn("element already has the desired text");
                }

                //if encounter problems with this (e.g. from placeholder text not going away unless you start
                // by clearing the field), try setting value or textContent to empty string first
                // (that might only be necessary when doing a 'press sequentially' approach)
                if (tagName === "input") {
                    const inputElem = elementToActOn as HTMLInputElement;
                    inputElem.value = valueForAction;
                    actionSuccessful = true;
                } else if (tagName === "textarea") {
                    const textareaElem = elementToActOn as HTMLTextAreaElement;
                    textareaElem.value = valueForAction;
                    actionSuccessful = true;
                } else if (elementToActOn.isContentEditable) {
                    elementToActOn.textContent = valueForAction;
                    actionSuccessful = true;
                } else {
                    logger.error("element is not an input, textarea, or contenteditable element; can't type in it. Trying to click it instead");
                    elementToActOn.click();
                    actionResult = "element is not an input, textarea, or contenteditable element; can't type in it. Tried clicking instead";
                }
                if (actionSuccessful) {
                    const postTypeElementText = getElementText(elementToActOn);
                    if (postTypeElementText !== valueForAction) {
                        if (priorElementText === postTypeElementText) {
                            logger.warn("text of element after typing is the same as the prior text; typing might not have worked");
                            actionResult += `element text ]${postTypeElementText}[ not changed by typing`;
                            actionSuccessful = false;
                        } else {
                            logger.warn("text of element after typing doesn't match the desired value");
                            actionResult += `element text after typing: ]${postTypeElementText}[ doesn't match desired value`;
                            actionSuccessful = false;
                        }
                        //todo add fall-back options here like trying to clear the field and then type again, possibly
                        // using newly-written code for turning a string into a sequence of key press events and sending those to the element
                    }
                }
            } else if (actionToPerform === "PRESS ENTER") {
                logger.trace("pressing enter on element");
                const event = new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter'});
                elementToActOn.dispatchEvent(event);
                actionSuccessful = true;
            } else {
                logger.warn("unknown action type: " + actionToPerform);
                actionResult = "unknown action type: " + actionToPerform;
            }
            //todo HOVER, SELECT, SCROLL


        } else {
            logger.warn("no element index provided in message from background script; can't perform action");
            //todo maybe later add support for the "press enter without a specific element" action scenario,
            // but I'm not at all sure how that would work in js
            //The TERMINATE action is handled in the background script
            actionResult = "no element index provided in message from background script; can't perform action";
        }

        //todo find better way to wait for action to finish than just waiting a fixed amount of time
        // maybe inspired by playwright's page stability checks?
        await new Promise(resolve => setTimeout(resolve, 1000));

        currInteractiveElements = undefined;
        //this part would only be reached if the action didn't cause page navigation
        portToBackground.postMessage({msg: "action performed", success: actionSuccessful, result: actionResult});
    } else {
        logger.warn("unknown message from background script: " + JSON.stringify(message));
    }
}

portToBackground.onMessage.addListener(handleRequestFromAgentControlLoop);
portToBackground.postMessage({msg: "content script initialized and ready"});
