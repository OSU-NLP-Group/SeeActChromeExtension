import {Logger} from "loglevel";
import {BrowserHelper, ElementData, SerializableElementData} from "./BrowserHelper";
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action, Background2PagePortMsgType, buildGenericActionDesc, expectedMsgForPortDisconnection, PageRequestType,
    Page2BackgroundPortMsgType, sleep
} from "./misc";
import {ChromeWrapper} from "./ChromeWrapper";

type ActionOutcome = { success: boolean; result: string };


//todo jsdoc
export class PageActor {

    private browserHelper: BrowserHelper;
    private chromeWrapper: ChromeWrapper;
    private currInteractiveElements: ElementData[] | undefined;
    //if significant mutable state at some point extends beyond currInteractiveElements,
    // consider making a mutex for the state
    hasControllerEverResponded: boolean = false;
    portToBackground: chrome.runtime.Port;
    readonly logger: Logger;

    //todo jsdoc
    constructor(portToBackground: chrome.runtime.Port, browserHelper?: BrowserHelper, logger?: Logger,
                chromeWrapper?: ChromeWrapper) {
        this.browserHelper = browserHelper ?? new BrowserHelper();
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.portToBackground = portToBackground;
        this.logger = logger ?? createNamedLogger('page-actor', false);
    }


