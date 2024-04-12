import {BrowserHelper, ElementData, SerializableElementData} from "./utils/BrowserHelper";
import {createNamedLogger} from "./utils/shared_logging_setup";


const logger = createNamedLogger('agent-page-interaction', false);
logger.trace(`successfully injected page_interaction script in browser for page ${document.URL}`);

const expectedMsgForPortDisconnection = "Attempting to use a disconnected port object";

//todo to make this testable, need to have a class which has instance variables for
// browserHelper, currInteractiveElements, portToBackground, and hasControllerEverResponded
const browserHelper = new BrowserHelper();

let currInteractiveElements: ElementData[] | undefined;

//todo revisit safe way to make different tabs' ports distinguishable by name (putting url in wasn't accepted by chrome)
const portToBackground = chrome.runtime.connect({name: `content-script-2-agent-controller`});
let hasControllerEverResponded: boolean = false;


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
    logger.trace(`message received from background script: ${JSON.stringify(message)} by page ${document.URL}`);
    hasControllerEverResponded = true;
    if (message.msg === "get interactive elements") {
        if (currInteractiveElements) {
            logger.error("interactive elements already exist; background script might've asked for interactive elements twice in a row without in between instructing that an action be performed or without waiting for the action to be finished")
            portToBackground.postMessage({
                msg: "terminal page-side error", error: "interactive elements already exist"
            });
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
        try {
            portToBackground.postMessage({
                msg: "sending interactive elements", interactiveElements: elementsInSerializableForm
            });
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                logger.info("service worker disconnected from content script while content script was gathering interactive elements (task was probably terminated by user)");
            } else {
                logger.error(`unexpected error in content script while sending interactive elements to service worker; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }

    } else if (message.msg === "perform action") {
        if (!currInteractiveElements) {
            logger.error("perform action message received from background script but no interactive elements are currently stored");
            portToBackground.postMessage({
                msg: "terminal page-side error", error: "no interactive elements stored to be acted on"
            });
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

            //good modern-approach starting point for conditional polling/waiting:
            // https://stackoverflow.com/a/56399194/10808625 (it only checks for existence, but shouldn't be too hard to extend the logic

            //todo use actionResult to mimic the seeact.py code's use of new_action variable to build a more description of the action that was taken by adding a record of fall-back behavior

            logger.trace("performing action <" + actionToPerform + "> on element <" + elementToActOnData.tagHead + "> " + elementToActOnData.description);

            //todo perform action on an interactable element
            if (actionToPerform === "CLICK") {
                logger.trace("clicking element");
                elementToActOn.click();
                //todo since this doesn't throw error, need to figure out how to decide when to fall back on some alternative method of clicking
                // maybe can have 2 types of clicking, in the action space, and the prompt be conditionally augmented
                // to nudge the model to consider whether previous round's click attempt did anything, and if not to try the alternative click method
                // how to implement alternative click method: use chrome.debugger api:  https://stackoverflow.com/a/76816427/10808625
                //  https://developer.chrome.com/docs/extensions/reference/api/debugger#method-sendCommand
                //  https://chromedevtools.github.io/devtools-protocol/1-2/Input/
                actionSuccessful = true;
            } else if (actionToPerform === "TYPE") {
                logger.debug("element focused status before typing: " + (document.activeElement === elementToActOn));
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
                //possibly relevant thing for getting page to notice that you changed an element's text:
                // https://stackoverflow.com/questions/61190078/simulating-keypress-into-an-input-field-javascript#comment134037565_61192160
                // also possibly https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event

                if (actionSuccessful) {
                    logger.debug("element focused status after typing: " + (document.activeElement === elementToActOn));
                    elementToActOn.focus();
                    logger.debug("element focused status after element.focus(): " + (document.activeElement === elementToActOn));

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
            } else if (actionToPerform === "PRESS_ENTER") {

                elementToActOn.focus();
                //todo explore focusVisible:true option, and/or a conditional poll/wait approach to ensure the element is
                // focused before we send the Enter key event
                await sleep(50);//todo maybe experiment with this value
                logger.trace("about to press Enter on particular element");
                await chrome.runtime.sendMessage({reqType: "pressEnter"});
                logger.trace("pressed Enter on particular element");

                actionSuccessful = true;
            } else {
                logger.warn("unknown action type: " + actionToPerform);
                actionResult = "unknown action type: " + actionToPerform;
            }
            //todo! SELECT


            //todo? HOVER?
            // maybe use this https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchMouseEvent
            // with type "mouseMoved"

        } else {
            if (actionToPerform === "SCROLL_UP" || actionToPerform === "SCROLL_DOWN") {
                const docElement = document.documentElement;
                // const pageHeight = docElement.scrollHeight; //can uncomment if there's a need
                const viewportHeight = docElement.clientHeight;
                //todo make scroll increment fraction configurable in options menu? if so, that config option would
                // also need to affect the relevant sentence of the system prompt (about magnitude of scrolling actions)
                const scrollAmount = viewportHeight * 0.75;
                const scrollVertOffset = actionToPerform === "SCROLL_UP" ? -scrollAmount : scrollAmount;
                logger.trace(`scrolling page by ${scrollVertOffset}px`);
                const priorVertScrollPos = window.scrollY;
                window.scrollBy(0, scrollVertOffset);
                if (priorVertScrollPos != window.scrollY) {
                    actionSuccessful= true;
                } else {
                    logger.error("scroll action failed to move the viewport's vertical position")
                }
            } else if (actionToPerform === "PRESS_ENTER") {
                logger.trace("about to press Enter on whatever element had focus in the tab");
                await chrome.runtime.sendMessage({reqType: "pressEnter"});
                logger.trace("pressed Enter on whatever element had focus in the tab");
                actionSuccessful = true;
                //todo open question for chrome.debugger api: how to handle the case where the tab is already being
                // debugged by another extension (or if chrome dev tools side panel is open??)? tell the LLM that
                // it can't use PRESS_ENTER for now and must try to click instead?
            } else {
                logger.warn("no element index provided in message from background script; can't perform action "
                    + actionToPerform);
                //The TERMINATE action is handled in the background script
                actionResult = "no element index provided in message from background script; can't perform action "
                    + actionToPerform;
            }
        }

        //todo find better way to wait for action to finish than just waiting a fixed amount of time
        // maybe inspired by playwright's page stability checks?
        await sleep(3000);

        currInteractiveElements = undefined;
        //this part would only be reached if the action didn't cause page navigation in current tab

        try {
            portToBackground.postMessage({msg: "action performed", success: actionSuccessful, result: actionResult});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                logger.info("service worker disconnected from content script while content script was performing action (task was probably terminated by user)");
            } else {
                logger.error(`unexpected error in content script while notifying service worker about performed action; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }
    } else {
        logger.warn("unknown message from background script: " + JSON.stringify(message));
    }
}

portToBackground.onMessage.addListener(handleRequestFromAgentControlLoop);


//todo move this duplicated function to some generic utilities file
async function sleep(numMs: number) {
    await new Promise(resolve => setTimeout(resolve, numMs));
}

(async () => {
    //todo! wait here until page is loaded/stable!
    await sleep(5000);//todo make this configurable

    portToBackground.postMessage({msg: "content script initialized and ready"});

    await sleep(1000);
    if (!hasControllerEverResponded) {
        portToBackground.postMessage({msg: "content script initialized and ready"});
    }
})();
