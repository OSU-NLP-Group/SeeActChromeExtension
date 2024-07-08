import {createNamedLogger} from "./utils/shared_logging_setup";
import {
    expectedMsgForPortDisconnection,
    Page2BackgroundPortMsgType,
    pageToControllerPort,
    renderUnknownValue,
    sleep
} from "./utils/misc";
import {PageActor} from "./utils/PageActor";


const logger = createNamedLogger('agent-page-interaction', false);
logger.trace(`successfully injected page_interaction script in browser for page ${document.URL}`);

const portIdentifier = pageToControllerPort + "_page_title_" + document.title.replace(/[^a-zA-Z0-9]/g, '_');
const portToBackground: chrome.runtime.Port = chrome.runtime.connect({name: portIdentifier});

const pageActor = new PageActor(portToBackground);
portToBackground.onMessage.addListener(pageActor.handleRequestFromAgentController);

window.addEventListener('beforeunload', () => {
    logger.info("page is being unloaded, setting isPageBeingUnloaded flag to true");
    pageActor.isPageBeingUnloaded = true;
});

const mutationObserverOptions = {childList: true, subtree: true, attributes: true, characterData: true};
//eslint-disable-next-line @typescript-eslint/no-unused-vars -- the observer and records are not used in the callback, but they might be relevant later
const mutationCallback = (mutationsList: MutationRecord[], observer: MutationObserver) => {
    //filtering logic would go here if I identify problematic patterns where mutations are happening in the dom
    // which don't affect what elements the agent can interact with, whether/how those elements are displayed, or
    // other information on the page which would be important for the agent's next decision
    pageActor.lastPageModificationTimestamp = Date.now();
}

const headMutationObserver = new MutationObserver(mutationCallback);
headMutationObserver.observe(document.head, mutationObserverOptions);

if (document.body) {
    const bodyMutationObserver = new MutationObserver(mutationCallback);
    bodyMutationObserver.observe(document.body, mutationObserverOptions);
}

const startOfPageLoadWait = Date.now();
let didLoadFire = false;
window.addEventListener('load', async () => {
    didLoadFire = true;

    const shouldAbort = await pageActor.waitForPageStable("notify background script that content script finished loading");
    if (shouldAbort) {return;}

    logger.debug('page has loaded, sending READY message to background');
    await sleep(20);//just in case page loaded super-quickly and the service worker was delayed in setting up the port's listeners
    logger.debug(`total length of page load wait: ${(Date.now() - startOfPageLoadWait)}ms`);
    try {
        portToBackground.postMessage({type: Page2BackgroundPortMsgType.READY});
    } catch (error: any) {
        logger.error(`error sending READY message to background: ${renderUnknownValue(error)}`);
    }
});

(async () => {
    await sleep(2000);
    if (!pageActor.hasControllerEverResponded && !didLoadFire) {
        logger.info("sending backup ready message to background because controller hasn't responded yet and load event hasn't fired (probably it fired before this content script set up a listener for it)");
        try {
            portToBackground.postMessage({type: Page2BackgroundPortMsgType.READY});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                logger.info("background disconnected port before backup READY message could be sent");
            } else {
                logger.error(`error sending backup READY message to background: ${renderUnknownValue(error)}`);
            }
        }
    }
})();