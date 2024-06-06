import {createNamedLogger} from "./utils/shared_logging_setup";
import {Page2BackgroundPortMsgType, pageToControllerPort, renderUnknownValue, sleep} from "./utils/misc";
import {PageActor} from "./utils/PageActor";


const logger = createNamedLogger('agent-page-interaction', false);
logger.trace(`successfully injected page_interaction script in browser for page ${document.URL}`);

//todo revisit safe way to make different tabs' ports distinguishable by name (putting url in wasn't accepted by chrome)
const portToBackground: chrome.runtime.Port = chrome.runtime.connect({name: pageToControllerPort});

const pageActor = new PageActor(portToBackground);


portToBackground.onMessage.addListener(pageActor.handleRequestFromAgentController);

window.addEventListener('load', async () => {
    logger.debug('page has loaded, sending READY message to background');
    await sleep(20);//just in case page loaded super-quickly and the service worker was delayed in setting up the port's listeners
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