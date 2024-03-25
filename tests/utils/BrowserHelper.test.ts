import {BrowserHelper, DomHelper} from "../../src/utils/BrowserHelper";
import {JSDOM} from "jsdom";


describe('BrowserHelper.removeAndCollapseEol', () => {
    const {window} = new JSDOM(`<!DOCTYPE html><body></body>`);
    const domHelper = new DomHelper(window);
    const browserHelper = new BrowserHelper(domHelper);

    it("shouldn't affect a string with no newlines and no consecutive whitespace chars", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello world")).toBe("hello world");
    });

    it("should replace newlines with spaces", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello\nworld")).toBe("hello world");
    });

    it("should replace multiple consecutive whitespace chars with a single space", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello\n\n\nworld, I'm \tZoe")).toBe("hello world, I'm Zoe");
    });

});

describe('BrowserHelper.getFirstLine', () => {
    const {window} = (new JSDOM(`<!DOCTYPE html><body></body>`));
    const domHelper = new DomHelper(window);
    const browserHelper = new BrowserHelper(domHelper);

    it("should return a short single-line string unchanged", () => {
        expect(browserHelper.getFirstLine("hello world")).toBe("hello world");
    });
    it('should truncate a long single line string to 8 segments', () => {
        expect(browserHelper.getFirstLine("hello world, I'm Zoe and I'm a software engineer"))
            .toBe("hello world, I'm Zoe and I'm a software...");
    });
    it('should return the first line of a multi-line string', () => {
        expect(browserHelper.getFirstLine("hello world\nI'm Zoe\nI'm a software engineer"))
            .toBe("hello world");
    });
    it('should truncate a long first line of a multi-line string to 8 segments', () => {
        expect(browserHelper.getFirstLine("Once upon a midnight dreary, while I pondered, weak and weary,\n" +
            "Over many a quaint and curious volume of forgotten lore"))
            .toBe("Once upon a midnight dreary, while I pondered,...");
    });
});


