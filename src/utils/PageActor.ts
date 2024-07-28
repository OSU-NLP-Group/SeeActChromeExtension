import {Logger} from "loglevel";
import {BrowserHelper, makeElementDataSerializable} from "./BrowserHelper";
import {createNamedLogger} from "./shared_logging_setup";
import {
    Action,
    AgentController2PagePortMsgType,
    buildGenericActionDesc, ElementData,
    expectedMsgForPortDisconnection,
    Page2AgentControllerPortMsgType,
    PageRequestType,
    renderUnknownValue,
    sleep
} from "./misc";
import {ChromeWrapper} from "./ChromeWrapper";
import {DomWrapper} from "./DomWrapper";

/**
 * used to allow local variables success and result from the main action-performing method to be passed by reference
 * to helper functions
 */
export type ActionOutcome = { success: boolean; result: string };


/**
 * Class that represents the actor that interacts with the page on behalf of the background script's controller logic.
 * It is responsible for gathering information about the page's state (e.g. interactive elements) and performing actions
 * on the page (e.g. clicking, typing, scrolling) as instructed by the controller logic.
 */
export class PageActor {

    private browserHelper: BrowserHelper;
    private domWrapper: DomWrapper;
    private chromeWrapper: ChromeWrapper;
    interactiveElements: ElementData[] | undefined;
    //if significant mutable state at some point extends beyond currInteractiveElements,
    // consider making a mutex for the state
    hasControllerEverResponded: boolean = false;
    portToBackground: chrome.runtime.Port;
    readonly logger: Logger;

    lastPageModificationTimestamp: number = 0;
    isPageBeingUnloaded: boolean = false;

    /**
     * Constructor for the PageActor class.
     * @param portToBackground The port object used to communicate with the agent controller in the background script.
     * @param browserHelper An instance of the BrowserHelper class that provides utility methods for interacting with the page.
     *                      Used during unit tests to inject an instance of BrowserHelper that contains mocks.
     * @param logger the logger for the page actor; used to inject a simplified logger during unit tests
     * @param chromeWrapper a wrapper to allow mocking of Chrome extension API calls
     * @param domWrapper a wrapper to allow mocking of dom interactions
     */
    constructor(portToBackground: chrome.runtime.Port, browserHelper?: BrowserHelper, logger?: Logger,
                chromeWrapper?: ChromeWrapper, domWrapper?: DomWrapper) {
        this.portToBackground = portToBackground;
        this.browserHelper = browserHelper ?? new BrowserHelper();
        this.domWrapper = domWrapper ?? new DomWrapper(window);
        this.chromeWrapper = chromeWrapper ?? new ChromeWrapper();
        this.logger = logger ?? createNamedLogger('page-actor', false);
    }


