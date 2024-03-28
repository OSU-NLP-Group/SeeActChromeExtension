import {BrowserHelper} from "./utils/BrowserHelper.js";
import {formatChoices, generatePrompt, StrTriple} from "./utils/format_prompts.js";
import {OpenAiEngine} from "./utils/OpenAiEngine.js";

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

const screenshotDataUrl = "";
//todo grab screenshot!!

const planningOutput = await aiEngine.generate(prompts, 0, screenshotDataUrl);

console.log("planning output:", planningOutput);

const groundingOutput = await aiEngine.generate(prompts, 1, screenshotDataUrl, planningOutput);

console.log("grounding output:", groundingOutput);

//todo add logic to click on the element that the model chose


/*
currInteractiveElements.forEach((element) => {
    console.log("element tag head", element.tagHead, "; description:", element.description,
        "; coordinates:", element.centerCoords, "; box:", element.boundingBox, "; tag:", element.tagName);
});
*/