describe('BrowserHelper.getElementDescription', () => {

    it('should describe a select element with its parent and its options', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div class="facets-widget-dropdown">
            <label id="facet_clinic_school_type_label">TYPE</label>  
            <select data-drupal-facet-filter-key="f" data-drupal-facet-id="clinic_school_type" 
                data-drupal-facet-alias="type" data-drupal-facet-ajax="0" 
                class="facet-inactive item-list__dropdown facets-dropdown js-facets-widget js-facets-dropdown" 
                data-once="facets-dropdown-transform js-facet-filter" name="f[]" 
                aria-labelledby="facet_clinic_school_type_label">
                <option value="" >Select Type</option>
                <option value="type:school" class="facets-dropdown" selected="selected"> School (508)</option>
                <option value="type:clinic" class="facets-dropdown"> Clinic (364)</option>
            </select>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("TYPE \nSelect Type\nSchool (508)\nClinic (364)")
            .mockReturnValueOnce('Select Type\nSchool (508)\nClinic (364)');
        //2nd mocking above is just in case something weird happens and the code tries to get innerText of <select>

        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;

        await expect(browserHelper.getElementDescription(selectElement)).resolves
            .toEqual("parent_node: TYPE Selected Options: School (508) - Options: Select Type | School (508) | Clinic (364)");
    });

    it('describes a select with empty default option using textContent', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div class="facets-widget-dropdown">
            <label id="facet_clinic_school_type_label">TYPE</label>  
            <select data-drupal-facet-filter-key="f" data-drupal-facet-id="clinic_school_type" 
                data-drupal-facet-alias="type" data-drupal-facet-ajax="0" 
                class="facet-inactive item-list__dropdown facets-dropdown js-facets-widget js-facets-dropdown" 
                data-once="facets-dropdown-transform js-facet-filter" name="f[]" 
                aria-labelledby="facet_clinic_school_type_label">
                <option value=""></option>
                <option value="type:school" class="facets-dropdown"> School (508)</option>
                <option value="type:clinic" class="facets-dropdown"> Clinic (364)</option>
            </select>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('TYPE \nSchool (508)\nClinic (364)')
            .mockReturnValueOnce('School (508)\nClinic (364)');
        //2nd mocking above is just in case something weird happens and the code tries to get innerText of <select>

        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;

        await expect(browserHelper.getElementDescription(selectElement)).resolves.toEqual("School (508) Clinic (364)");
        //todo highlight to Boyuan how this loses parent node info and also separator between options
    });

    //?select with parent whose first line of innerText is just whitespace
    // and element.options is not populated???? but element.textContent is
    //   Not testing this because, based on 15-20min of research, it doesn't seem like this would be possible.
    //    There's the react-select library that could be used to create a select element with no <option> elements,
    //      but then the tag wouldn't be a <select>

    //?select element whose parent has no innerText
    // and element.options is not populated??? and element.textContent is empty but?? element.innerText is not
    // How is innerText supposed to be non-empty when textContent was empty???
    //   Not testing this because, based on 15-20min of research, it doesn't seem like this would be possible.
    //    There's the react-select library that could be used to create a select element with no <option> elements,
    //      but then the tag wouldn't be a <select>


    it('should describe a textarea with value but no parent-text or textContent, using value & attributes', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
            <textarea class="gLFyf" aria-controls="Alh6id" aria-owns="Alh6id" autofocus="" title="Search" value="" jsaction="paste:puy29d;" aria-label="Search" aria-autocomplete="both" aria-expanded="false" aria-haspopup="false" autocapitalize="off" autocomplete="off" autocorrect="off" id="APjFqb" maxlength="2048" name="q" role="combobox" rows="1" spellcheck="false" data-ved="0ahUKEwjE7tT35I-FAxU3HDQIHeaZBeQQ39UDCA4" style="" aria-activedescendant=""></textarea>
        </body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("").mockReturnValueOnce("");

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLInputElement;
        textareaElement.value = "GPT-4V(ision) is a Generalist Web Agent, if Grounded";//mimicking the user typing into the textarea
        await expect(browserHelper.getElementDescription(textareaElement)).resolves
            .toEqual(`INPUT_VALUE="GPT-4V(ision) is a Generalist Web Agent, if Grounded" aria-label="Search" name="q" title="Search"`);
    });

    it('should describe a link element with just its text content', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="search_header">
        <a class="gb_H" aria-label="Gmail (opens a new tab)" data-pid="23" href="https://mail.google.com/mail/&amp;ogbl" target="_top">Gmail</a>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("Gmail").mockReturnValueOnce('Gmail');

        const linkElement = domHelper.grabElementByXpath("//a") as HTMLElement;
        await expect(browserHelper.getElementDescription(linkElement)).resolves.toEqual(`Gmail`);
    });

    it('describes a textarea element with short text content using value and? textContent', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="site_review">
            <label for="w3review">Review of W3Schools:</label>
            <textarea id="w3review" name="w3review" rows="4" cols="50">
At w3schools.com you 
will learn how to make a website.

:)
</textarea>
            <button id="submit_review" type="submit">Submit</button>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit')
            .mockReturnValueOnce('');//grabbing innerText for a <textarea> element is weird and seems to always return empty string

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLElement;
        await expect(browserHelper.getElementDescription(textareaElement)).resolves
            .toEqual(`INPUT_VALUE="At w3schools.com you \nwill learn how to make a website.\n\n:)\n" At w3schools.com you will learn how to make a website. :)`);
        //problem is that it duplicates the text b/c of how <textarea>'s value _property_ works at runtime (and doesn't 'clean' the input value)
        // todo ask Boyuan whether this (textArea with initial textContent value in the raw html) is rare enough to ignore or if behavior should change
    });

    it('describes a textarea element with no value but long text content as generic element ' +
        '(because innerText isn\'t defined for textarea', async () => {
        const {window} = (new JSDOM(`<!DOCTYPE html><body>
        <div id="site_review">
            <label for="w3review">Review of W3Schools:</label>
            <textarea id="w3review" name="w3review" rows="4" cols="50">
            At w3schools.com you 
            will learn how  to make a website.
            
            :)
            More text here, on and on and on.
            </textarea>
            <button id="submit_review" type="submit">Submit</button>
        </div></body>`));
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit')
            .mockReturnValueOnce('');//grabbing innerText for a <textarea> element is weird and seems to always return empty string

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLInputElement;
        textareaElement.value = "";//mimicking the user wiping the contents of the textarea
        await expect(browserHelper.getElementDescription(textareaElement)).resolves
            .toEqual(`INPUT_VALUE="" parent_node: Review of W3Schools: Submit name="w3review"`);
    });

    it('describes an input element with a value but no text content', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="search_bar" role="search">
            <input placeholder="Search or add a post..." id="search-box" name="post-search" class="form-control" value="hirsch">
            <button id="clearSearchButtonId" aria-label="Clear" role="button" type="button" class="close btn btn-link">
                <span aria-hidden="true">x</span></button>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce(" x").mockReturnValueOnce("");

        const inputElement = domHelper.grabElementByXpath("//input") as HTMLElement;
        await expect(browserHelper.getElementDescription(inputElement)).resolves
            .toEqual(`INPUT_VALUE="hirsch" parent_node: x name="post-search" placeholder="Search or add a post..." value="hirsch"`);
        //todo ask Boyuan whether the duplication of the value attribute should be fixed
    });

    it('should describe an input element with a parent but no value or text content', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div class="c-form-item c-form-item--text       c-form-item--id-keyword js-form-item js-form-type-textfield js-form-item-keyword">
            <label for="edit-keyword" class="c-form-item__label">Search</label>
            <input placeholder="Search (by City/Location, Zip Code or Name)" data-drupal-selector="edit-keyword" 
            type="text" id="edit-keyword" name="keyword" value="" size="30" maxlength="128" class="c-form-item__text">
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("Search ").mockReturnValueOnce("");

        const inputElement = domHelper.grabElementByXpath("//input") as HTMLElement;
        await expect(browserHelper.getElementDescription(inputElement)).resolves
            .toEqual(`INPUT_VALUE="" parent_node: Search name="keyword" placeholder="Search (by City/Location, Zip Code or Name)"`);
    });

    it('should describe a div element with no parent text or text content or relevant attributes but a child with relevant attributes', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="files_downloads">
        <div id="download_button" role="button">
            <svg class="icon icon-download" aria-label="Download document">
            <use href="#icon-download"></use></svg>
        </div></div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("").mockReturnValueOnce("");

        const divElementWithChild = domHelper.grabElementByXpath(`//*[@id="download_button"]`) as HTMLElement;
        await expect(browserHelper.getElementDescription(divElementWithChild)).resolves
            .toEqual(`aria-label="Download document"`);
    });
});

