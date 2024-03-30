import {BrowserHelper} from "./utils/BrowserHelper";
import {formatChoices, generatePrompt, postProcessActionLlm, StrTriple} from "./utils/format_prompts";
import {OpenAiEngine} from "./utils/OpenAiEngine";
import {getIndexFromOptionName} from "./utils/format_prompt_utils";
import {createNamedLogger} from "./utils/shared_logging_setup";

const logger = createNamedLogger('agent-page-interaction');


logger.trace("successfully injected page_interaction script in browser");

const browserHelper = new BrowserHelper();
const currInteractiveElements = browserHelper.getInteractiveElements();

const interactiveChoiceDetails = currInteractiveElements.map<StrTriple>((element) => {
    return [element.description, element.tagHead, element.tagName];
});

const candidateIds = currInteractiveElements.map((element, index) => {
    if (element.centerCoords[0] != 0 && element.centerCoords[1] != 0) {
        return index;
    } else {
        return undefined;
    }
}).filter(Boolean) as number[];//ts somehow too dumb to realize that filter(Boolean) removes undefined elements

const interactiveChoices = formatChoices(interactiveChoiceDetails, candidateIds);

const prompts = generatePrompt("Pick a random interactive element in the current page which seems even a bit interesting and click on it", [], interactiveChoices);

logger.debug("prompts: " + prompts);

const modelName: string = "gpt-4-vision-preview";
//REMINDER- DO NOT COMMIT ANY NONTRIVIAL EDITS OF THE FOLLOWING LINE
const apiKey: string = "PLACEHOLDER";

const aiEngine = new OpenAiEngine(modelName, apiKey);

(async () => {

    logger.trace("about to request screenshot from service worker; time is " + new Date().toISOString());
    const screenshotResponse = await chrome.runtime.sendMessage({reqType: "takeScreenshot"});
    logger.trace(`response received back from service worker; time is ${new Date().toISOString()}; screenshot response: ${screenshotResponse}`);
    const screenshotDataUrl: string = screenshotResponse.screenshot;
    console.assert(screenshotDataUrl !== undefined, "screenshot data url is undefined")
    logger.debug("screenshot data url (truncated): " + screenshotDataUrl.slice(0, 100));

    const planningOutput = await aiEngine.generateWithRetry(prompts, 0, screenshotDataUrl);

    logger.info("planning output: " + planningOutput);

    const groundingOutput = await aiEngine.generateWithRetry(prompts, 1, screenshotDataUrl, planningOutput);

    logger.info("grounding output: " + groundingOutput);

    const [elementName, actionName, value] = postProcessActionLlm(groundingOutput);
    logger.debug(`suggested action: ${actionName}; value: ${value}`);
    const chosenElementIndex = getIndexFromOptionName(elementName);
    logger.debug(`clicking on the ${chosenElementIndex} entry from the candidates list; which is the ${candidateIds[chosenElementIndex]} element of the original interactiveElements list`);
    const chosenElement = currInteractiveElements[candidateIds[chosenElementIndex]];
    const elementToClick = chosenElement.element;

    logger.debug(`element to click: ${chosenElement.tagHead}; description: ${chosenElement.description}`);

    elementToClick.click();

})();


/*
currInteractiveElements.forEach((element) => {
    console.log("element tag head", element.tagHead, "; description:", element.description,
        "; coordinates:", element.centerCoords, "; box:", element.boundingBox, "; tag:", element.tagName);
});
*/
