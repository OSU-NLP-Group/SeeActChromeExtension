import {createNamedLogger} from "./utils/shared_logging_setup";
import {
    expectedMsgForPortDisconnection, Page2AnnotationCoordinatorPortMsgType,
    pageToAnnotationCoordinatorPort, renderUnknownValue, sleep
} from "./utils/misc";
import {PageDataCollector} from "./utils/PageDataCollector";

const logger = createNamedLogger('page-data-collection', false);
logger.trace(`successfully injected page_data_collection script in browser for page ${document.URL}`);

const portIdentifier = pageToAnnotationCoordinatorPort + "_page_title_" + document.title.replace(/[^a-zA-Z0-9]/g, '_');
logger.debug(`port identifier for page data collection is ${portIdentifier}`);
const portToBackground: chrome.runtime.Port = chrome.runtime.connect({name: portIdentifier});

const dataCollector = new PageDataCollector(portToBackground);
portToBackground.onMessage.addListener(dataCollector.handleRequestFromAnnotationCoordinator);

dataCollector.setupMouseMovementTracking();

(async () => {
    await sleep(50);//make sure coordinator has added its listeners before sending READY message

    try {
        portToBackground.postMessage({type: Page2AnnotationCoordinatorPortMsgType.READY});
    } catch (error: any) {
        if ('message' in error && error.message === expectedMsgForPortDisconnection) {
            logger.info("annotation coordinator disconnected port before READY message could be sent");
        } else {
            logger.error(`error sending READY message to annotation coordinator: ${renderUnknownValue(error)}`);
        }
    }
})();





