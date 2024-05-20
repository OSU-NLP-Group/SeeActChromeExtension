import {createNamedLogger} from "./utils/shared_logging_setup";
import {Page2BackgroundPortMsgType, sleep} from "./utils/misc";
import {PageActor} from "./utils/PageActor";


const logger = createNamedLogger('agent-page-interaction', false);
logger.trace(`successfully injected page_interaction script in browser for page ${document.URL}`);

//todo revisit safe way to make different tabs' ports distinguishable by name (putting url in wasn't accepted by chrome)
const portToBackground: chrome.runtime.Port = chrome.runtime.connect({name: `page-actor-2-agent-controller`});

const pageActor = new PageActor(portToBackground);


portToBackground.onMessage.addListener(pageActor.handleRequestFromAgentController);


//todo use window.onload listener instead of dumb 5sec wait
// but still have the wait-and-conditionally-poll-the-backend, just in case we run this (including attachng an onload
// listener) after the page has already finished loading


//todo! wait here until page is loaded/stable!
await sleep(5000);

portToBackground.postMessage({msg: Page2BackgroundPortMsgType.READY});

await sleep(1000);
if (!pageActor.hasControllerEverResponded) {
    portToBackground.postMessage({msg: Page2BackgroundPortMsgType.READY});
}