    //todo jsdoc
    getPageInfoForController = (): void => {
        if (this.currInteractiveElements) {
            this.logger.error("interactive elements already exist; background script might've asked for interactive elements twice in a row without in between instructing that an action be performed or without waiting for the action to be finished")
            this.portToBackground.postMessage(
                {msg: Page2BackgroundPortMsgType.TERMINAL, error: "interactive elements already exist"});
            return;
        }

        this.currInteractiveElements = this.browserHelper.getInteractiveElements();
        const elementsInSerializableForm = this.currInteractiveElements.map((elementData) => {
            const serializableElementData: SerializableElementData = {...elementData};
            if ('element' in serializableElementData) {
                delete serializableElementData['element'];
            }//ugly, but avoids forgetting to add another copying here if more serializable fields are added to ElementData
            return serializableElementData;
        });

        //todo also retrieve current viewport position and provide that to controller logic in background script
        try {
            this.portToBackground.postMessage(
                {msg: Page2BackgroundPortMsgType.PAGE_STATE, interactiveElements: elementsInSerializableForm});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("service worker disconnected from content script while content script was gathering interactive elements (task was probably terminated by user)");
            } else {
                this.logger.error(`unexpected error in content script while sending interactive elements to service worker; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }
    }

    //todo jsdoc
    typeIntoElement = (elementToActOn: HTMLElement, valueForAction: string | undefined, tagName: string,
                       actionOutcome: ActionOutcome): string => {
        const priorElementText = this.browserHelper.getElementText(elementToActOn);

        this.logger.trace("typing value [<" + valueForAction + ">] into element with prior text [<" + priorElementText + ">]");
        if (valueForAction === undefined) {
            this.logger.warn("no value provided for TYPE action; using empty string as value")
            valueForAction = "";
        }

        if (priorElementText === valueForAction) {
            this.logger.warn("element already has the desired text");
        }

        //if encounter problems with this (e.g. from placeholder text not going away unless you start
        // by clearing the field), try setting value or textContent to empty string first
        // (that might only be necessary when doing a 'press sequentially' approach)
        if (tagName === "input") {
            const inputElem = elementToActOn as HTMLInputElement;
            inputElem.value = valueForAction;
            actionOutcome.success = true;
        } else if (tagName === "textarea") {
            const textareaElem = elementToActOn as HTMLTextAreaElement;
            textareaElem.value = valueForAction;
            actionOutcome.success = true;
        } else if (elementToActOn.isContentEditable) {
            elementToActOn.textContent = valueForAction;
            actionOutcome.success = true;
        } else {
            this.logger.warn("element is not an input, textarea, or contenteditable element; can't type in it. Trying to click it with js instead");
            elementToActOn.click();
            actionOutcome.result = "element is not an input, textarea, or contenteditable element; can't type in it. Tried clicking with js instead";
        }
        //possibly relevant thing for getting page to notice that you changed an element's text:
        // https://stackoverflow.com/questions/61190078/simulating-keypress-into-an-input-field-javascript#comment134037565_61192160
        // also possibly https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event

        if (actionOutcome.success) {
            this.logger.debug("element focused status after typing: " + (document.activeElement === elementToActOn));
            elementToActOn.focus();
            this.logger.debug("element focused status after element.focus(): " + (document.activeElement === elementToActOn));

            const postTypeElementText = this.browserHelper.getElementText(elementToActOn);
            if (postTypeElementText !== valueForAction) {
                if (priorElementText === postTypeElementText) {
                    this.logger.warn("text of element after typing is the same as the prior text; typing might not have worked");
                    actionOutcome.result += `element text ]${postTypeElementText}[ not changed by typing`;
                    actionOutcome.success = false;
                } else {
                    this.logger.warn("text of element after typing doesn't match the desired value");
                    actionOutcome.result += `element text after typing: ]${postTypeElementText}[ doesn't match desired value`;
                    actionOutcome.success = false;
                }
                //todo add fall-back options here like trying to clear the field and then type again, possibly
                // using newly-written code for turning a string into a sequence of key press events and sending those to the element
            }
        }
        return valueForAction;
    }

    //todo jsdoc
    performSelectAction = (valueForAction: string | undefined, tagName: string, elementToActOn: HTMLElement,
                           actionOutcome: ActionOutcome): string | undefined => {
        let selectedOptVal: string | undefined;
        this.logger.trace("entered SELECT action branch");
        if (valueForAction === undefined) {
            this.logger.warn("no value provided for SELECT action; rejecting action");
            actionOutcome.result = "; no value provided for SELECT action, so cannot perform it";
        } else if (tagName !== "select") {
            this.logger.warn("SELECT action given for non <select> element; rejecting action");
            actionOutcome.result = "; SELECT action given for non <select> element, so cannot perform it";
        } else {
            this.logger.trace("about to select option with value [<" + valueForAction + ">]");
            selectedOptVal = this.browserHelper.selectOption(elementToActOn, valueForAction);
            if (selectedOptVal === valueForAction) {
                actionOutcome.success = true;
                actionOutcome.result += `; select succeeded`;
            } else if (selectedOptVal) {
                actionOutcome.success = true;
                actionOutcome.result += `; selected most-similar option [<${selectedOptVal}>]`;
            } else {
                actionOutcome.result = `; failed to select any option similar to the given value`;
            }
        }
        return selectedOptVal;
    }

    //todo jsdoc
    performScrollAction = (actionToPerform: string, actionOutcome: ActionOutcome): void => {
        const docElement = document.documentElement;
        const viewportHeight = docElement.clientHeight;
        //todo make scroll increment fraction configurable in options menu? if so, that config option would
        // also need to affect the relevant sentence of the system prompt (about magnitude of scrolling actions)
        const scrollAmount = viewportHeight * 0.75;
        const scrollVertOffset = actionToPerform === Action.SCROLL_UP ? -scrollAmount : scrollAmount;
        this.logger.trace(`scrolling page by ${scrollVertOffset}px`);
        const priorVertScrollPos = window.scrollY;
        window.scrollBy(0, scrollVertOffset);
        if (priorVertScrollPos != window.scrollY) {
            actionOutcome.success = true;
            actionOutcome.result += `; scrolled page by ${window.scrollY - priorVertScrollPos} px`;
        } else {
            this.logger.warn("scroll action failed to move the viewport's vertical position")
            actionOutcome.result += `; scroll action failed to move the viewport's vertical position`;
        }
    }

    //todo jsdoc
    performPressEnterAction = async (actionOutcome: ActionOutcome,
                                     targetElementDesc: string): Promise<void> => {
        this.logger.trace(`about to press Enter on ${targetElementDesc}`);
        const resp = await this.chromeWrapper.sendMessageToServiceWorker({reqType: PageRequestType.PRESS_ENTER});
        if (resp.success) {
            this.logger.trace(`pressed Enter on ${targetElementDesc}`);
            actionOutcome.success = true;
        } else {
            actionOutcome.result += "; " + resp.message;
        }
    }

    //todo jsdoc
    performActionFromController = async (message: any): Promise<void> => {
        if (!this.currInteractiveElements) {
            this.logger.error("perform action message received from background script but no interactive elements are currently stored");
            this.portToBackground.postMessage(
                {msg: Page2BackgroundPortMsgType.TERMINAL, error: "no interactive elements stored to be acted on"});
            return;
        }
        const actionToPerform: Action = message.action;
        const valueForAction: string | undefined = message.value;

        const actionOutcome: ActionOutcome = {success: false, result: ""};

        if (message.elementIndex) {
            const elementToActOnData = this.currInteractiveElements[message.elementIndex];
            const tagName = elementToActOnData.tagName;
            const elementToActOn = elementToActOnData.element;

            actionOutcome.result = buildGenericActionDesc(actionToPerform, elementToActOnData, valueForAction);

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
            // https://stackoverflow.com/a/56399194/10808625 (it only checks for existence, but shouldn't be too hard to extend the logic)

            this.logger.trace("performing action <" + actionToPerform + "> on element <" + elementToActOnData.tagHead + "> " + elementToActOnData.description);

            if (actionToPerform === Action.CLICK) {
                this.logger.trace("clicking element");
                elementToActOn.click();
                actionOutcome.result += "; clicked element with js";
                //todo since this doesn't throw error, need to figure out how to decide when to fall back on some alternative method of clicking
                // maybe can have 2 types of clicking, in the action space, and the prompt be conditionally augmented
                // to nudge the model to consider whether previous round's click attempt did anything, and if not to try the alternative click method
                // how to implement alternative click method: use chrome.debugger api:  https://stackoverflow.com/a/76816427/10808625
                //  https://developer.chrome.com/docs/extensions/reference/api/debugger#method-sendCommand
                //  https://chromedevtools.github.io/devtools-protocol/1-2/Input/
                actionOutcome.success = true;
            } else if (actionToPerform === Action.TYPE) {
                this.typeIntoElement(elementToActOn, valueForAction, tagName, actionOutcome);
            } else if (actionToPerform === Action.PRESS_ENTER) {
                elementToActOn.focus();
                //todo explore focusVisible:true option, and/or a conditional poll/wait approach to ensure the element is
                // focused before we send the Enter key event
                await sleep(50);
                await this.performPressEnterAction(actionOutcome, "a particular element");
            } else if (actionToPerform === Action.SELECT) {
                this.performSelectAction(valueForAction, tagName, elementToActOn, actionOutcome);
            } else {
                this.logger.warn("unknown action type: " + actionToPerform);
                actionOutcome.result = "unknown action type: " + actionToPerform;
            }

            //todo HOVER
            // maybe use this https://chromedevtools.github.io/devtools-protocol/1-3/Input/#method-dispatchMouseEvent
            // with type "mouseMoved"

        } else {
            if (actionToPerform === Action.SCROLL_UP || actionToPerform === Action.SCROLL_DOWN) {
                this.performScrollAction(actionToPerform, actionOutcome);
            } else if (actionToPerform === Action.PRESS_ENTER) {
                await this.performPressEnterAction(actionOutcome, "whatever element had focus in the tab")
                //todo open question for chrome.debugger api: how to handle the case where the tab is already being
                // debugged by another extension (or if chrome dev tools side panel is open??)? tell the LLM that
                // it can't use PRESS_ENTER for now and must try to click instead?
            } else {
                this.logger.warn("no element index provided in message from background script; can't perform action "
                    + actionToPerform);
                //The TERMINATE action is handled in the background script
                actionOutcome.result = "no element index provided in message from background script; can't perform action "
                    + actionToPerform;
            }
        }

        //todo find better way to wait for action to finish than just waiting a fixed amount of time
        // maybe inspired by playwright's page stability checks?
        await sleep(3000);

        this.currInteractiveElements = undefined;
        //this part would only be reached if the action didn't cause page navigation in current tab

        try {
            this.portToBackground.postMessage(
                {msg: Page2BackgroundPortMsgType.ACTION_DONE, success: actionOutcome.success, result: actionOutcome.result});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("service worker disconnected from content script while content script was performing action (task was probably terminated by user)");
            } else {
                this.logger.error(`unexpected error in content script while notifying service worker about performed action; error: ${error}, jsonified: ${JSON.stringify(error)}`);
            }
        }
    }

    //todo jsdoc
    handleRequestFromAgentController = async (message: any): Promise<void> => {
        this.logger.trace(`message received from background script: ${JSON.stringify(message)} by page ${document.URL}`);
        this.hasControllerEverResponded = true;
        if (message.msg === Background2PagePortMsgType.REQ_PAGE_STATE) {
            this.getPageInfoForController();
        } else if (message.msg === Background2PagePortMsgType.REQ_ACTION) {
            await this.performActionFromController(message);
        } else {
            this.logger.warn("unknown message from background script: " + JSON.stringify(message));
        }
    }

}