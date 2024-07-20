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


logger.trace("adding event listener for mousemove");
//todo clean up commented-out junk (here and in PageDataCollector) after recording the attempts in vc

// let limitCounter = 0;
document.addEventListener('mousemove', (e) => {
    // limitCounter++;
    // if (limitCounter % 1) { logger.trace(`mouse moved to ${e.clientX}, ${e.clientY}`); }
    //logger.trace(`mouse moved to ${e.clientX}, ${e.clientY}`);
    dataCollector.mouseClientX = e.clientX;
    dataCollector.mouseClientY = e.clientY;
});
// let limitCounter2 = 0;
/*
document.addEventListener('mouseover', (e) => {
    // limitCounter2++;
    // if (limitCounter2 % 1) { logger.trace(`mouse over event triggered at ${e.clientX}, ${e.clientY}`); }
    logger.trace(`mouse over event triggered at ${e.clientX}, ${e.clientY}`);
    dataCollector.mouseClientX = e.clientX;
    dataCollector.mouseClientY = e.clientY;
});
*/




(async () => {
    await sleep(100);//try to let mouse position be determined from movement

/*
    if (dataCollector.mouseClientX === -1 && dataCollector.mouseClientY === -1) {
        logger.info("mouse position not determined from movement within 5 milliseconds of content script injection, trying to get mouse position from exhaustive search for :hover pseudo class");
        dataCollector.findMousePositionFromHoverPseudoClass();
    }
*/

    try {
        portToBackground.postMessage({type: Page2AnnotationCoordinatorPortMsgType.READY});
    } catch (error: any) {
        if ('message' in error && error.message === expectedMsgForPortDisconnection) {
            logger.info("annotation coordinator disconnected port before READY message could be sent");
        } else {
            logger.error(`error sending READY message to annotation coordinator: ${renderUnknownValue(error)}`);
        }
    }

    await sleep(2000);
    if (!dataCollector.hasCoordinatorEverResponded) {
        logger.info("sending backup ready message to annotation coordinator because annotation coordinator hasn't responded yet");
        try {
            portToBackground.postMessage({type: Page2AnnotationCoordinatorPortMsgType.READY});
        } catch (error: any) {
            if ('message' in error && error.message === expectedMsgForPortDisconnection) {
                logger.info("annotation coordinator disconnected port before backup READY message could be sent");
            } else {
                logger.error(`error sending backup READY message to annotation coordinator: ${renderUnknownValue(error)}`);
            }
        }
    }
})();






