import {BrowserHelper} from "./utils/BrowserHelper";
import {formatChoices, generatePrompt, postProcessActionLlm, StrTriple} from "./utils/format_prompts";
import {OpenAiEngine} from "./utils/OpenAiEngine";
import {getIndexFromOptionName} from "./utils/format_prompt_utils";

console.log("successfully injected page_interaction script in browser");

const browserHelper = new BrowserHelper();
const currInteractiveElements = browserHelper.getInteractiveElements();

const interactiveChoiceDetails = currInteractiveElements.map<StrTriple>((element) => {
    return [element.tagHead, element.description, element.tagName];
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

const modelName: string = "gpt-4-vision-preview";
const apiKey: string = "PLACEHOLDER";

const aiEngine = new OpenAiEngine(modelName, apiKey);

(async () => {

    console.log("about to request screenshot from service worker; time is", new Date().toISOString());
    const screenshotResponse = await chrome.runtime.sendMessage({reqType: "takeScreenshot"});
    console.log("response received back from service worker; time is", new Date().toISOString(), "; screenshot response:", screenshotResponse);
    const screenshotDataUrl: string = screenshotResponse.screenshot;
    console.assert(screenshotDataUrl !== undefined, "screenshot data url is undefined")
    console.log("screenshot data url (truncated):", screenshotDataUrl.slice(0, 100));

    const planningOutput = await aiEngine.generate(prompts, 0, screenshotDataUrl);

    console.log("planning output:", planningOutput);

    const groundingOutput = await aiEngine.generate(prompts, 1, screenshotDataUrl, planningOutput);

    console.log("grounding output:", groundingOutput);

    const [elementName, actionName, value] = postProcessActionLlm(groundingOutput);
    console.log("suggested action:", actionName, "; value:", value);
    const chosenElementIndex = getIndexFromOptionName(elementName);
    const chosenElement = currInteractiveElements[chosenElementIndex];
    const elementToClick = chosenElement.element;

    console.log("element to click:", chosenElement.tagHead, "; description:", chosenElement.description);

    elementToClick.click();

})();


/*
currInteractiveElements.forEach((element) => {
    console.log("element tag head", element.tagHead, "; description:", element.description,
        "; coordinates:", element.centerCoords, "; box:", element.boundingBox, "; tag:", element.tagName);
});
*/
