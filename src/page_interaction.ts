import {createNamedLogger} from "./utils/shared_logging_setup";
import {
    renderUnknownValue,
    sleep
} from "./utils/misc";
import {PageActor} from "./utils/PageActor";
import {
    expectedMsgForPortDisconnection,
    Page2AgentControllerPortMsgType,
    pageToControllerPort
} from "./utils/messaging_defs";


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

let bodyMutationObserver: MutationObserver | undefined;

if (document.body) {
    bodyMutationObserver = new MutationObserver(mutationCallback);
    bodyMutationObserver.observe(document.body, mutationObserverOptions);
}
//note for later - the above as written probably doesn't work for detecting changes inside the bodies of iframes that're
// in the top-level document, let alone iframes that are inside other iframes
// Maybe build an IframeTree here, then set up mutation observers on the head and body of each iframe in the tree
//  if a given iframe has non-zero dimensions and passes _basic_ visibility checks; need to add iteration over the tree

portToBackground.onDisconnect.addListener(() => {
    logger.info("content script experienced a port disconnect from agent controller, terminating ongoing monitoring process for page state changes");
    if (bodyMutationObserver) {bodyMutationObserver.disconnect();}
});


const startOfPageLoadWait = Date.now();
let didLoadFire = false;
let wasReadyMsgSent = false;

async function notifyControllerOnceLoadedPageIsStable() {
    didLoadFire = true;
    logger.trace(`load event fired for page with port ${portIdentifier}`);

    const shouldAbort = await pageActor.waitForPageStable("notify background script that content script finished loading");
    if (shouldAbort) {return;}

    logger.trace('page has loaded and become stable, sending READY message to background');
    await sleep(20);//just in case page loaded super-quickly and the service worker was delayed in setting up the port's listeners
    logger.debug(`total length of page load wait: ${(Date.now() - startOfPageLoadWait).toFixed(5)}ms`);
    if (wasReadyMsgSent) {
        logger.warn("READY message was already sent to background by the time the page became stable, not sending it again");
        return;
    }
    try {
        portToBackground.postMessage({type: Page2AgentControllerPortMsgType.READY});
        wasReadyMsgSent = true;
    } catch (error: any) {
        logger.error(`error sending READY message to background: ${renderUnknownValue(error)}`);
    }
}

(async () => {
    if (document.readyState === 'complete') {
        await notifyControllerOnceLoadedPageIsStable();
    } else {
        window.addEventListener('load', async () => {
            await notifyControllerOnceLoadedPageIsStable();
        });
    }

    await sleep(10_000);
    if (!pageActor.hasControllerEverResponded && !didLoadFire && !wasReadyMsgSent) {
        logger.info("sending backup ready message to background because controller hasn't responded yet and load event hasn't fired (probably it fired before this content script set up a listener for it)");
        try {
            portToBackground.postMessage({type: Page2AgentControllerPortMsgType.READY});
            wasReadyMsgSent = true;
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                logger.info("background disconnected port before backup READY message could be sent");
            } else {
                logger.error(`error sending backup READY message to background: ${renderUnknownValue(error)}`);
            }
        }
    }
})();