describe('BrowserHelper.getElementData', () => {

    it('should return null if the element is hidden', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="search_header">
        <a class="gb_H" hidden="hidden" aria-label="Gmail (opens a new tab)" data-pid="23" href="https://mail.google.com/mail/&amp;ogbl" target="_top">Gmail</a>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.calcIsHidden = jest.fn().mockReturnValueOnce(true);
        const linkElement = domHelper.grabElementByXpath("//a") as HTMLElement;
        await expect(browserHelper.getElementData(linkElement)).resolves.toBeNull();
    });

    it('should return null if the element is disabled', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="site_review">
            <label for="w3review">Review of W3Schools:</label>
            <textarea id="w3review" name="w3review" rows="4" cols="50">
            At w3schools.com you will learn how to make a website.
            </textarea>
            <button id="submit_review" type="submit" disabled="disabled">Submit</button>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.calcIsHidden = jest.fn().mockReturnValueOnce(false);
        const submitButton = domHelper.grabElementByXpath("//button") as HTMLElement;
        await expect(browserHelper.getElementData(submitButton)).resolves.toBeNull();
    });

    it('should assemble element data if the element has role and type defined', async () => {


        //todo
    });

    it('should assemble element data if the element has role defined', async () => {


        //todo
    });

    it('should assemble element data if element has type defined', async () => {


        //todo
    });

    it('should assemble element data if element has neither role nor type defined', async () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="site_review">
            <label for="w3review">Review of W3Schools:</label>
            <textarea id="w3review" name="w3review" rows="4" cols="50">
At w3schools.com you 
will learn how to make a website.

:)
</textarea>
            <button id="submit_review" type="submit">Submit</button>
        </div></body>`);
        const domHelper = new DomHelper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit')
            .mockReturnValueOnce('');//grabbing innerText for a <textarea> element is weird and seems to always return empty string
        domHelper.calcIsHidden = jest.fn().mockReturnValueOnce(false);
        const boundingBox = {
            height: 66.4000015258789, width: 388.8000183105469, x: 160.1374969482422, y: 8
        };//based on actually putting this html in a file, opening in browser, and inspecting the element with dev console
        // as with other mock return value in this file, aside from the calcIsHidden calls
        domHelper.grabClientBoundingRect = jest.fn().mockReturnValueOnce(boundingBox);

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLElement;
        const elementData = await browserHelper.getElementData(textareaElement);
        expect(elementData).not.toBeNull();
        expect(elementData?.centerCoords).toEqual([boundingBox.x + boundingBox.width / 2,
            boundingBox.y + boundingBox.height / 2]);
        expect(elementData?.description).toEqual(`INPUT_VALUE="At w3schools.com you \nwill learn how to make a website.\n\n:)\n" At w3schools.com you will learn how to make a website. :)`)
        expect(elementData?.tagHead).toEqual("textarea");
        expect(elementData?.boundingBox).toEqual([boundingBox.x, boundingBox.y,
            boundingBox.x + boundingBox.width, boundingBox.y + boundingBox.height]);
        expect(elementData?.tagName).toEqual("textarea");
    });
});
