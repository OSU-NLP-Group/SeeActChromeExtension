import {createNamedLogger} from "./utils/shared_logging_setup";
import {Page2BackgroundPortMsgType, pageToControllerPort, renderUnknownValue, sleep} from "./utils/misc";
import {PageActor} from "./utils/PageActor";


const logger = createNamedLogger('agent-page-interaction', false);
logger.trace(`successfully injected page_interaction script in browser for page ${document.URL}`);

//todo revisit safe way to make different tabs' ports distinguishable by name (putting url in wasn't accepted by chrome)
const portToBackground: chrome.runtime.Port = chrome.runtime.connect({name: pageToControllerPort});

const pageActor = new PageActor(portToBackground);
portToBackground.onMessage.addListener(pageActor.handleRequestFromAgentController);

window.addEventListener('beforeunload', () => {
    pageActor.isPageBeingUnloaded = true;
});

const mutationObserverOptions = {childList: true, subtree: true, attributes: true, characterData: true};
const mutationCallback = (mutationsList: MutationRecord[], observer: MutationObserver) => {
    //filtering logic would go here if I identify problematic patterns where mutations are happening in the dom
    // which don't affect what elements the agent can interact with, whether/how those elements are displayed, or
    // other information on the page which would be important for the agent's next decision
    pageActor.lastPageModificationTimestamp = Date.now();
}

const headMutationObserver = new MutationObserver(mutationCallback);
headMutationObserver.observe(document.head, mutationObserverOptions);

const bodyMutationObserver = new MutationObserver(mutationCallback);
bodyMutationObserver.observe(document.body, mutationObserverOptions);
//if there's a substantial general performance impact, it might be worth exploring the idea of keeping the head/body
// mutation observers disconnected most of the time but reconnecting them after an action to allow waiting until
// the page became stable

const startOfPageLoadWait = Date.now();
window.addEventListener('load', async () => {
    logger.debug('page has loaded, sending READY message to background');
    await sleep(20);//just in case page loaded super-quickly and the service worker was delayed in setting up the port's listeners
    logger.debug(`length of page load wait: ${(Date.now() - startOfPageLoadWait)}ms`);
    try {
        portToBackground.postMessage({type: Page2BackgroundPortMsgType.READY});
    } catch (error: any) {
        logger.error(`error sending READY message to background: ${renderUnknownValue(error)}`);
    }
});

(async () => {
    await sleep(1000);
    if (!pageActor.hasControllerEverResponded) {
        logger.info("sending backup ready message to background because controller hasn't responded yet");
        try {
            portToBackground.postMessage({type: Page2BackgroundPortMsgType.READY});
        } catch (error: any) {
            logger.error(`error sending backup READY message to background: ${renderUnknownValue(error)}`);
        }
    }
})();