    /**
     * Method that retrieves information about the page's state (e.g. interactive elements) and sends it to the
     * controller
     */
    getPageInfoForController = (): void => {
        if (this.interactiveElements) {
            this.logger.error("interactive elements already exist; background script might've asked for interactive elements twice in a row without in between instructing that an action be performed or without waiting for the action to be finished")
            this.portToBackground.postMessage(
                {type: Page2AgentControllerPortMsgType.TERMINAL, error: "interactive elements already exist"});
            return;
        }

        this.interactiveElements = this.browserHelper.getInteractiveElements();
        const elementsInSerializableForm = this.interactiveElements.map(makeElementDataSerializable);

        try {
            this.portToBackground.postMessage({
                type: Page2AgentControllerPortMsgType.PAGE_STATE, interactiveElements: elementsInSerializableForm,
                viewportInfo: this.domWrapper.getViewportInfo(), url: this.domWrapper.getUrl()
            });
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("service worker disconnected from content script while content script was gathering interactive elements (task was probably terminated by user)");
            } else {
                this.logger.error(`unexpected error in content script while sending interactive elements to service worker; error: ${renderUnknownValue(error)}`);
            }
        }
    }

    /**
     * Method that performs the 'TYPE' action on an element on the page.
     * @param elementToActOn The element which the text should be typed into
     * @param valueForAction the text that should be typed
     * @param actionOutcome pass-by-reference for the nested success and result variables in the main
     *                       performActionFromController method
     * @return the text of the field after typing, or null if the field wasn't an editable text field
     */
    typeIntoElement = (elementToActOn: HTMLElement, valueForAction: string | undefined, actionOutcome: ActionOutcome
    ): string | null => {
        const priorElementText = this.browserHelper.getElementText(elementToActOn);
        const tagName = elementToActOn.tagName.toLowerCase();
        let result: string | null = null;

        this.logger.trace("typing value [<" + valueForAction + ">] into element with prior text [<" + priorElementText + ">]");
        if (valueForAction === undefined) {
            this.logger.warn("no value provided for TYPE action; using empty string as value")
            valueForAction = "";
            actionOutcome.result += "; used empty string as default for 'value'"
        }

        if (priorElementText === valueForAction) {
            this.logger.warn("element already has the desired text");
            actionOutcome.result += "; element already has the desired text";
        }

        //if encounter problems with this (e.g. from placeholder text not going away unless you start
        // by clearing the field), try setting value or textContent to empty string first
        // (that might only be necessary when doing a 'press sequentially' approach)
        if (tagName === "input") {
            const inputElem = elementToActOn as HTMLInputElement;
            //interestingly, there's at least one case (MFA screen for OSU) where this doesn't work, even
            // though doing the exact same operation via the console in Chrome Dev Tools does work
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
            actionOutcome.result += "; element is not an input, textarea, or contenteditable element; can't type in it. Tried clicking with js instead";
        }
        elementToActOn.dispatchEvent(new Event('input', {bubbles: true}));
        elementToActOn.dispatchEvent(new Event('change', {bubbles: true}));

        if (actionOutcome.success) {
            this.logger.debug("element focused status after typing: " + (document.activeElement === elementToActOn));
            elementToActOn.focus();
            this.logger.debug("element focused status after element.focus(): " + (document.activeElement === elementToActOn));

            const postTypeElementText = this.browserHelper.getElementText(elementToActOn);
            result = postTypeElementText;
            if (postTypeElementText !== valueForAction) {
                if (priorElementText === postTypeElementText) {
                    this.logger.warn("text of element after typing is the same as the prior text; typing might not have worked");
                    actionOutcome.result += `; element text [<${postTypeElementText}>] not changed by typing`;
                    actionOutcome.success = false;
                } else {
                    this.logger.warn("text of element after typing doesn't match the desired value");
                    actionOutcome.result += `; after typing, element text: [<${postTypeElementText}>] still doesn't match desired value`;
                    actionOutcome.success = false;
                }
                //todo add fall-back options here like trying to clear the field and then type again, possibly
                // using newly-written code for turning a string into a sequence of key press events and sending those to the element
            }
        }
        return result;
    }

    /**
     * Method that performs the 'SELECT' action on a select element on the page.
     * @param valueForAction the value of the option to select
     * @param elementToActOn the select element to act on
     * @param actionOutcome pass-by-reference for the nested success and result variables in the main
     *                       performActionFromController method
     * @returns the value of the option that was actually selected, or undefined if none was selected
     */
    performSelectAction = (valueForAction: string | undefined, elementToActOn: HTMLElement,
                           actionOutcome: ActionOutcome): string | undefined => {
        let selectedOptVal: string | undefined;
        const tagName = elementToActOn.tagName.toLowerCase();
        this.logger.trace("entered SELECT action branch");
        if (valueForAction === undefined) {
            this.logger.warn("no value provided for SELECT action; rejecting action");
            actionOutcome.result += "; no value provided for SELECT action, so cannot perform it";
        } else if (tagName !== "select") {
            this.logger.warn("SELECT action given for non <select> element; rejecting action");
            actionOutcome.result += "; SELECT action given for non <select> element, so cannot perform it";
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
                actionOutcome.result += `; failed to select any option similar to the given value`;
            }
        }
        return selectedOptVal;
    }

    /**
     * Method that performs the 'SCROLL_UP' or 'SCROLL_DOWN' action on the page.
     * @param actionToPerform the type of scroll action to perform
     * @param actionOutcome pass-by-reference for the nested success and result variables in the main
     *                       performActionFromController method
     */
    performScrollAction = async (actionToPerform: Action, actionOutcome: ActionOutcome): Promise<void> => {
        const docElement = this.domWrapper.getDocumentElement();
        const viewportHeight = docElement.clientHeight;
        const scrollAmount = viewportHeight * 0.90;
        const scrollVertOffset = actionToPerform === Action.SCROLL_UP ? -scrollAmount : scrollAmount;
        const priorVertScrollPos = this.domWrapper.getVertScrollPos();
        this.logger.trace(`scrolling page by ${scrollVertOffset}px from starting vertical position ${priorVertScrollPos}px`);
        this.domWrapper.scrollBy(0, scrollVertOffset);
        await sleep(500);//don't want to measure the post-scroll position before the scroll animation concludes
        const postVertScrollPos = this.domWrapper.getVertScrollPos();
        if (priorVertScrollPos != postVertScrollPos) {
            actionOutcome.success = true;
            const actualVertOffset = postVertScrollPos - priorVertScrollPos;
            actionOutcome.result +=
                `; scrolled page by ${Math.abs(actualVertOffset).toFixed(1)}px ${actualVertOffset < 0 ? "up" : "down"}`;
        } else {
            this.logger.warn(`scroll action failed to move the viewport's vertical position from ${priorVertScrollPos}px`)
            actionOutcome.result += `; scroll action failed to move the viewport's vertical position from ${priorVertScrollPos.toFixed(1)}px`;
        }
    }

    /**
     * Method that performs the 'PRESS_ENTER' action on whatever element is focused in the page.
     * @param actionOutcome pass-by-reference for the nested success and result variables in the main
     *                       performActionFromController method
     * @param targetElementDesc a description of the element that the Enter key event is being sent to
     */
    performPressEnterAction = async (actionOutcome: ActionOutcome,
                                     targetElementDesc: string): Promise<void> => {
        this.logger.trace(`about to press Enter on ${targetElementDesc}`);
        const activeElem = this.browserHelper.findRealActiveElement();
        if (activeElem === null) {
            actionOutcome.success = false;
            actionOutcome.result += "; no element is currently focused in the tab";
            return;
        } else {
            this.logger.debug(`active element is a ${activeElem.tagName} at xpath: ${this.browserHelper.getFullXpath(activeElem)}`);
        }

        try {
            const resp = await this.chromeWrapper.sendMessageToServiceWorker({reqType: PageRequestType.PRESS_ENTER});
            if (resp.success) {
                this.logger.trace(`pressed Enter on ${targetElementDesc}`);
                actionOutcome.success = true;
            } else {
                actionOutcome.result += "; " + resp.message;
                actionOutcome.success = false;
            }
        } catch (error: any) {
            actionOutcome.success = false;
            actionOutcome.result += "; error while asking service worker to press enter: " + error;
        }
    }

    /**
     * Method that hovers over the element at the given x,y coordinates in the page.
     * @param actionOutcome pass-by-reference for the nested success and result variables in the main
     *                       performActionFromController method
     * @param xOfElem the x-coordinate of the element to hover over (css pixels from left edge of view port)
     *                  usually the center of the element's bounding box
     * @param yOfElem the y-coordinate of the element to hover over (css pixels from top of viewport)
     *                  usually the center of the element's bounding box
     */
    performHoverAction = async (actionOutcome: ActionOutcome, xOfElem: number, yOfElem: number): Promise<void> => {
        //todo add functionality to this class which always keeps track of the current position of the user's cursor
        // (see beginning of this post https://stackoverflow.com/a/6486344/10808625)
        // and then this code can test whether the mouse cursor is within the viewport. if so, it should log a warning,
        // skip the message-sending, and set actionOutcome.success to false

        this.logger.trace(`about to hover over element at ${xOfElem},${yOfElem}`);
        try {
            const resp = await this.chromeWrapper.sendMessageToServiceWorker(
                {reqType: PageRequestType.HOVER, x: xOfElem, y: yOfElem});
            if (resp.success) {
                this.logger.trace(`hovered over element at ${xOfElem},${yOfElem}`);
                actionOutcome.success = true;
            } else {
                actionOutcome.result += "; " + resp.message;
                actionOutcome.success = false;
            }
        } catch (error: any) {
            actionOutcome.success = false;
            actionOutcome.result += `; error while asking service worker to hover over element at ${xOfElem},${yOfElem}: ${error}`;
        }
    }


    /**
     * Method that performs the action specified in the message received from the background script, then notifies
     * the background script of the outcome of the action (unless the action caused a page navigation in the current
     * tab, in which case the current page's content script would be terminated before it could send the outcome,
     * but the background script would be notified separately of the disconnection).
     * @param message the message received from the background script that describes the action to perform
     */
    performActionFromController = async (message: any): Promise<void> => {
        if (!this.interactiveElements) {
            this.logger.error("perform-action message received from background script but no interactive elements are currently stored");
            this.portToBackground.postMessage({
                    type: Page2AgentControllerPortMsgType.TERMINAL,
                    error: "no interactive elements stored to be acted on"
                });
            return;
        }
        const actionToPerform: Action = message.action;
        const valueForAction: string | undefined = message.value;

        const elementIndexValid = (typeof message.elementIndex === "number") && message.elementIndex < this.interactiveElements.length;
        const actionOutcome: ActionOutcome = {
            success: false, result: buildGenericActionDesc(actionToPerform,
                elementIndexValid ? this.interactiveElements[message.elementIndex] : undefined, valueForAction)
        };

        //maybe get current time and current this.lastPageModificationTimestamp and, if they're too close,
        // ignore the head/body mutation observers for this action and log a warning with as much info as possible
        // (on the theory that the current page's js is unstable and makes incessant updates to the dom, so the
        // broad-coverage mutation observers don't tell us whether the page is basically stable in practice)
        // Maybe only do that if there's a very short difference there for 2 actions in a row on the same page

        if (elementIndexValid) {
            const elementToActOnData = this.interactiveElements[message.elementIndex];
            const elementToActOn = elementToActOnData.element;
            /*
            todo consider implementing in js a conditional polling/wait for 'stability'
             https://playwright.dev/docs/actionability#stable
             note that a given action type would only need some of the actionability checks
             https://playwright.dev/docs/actionability#introduction
             above goals for conditional polling/waiting could be one (or a few) helper methods
             This might be redundant with the wait for overall page stability _after_ each action
             */

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
                this.typeIntoElement(elementToActOn, valueForAction, actionOutcome);
            } else if (actionToPerform === Action.PRESS_ENTER) {
                elementToActOn.focus();
                //if sleep proves unreliable or unacceptably slow, explore a conditional poll/wait approach to ensure
                // the element is focused before we send the Enter key event
                await sleep(50);
                await this.performPressEnterAction(actionOutcome, "a particular element");
            } else if (actionToPerform === Action.SELECT) {
                this.performSelectAction(valueForAction, elementToActOn, actionOutcome);
            } else if (actionToPerform === Action.HOVER) {
                const elemBox = elementToActOnData.boundingBox;
                const elemCenterX: number = (elemBox.tLx + elemBox.bRx) / 2;
                const elemCenterY: number = (elemBox.tLy + elemBox.bRy) / 2;
                await this.performHoverAction(actionOutcome, elemCenterX, elemCenterY);
            } else {
                this.logger.warn("action type not supported for a specific element: " + actionToPerform);
                actionOutcome.result += "; action type not supported for a specific element: " + actionToPerform;
            }

        } else {
            if (actionToPerform === Action.SCROLL_UP || actionToPerform === Action.SCROLL_DOWN) {
                await this.performScrollAction(actionToPerform, actionOutcome);
            } else if (actionToPerform === Action.PRESS_ENTER) {
                await this.performPressEnterAction(actionOutcome, "whatever element had focus in the tab")
            } else {
                //The TERMINATE action is handled in the background script
                this.logger.warn("no element index provided in message from background script; can't perform action "
                    + actionToPerform);
                actionOutcome.result += "; no element index provided in message from background script; can't perform action "
                    + actionToPerform;
            }
        }

        const shouldAbort = await this.waitForPageStable("notify background script of action outcome");
        if (shouldAbort) {return;}

        this.interactiveElements = undefined;
        //this part would only be reached if the action didn't cause page navigation in current tab

        try {
            this.portToBackground.postMessage({
                type: Page2AgentControllerPortMsgType.ACTION_DONE, success: actionOutcome.success,
                result: actionOutcome.result
            });
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                this.logger.info("service worker disconnected from content script while content script was performing action (task was probably terminated by user)");
            } else {
                this.logger.error(`unexpected error in content script while notifying service worker about performed action; error: ${renderUnknownValue(error)}`);
            }
        }
    }

    highlightCandidateElement = async (message: any): Promise<void> => {
        if (!this.interactiveElements) {
            this.logger.error("highlight-candidate-element message received from background script but no interactive elements are currently stored");
            this.portToBackground.postMessage({
                    type: Page2AgentControllerPortMsgType.TERMINAL,
                    error: "no interactive elements stored to be highlighted"
                });
            return;
        } else if ((typeof message.elementIndex !== "number") || message.elementIndex >= this.interactiveElements.length) {
            this.logger.error("highlight-candidate-element message received from background script but element index is invalid");
            this.portToBackground.postMessage(
                {type: Page2AgentControllerPortMsgType.TERMINAL, error: "invalid element index provided to highlight"});
            return;
        }

        let elementToActOn: HTMLElement;
        if (message.elementIndex) {
            const elementToActOnData = this.interactiveElements[message.elementIndex];
            elementToActOn = elementToActOnData.element;
        } else {
            const focusedElement = this.browserHelper.findRealActiveElement();
            if (focusedElement !== null) {
                elementToActOn = focusedElement;
            } else {
                this.logger.warn("highlight-candidate-element message received from background script but no element was specified to be highlighted, and no element is currently focused");
                return;//the later attempt to actually perform the action will fail, so no need to notify the background script
            }
        }

        await this.browserHelper.highlightElement(elementToActOn.style);

        try {
            const resp = await this.chromeWrapper.sendMessageToServiceWorker({
                reqType: PageRequestType.SCREENSHOT_WITH_TARGET_HIGHLIGHTED,
                promptingIndexForAction: message.promptingIndexForAction
            });
            if (resp.success) {
                this.logger.trace("successfully got service worker to take screenshot after target element was highlighted")
            } else {
                this.logger.error("failed to get service worker to take screenshot after target element was highlighted; response message: " + resp.message);
            }
        } catch (error: any) {
            this.logger.error(`error in content script while notifying service worker about highlighting of targeted element (requesting screenshot); error: ${renderUnknownValue(error)}`);
        }
    }

    /**
     * Method that handles messages received from the agent controller in the background script.
     * @param message the message received from the agent controller
     */
    handleRequestFromAgentController = async (message: any): Promise<void> => {
        this.logger.trace(`message received from agent controller: ${JSON.stringify(message)
            .slice(0, 100)} by page ${document.URL}`);
        this.hasControllerEverResponded = true;
        if (message.type === AgentController2PagePortMsgType.REQ_PAGE_STATE) {
            if (message.isMonitorRetry) {this.interactiveElements = undefined;}
            this.getPageInfoForController();
        } else if (message.type === AgentController2PagePortMsgType.REQ_ACTION) {
            await this.performActionFromController(message);
        } else if (message.type === AgentController2PagePortMsgType.HIGHLIGHT_CANDIDATE_ELEM) {
            await this.highlightCandidateElement(message);
        } else {
            this.logger.warn(`unknown message from agent controller: ${JSON.stringify(message)}`);
        }
    }


    waitForPageStable = async (reasonForWait: string): Promise<boolean> => {
        const startOfPostActionStabilityWait = Date.now();
        const initialWait = 1000;//ms,
        const pollingIncrement = 100;//ms
        const maxPollingTime = 10_000;//ms
        const numPollingIterations = (maxPollingTime - initialWait) / pollingIncrement;

        let didPageRegisterStartOfUnload = false;
        // needed because sometimes weird things happen like unload event not firing for 540+ms after you pressed enter
        await sleep(initialWait);
        for (let i = 0; i < numPollingIterations; i++) {

            if (this.isPageBeingUnloaded) {
                this.logger.info(`page is being unloaded; will probably not try to ${reasonForWait}`);
                didPageRegisterStartOfUnload = true;
            }
            const currTime = Date.now();
            if (currTime - this.lastPageModificationTimestamp > pollingIncrement) {
                this.logger.debug(`page has been stable for at least ${pollingIncrement}ms; will ${reasonForWait}`);
                break;
            }
            await sleep(pollingIncrement);
        }
        if (didPageRegisterStartOfUnload) {
            //sometimes the page registers an 'unload' event but isn't actually going to unload
            // (e.g. clicking a 'write email' link which causes the OS to open a pop-up for choosing how to handle it)
            await sleep(initialWait);
            //todo test whether this extra logic is relevant
            const isCurrentTabStillActive = this.domWrapper.getVisibilityState() === "visible";
            if (isCurrentTabStillActive) {
                this.logger.info(`while waiting before ${reasonForWait}, there was a signal that the page was unloading, but the page didn't actually unload; continuing to ${reasonForWait}`);
            } else {
                this.logger.info(`while waiting before ${reasonForWait}, there was a signal that the page was unloading, and it turned out that focus shifted to a new tab while the existing page was left in the old tab; old tab's content script is no longer relevant, so will not ${reasonForWait}`);
                return true;
            }
        }

        this.logger.debug(`waited ${(Date.now() - startOfPostActionStabilityWait)}ms for page to become stable before ${reasonForWait}`);
        return false;
    }

}