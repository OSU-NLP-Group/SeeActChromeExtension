import {BrowserHelper} from "../../src/utils/BrowserHelper";
import {DOMWindow, JSDOM} from "jsdom";
import {DomWrapper} from "../../src/utils/DomWrapper";
import log from "loglevel";
import {origLoggerFactory} from "../../src/utils/shared_logging_setup";

const testLogger = log.getLogger("browser-test");
testLogger.methodFactory = origLoggerFactory;
testLogger.setLevel("warn");
testLogger.rebuild();

describe('BrowserHelper.calcIsHidden', () => {
    const {window} = (new JSDOM(`<!DOCTYPE html><body></body>`));
    const domWrapper = new DomWrapper(window);
    const browserHelper = new BrowserHelper(domWrapper, testLogger);
    const {document} = window;

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('returns true for element with display set to none', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({display: "none"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with visibility set to hidden', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({visibility: "hidden"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with hidden property true', () => {
        const element = document.createElement('div');
        element.hidden = true;
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with overflow hidden and scrollHeight greater than clientHeight', () => {
        const element = {
            ...document.createElement('div'),
            get scrollHeight() {return 101},
            get clientHeight() {return 100},
        };
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({overflow: "hidden"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with overflow hidden and scrollWidth greater than clientWidth', () => {
        const element = {
            ...document.createElement('div'),
            get scrollWidth() { return 101; },
            get clientWidth() { return 100; },
        };
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({overflow: "hidden"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns false for element with overflow hidden and scrollWidth less than clientWidth and scrollHeight equal to clientHeight', () => {
        const element = {
            ...document.createElement('div'),
            get scrollWidth() { return 100; },
            get clientWidth() { return 101; },
            get scrollHeight() { return 100; },
            get clientHeight() { return 100; },
        };
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({overflow: "hidden"});
        expect(browserHelper.calcIsHidden(element)).toBe(false);
    });

    it('returns false for visible element', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({});
        expect(browserHelper.calcIsHidden(element)).toBe(false);
    });


    it('returns true for element with opacity set to 0', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({opacity: "0"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with height and width set to 0px', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({height: "0px", width: "0px"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns true for element with height set to 50px and width set to 0px', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({height: "50px", width: "0px"});
        expect(browserHelper.calcIsHidden(element)).toBe(true);
    });

    it('returns false for element with height set to 15px and width set to 20px', () => {
        const element = document.createElement('div');
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({height: "15px", width: "20px"});
        expect(browserHelper.calcIsHidden(element)).toBe(false);
    });
});

describe('BrowserHelper.selectOption', () => {

    it('should select an option in a select element by value', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
            <div class="js-form-item form-item js-form-type-select">
                <label for="edit-field-fiscal-unit-academic-org-target-id">Fiscal Unit / Academic ORG</label>
                <select data-drupal-selector="edit-field-fiscal-unit-academic-org-target-id"
        id="edit-field-fiscal-unit-academic-org-target-id" name="field_fiscal_unit_academic_org_target_id"
        class="form-select">
    <option value="All">- Any -</option>
    <option value="1">Aerospace Engineering</option>
    <option value="2">Aviation</option>
    <option value="3" selected="selected">Biomedical Engineering</option>
    <option value="4">Chemical and Biomolecular Engineering</option>
    <option value="5">Civil, Environmental, and Geodetic Engineering</option>
    <option value="6">Computer Science and Engineering</option>
    <option value="7">Electrical and Computer Engineering</option>
    <option value="8">Engineering Administration</option>
    <option value="9">Integrated Systems Engineering</option>
    <option value="10">Materials Science and Engineering</option>
    <option value="11">Mechanical Engineering</option>
</select>
            </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper, testLogger);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('- Any -')
            .mockReturnValueOnce('Aerospace Engineering').mockReturnValueOnce('Aviation')
            .mockReturnValueOnce('Biomedical Engineering')
            .mockReturnValueOnce('Chemical and Biomolecular Engineering')
            .mockReturnValueOnce('Civil, Environmental, and Geodetic Engineering')
            .mockReturnValueOnce('Computer Science and Engineering')
            .mockReturnValueOnce('Electrical and Computer Engineering')
            .mockReturnValueOnce('Engineering Administration')
            .mockReturnValueOnce('Integrated Systems Engineering')
            .mockReturnValueOnce('Materials Science and Engineering')
            .mockReturnValueOnce('Mechanical Engineering')
        ;

        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;
        expect(browserHelper.selectOption(selectElement, "Enginearing Admin")).toEqual("Engineering Administration");
        expect((selectElement as HTMLSelectElement).selectedIndex).toEqual(8);
    });

    it('should select the best option in a select element by partial value, even if that is a middle option', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
            <div class="js-form-item form-item js-form-type-select ">
                <label for="edit-field-fiscal-unit-academic-org-target-id">Fiscal Unit / Academic ORG</label>
                <select data-drupal-selector="edit-field-fiscal-unit-academic-org-target-id"
                        id="edit-field-fiscal-unit-academic-org-target-id" name="field_fiscal_unit_academic_org_target_id"
                        class="form-select">
                    <option value="All">- Any -</option>
                    <option value="1">Aerospace Engineering</option>
                    <option value="2">Aviation</option>
                    <option value="3" selected="selected">Biomedical Engineering</option>
                    <option value="4">Chemical and Biomolecular Engineering</option>
                    <option value="5">Civil, Environmental, and Geodetic Engineering</option>
                </select>
            </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper, testLogger);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('- Any -')
            .mockReturnValueOnce('Aerospace Engineering').mockReturnValueOnce('Aviation')
            .mockReturnValueOnce('Biomedical Engineering')
            .mockReturnValueOnce('Chemical and Biomolecular Engineering')
            .mockReturnValueOnce('Civil, Environmental, and Geodetic Engineering');
        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;
        expect(browserHelper.selectOption(selectElement, "Chemical and Biomolecular Engineering"))
            .toEqual("Chemical and Biomolecular Engineering");
        expect((selectElement as HTMLSelectElement).selectedIndex).toEqual(4);
    });

    it("shouldn't crash when select has no options", () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
            <div class="js-form-item form-item js-form-type-select">
                <label for="edit-field-fiscal-unit-academic-org-target-id">Fiscal Unit / Academic ORG</label>
                <select data-drupal-selector="edit-field-fiscal-unit-academic-org-target-id"
                        id="edit-field-fiscal-unit-academic-org-target-id" name="field_fiscal_unit_academic_org_target_id"
                        class="form-select">
                </select>
            </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper, testLogger);
        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;
        expect(browserHelper.selectOption(selectElement, "Chemical and Biomolecular Engineering"))
            .toBe(undefined);
        expect((selectElement as HTMLSelectElement).selectedIndex).toEqual(-1);
    });

});

describe('BrowserHelper.removeAndCollapseEol', () => {
    const {window} = new JSDOM(`<!DOCTYPE html><body></body>`);
    const domHelper = new DomWrapper(window);
    const browserHelper = new BrowserHelper(domHelper);

    it("shouldn't affect a string with no newlines and no consecutive whitespace chars", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello world")).toBe("hello world");
    });

    it("should replace newlines with spaces", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello\nworld")).toBe("hello world");
    });

    it("should replace multiple consecutive whitespace chars with a single space", () => {
        expect(browserHelper.removeEolAndCollapseWhitespace("hello\n\n\nworld, I'm \tZoe"))
            .toBe("hello world, I'm Zoe");
    });

});

describe('BrowserHelper.getFirstLine', () => {
    const {window} = (new JSDOM(`<!DOCTYPE html><body></body>`));
    const domHelper = new DomWrapper(window);
    const browserHelper = new BrowserHelper(domHelper);

    it("should return a short single-line string unchanged", () => {
        expect(browserHelper.getFirstLine("hello world")).toBe("hello world");
    });
    it('should truncate a long single line string to 8 segments', () => {
        expect(browserHelper.getFirstLine("hello world, I'm Zoe and I'm a software engineer"))
            .toBe("hello world, I'm Zoe and I'm a software...");
    });
    it('should return the first line of a multi-line string', () => {
        expect(browserHelper.getFirstLine("hello world\nI'm Zoe\nI'm a software engineer")).toBe("hello world");
    });
    it('should truncate a long first line of a multi-line string to 8 segments', () => {
        expect(browserHelper.getFirstLine("Once upon a midnight dreary, while I pondered, weak and weary,\n" +
            "Over many a quaint and curious volume of forgotten lore"))
            .toBe("Once upon a midnight dreary, while I pondered,...");
    });
});


describe('BrowserHelper.getElementDescription', () => {

    it('should describe a select element with its parent and its options', () => {
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
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("TYPE \nSelect Type\nSchool (508)\nClinic (364)")
            .mockReturnValueOnce('Select Type\nSchool (508)\nClinic (364)');
        //2nd mocking above is just in case something weird happens and the code tries to get innerText of <select>

        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;

        expect(browserHelper.getElementDescription(selectElement))
            .toEqual("parent_node: TYPE Selected Options: School (508) - Options: Select Type | School (508) | Clinic (364)");
    });

    it('describes a select with empty default option using textContent', () => {
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
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper, testLogger);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('TYPE \nSchool (508)\nClinic (364)')
            .mockReturnValueOnce('School (508)\nClinic (364)');
        //2nd mocking above is just in case something weird happens and the code tries to get innerText of <select>

        const selectElement = domHelper.grabElementByXpath("//select") as HTMLElement;

        expect(browserHelper.getElementDescription(selectElement)).toEqual("School (508) Clinic (364)");
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


    it('should describe a textarea with value but no parent-text or textContent, using value & attributes', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
            <textarea class="gLFyf" aria-controls="Alh6id" aria-owns="Alh6id" autofocus="" title="Search" value="" jsaction="paste:puy29d;" aria-label="Search" aria-autocomplete="both" aria-expanded="false" aria-haspopup="false" autocapitalize="off" autocomplete="off" autocorrect="off" id="APjFqb" maxlength="2048" name="q" role="combobox" rows="1" spellcheck="false" data-ved="0ahUKEwjE7tT35I-FAxU3HDQIHeaZBeQQ39UDCA4" style="" aria-activedescendant=""></textarea>
        </body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("").mockReturnValueOnce("");

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLInputElement;
        textareaElement.value = "GPT-4V(ision) is a Generalist Web Agent, if Grounded";//mimicking the user typing into the textarea
        expect(browserHelper.getElementDescription(textareaElement))
            .toEqual(`INPUT_VALUE="GPT-4V(ision) is a Generalist Web Agent, if Grounded" aria-label="Search" name="q" title="Search"`);
    });

    it('should describe a link element with just its text content', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="search_header">
        <a class="gb_H" aria-label="Gmail (opens a new tab)" data-pid="23" href="https://mail.google.com/mail/&amp;ogbl" target="_top">Gmail</a>
        </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("Gmail").mockReturnValueOnce('Gmail');

        const linkElement = domHelper.grabElementByXpath("//a") as HTMLElement;
        expect(browserHelper.getElementDescription(linkElement)).toEqual(`Gmail`);
    });

    it('describes a textarea element with short text content using value and? textContent', () => {
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
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit').mockReturnValueOnce('');//grabbing innerText for a <textarea> element is weird and seems to always return empty string

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLElement;
        expect(browserHelper.getElementDescription(textareaElement))
            .toEqual(`INPUT_VALUE="At w3schools.com you \nwill learn how to make a website.\n\n:)\n" At w3schools.com you will learn how to make a website. :)`);
        //problem is that it duplicates the text b/c of how <textarea>'s value _property_ works at runtime (and doesn't 'clean' the input value)
        // todo ask Boyuan whether this (textArea with initial textContent value in the raw html) is rare enough to ignore or if behavior should change
    });

    it('describes a textarea element with no value but long text content as generic element ' +
        '(because innerText isn\'t defined for textarea', () => {
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
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper, testLogger);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit').mockReturnValueOnce('');//grabbing innerText for a <textarea> element is weird and seems to always return empty string

        const textareaElement = domHelper.grabElementByXpath("//textarea") as HTMLInputElement;
        textareaElement.value = "";//mimicking the user wiping the contents of the textarea
        expect(browserHelper.getElementDescription(textareaElement))
            .toEqual(`INPUT_VALUE="" parent_node: Review of W3Schools: Submit name="w3review"`);
    });

    it('describes an input element with a value but no text content', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="search_bar" role="search">
            <input placeholder="Search or add a post..." id="search-box" name="post-search" class="form-control" value="hirsch">
            <button id="clearSearchButtonId" aria-label="Clear" role="button" type="button" class="close btn btn-link">
                <span aria-hidden="true">x</span></button>
        </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce(" x").mockReturnValueOnce("");

        const inputElement = domHelper.grabElementByXpath("//input") as HTMLElement;
        expect(browserHelper.getElementDescription(inputElement))
            .toEqual(`INPUT_VALUE="hirsch" parent_node: x name="post-search" placeholder="Search or add a post..." value="hirsch"`);
        //todo ask Boyuan whether the duplication of the value attribute should be fixed
    });

    it('should describe an input element with a parent but no value or text content', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div class="c-form-item c-form-item--text       c-form-item--id-keyword js-form-item js-form-type-textfield js-form-item-keyword">
            <label for="edit-keyword" class="c-form-item__label">Search</label>
            <input placeholder="Search (by City/Location, Zip Code or Name)" data-drupal-selector="edit-keyword" 
            type="text" id="edit-keyword" name="keyword" value="" size="30" maxlength="128" class="c-form-item__text">
        </div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("Search ").mockReturnValueOnce("");

        const inputElement = domHelper.grabElementByXpath("//input") as HTMLElement;
        expect(browserHelper.getElementDescription(inputElement))
            .toEqual(`INPUT_VALUE="" parent_node: Search name="keyword" placeholder="Search (by City/Location, Zip Code or Name)"`);
    });

    it('should describe a div element with no parent text or text content or relevant attributes but a child with relevant attributes', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="files_downloads">
        <div id="download_button" role="button">
            <svg class="icon icon-download" aria-label="Download document">
            <use href="#icon-download"></use></svg>
        </div></div></body>`);
        const domHelper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domHelper);
        domHelper.getInnerText = jest.fn().mockReturnValueOnce("").mockReturnValueOnce("");

        const divElementWithChild = domHelper.grabElementByXpath(`//*[@id="download_button"]`) as HTMLElement;
        expect(browserHelper.getElementDescription(divElementWithChild)).toEqual(`aria-label="Download document"`);
    });
});

describe('BrowserHelper.getElementData', () => {

    it('should return null if the element is hidden', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="search_header">
        <a class="gb_H" hidden="hidden" aria-label="Gmail (opens a new tab)" data-pid="23" href="https://mail.google.com/mail/&amp;ogbl" target="_top">Gmail</a>
        </div></body>`);
        const domWrapper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domWrapper, testLogger);
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({display: "none"});
        const linkElement = domWrapper.grabElementByXpath("//a") as HTMLElement;
        expect(browserHelper.getElementData(linkElement)).toBeNull();
    });

    it('should return null if the element is disabled', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body>
        <div id="site_review">
            <label for="w3review">Review of W3Schools:</label>
            <textarea id="w3review" name="w3review" rows="4" cols="50">
            At w3schools.com you will learn how to make a website.
            </textarea>
            <button id="submit_review" type="submit" disabled="disabled">Submit</button>
        </div></body>`);
        const domWrapper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domWrapper, testLogger);
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({});
        const submitButton = domWrapper.grabElementByXpath("//button") as HTMLElement;
        expect(browserHelper.getElementData(submitButton)).toBeNull();
    });

    it.each<[string | undefined, string | undefined]>(
        [[undefined, undefined], ["textbox", undefined], [undefined, "text"], ["textbox", "text"]])(
        'should assemble element data if the element has role %s and type %s', (role?: string, type?: string) => {
            const roleSpecInTag = role ? ` role="${role}"` : "";
            const typeSpecInTag = type ? ` type="${type}"` : "";
            const {window} = new JSDOM(`<!DOCTYPE html>
<body>
<div id="site_review">
    <label for="w3review">Review of W3Schools:</label>
    <input id="w3review" name="w3review"${roleSpecInTag}${typeSpecInTag} value="At w3schools.com you
    will learn how to make a website.

    :)">
    <button id="submit_review" type="submit">Submit</button>
</div>
</body>`);
            const domWrapper = new DomWrapper(window);
            const browserHelper = new BrowserHelper(domWrapper, testLogger);
            domWrapper.getInnerText = jest.fn().mockReturnValueOnce('Review of W3Schools:  Submit')
                .mockReturnValueOnce('');
            domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({});
            const boundingBox = {
                height: 21.200000762939453, width: 169.6000061035, x: 160.1374969482422, y: 8
            };//based on actually putting this html in a file, opening in browser, and inspecting the element with dev console
            // as with other mock return value in this file, aside from the window.getComputedStyle() calls
            domWrapper.grabClientBoundingRect = jest.fn().mockReturnValueOnce(boundingBox);

            const textareaElement = domWrapper.grabElementByXpath("//input") as HTMLElement;
            const elementData = browserHelper.getElementData(textareaElement);
            expect(elementData).not.toBeNull();
            expect(elementData?.centerCoords).toEqual([boundingBox.x + boundingBox.width / 2,
                boundingBox.y + boundingBox.height / 2]);
            expect(elementData?.description)
                .toEqual(`INPUT_VALUE="At w3schools.com you    will learn how to make a website.    :)" parent_node: Review of W3Schools: Submit name="w3review" value="At w3schools.com you will learn how to make a website. :)"`)
            expect(elementData?.tagHead).toEqual("input" + roleSpecInTag + typeSpecInTag);
            expect(elementData?.boundingBox).toEqual({
                tLx: boundingBox.x, tLy: boundingBox.y,
                bRx: boundingBox.x + boundingBox.width, bRy: boundingBox.y + boundingBox.height
            });
            expect(elementData?.tagName).toEqual("input");
        });
    it('should return null if unable to generate description for element', () => {
        const {window} = new JSDOM(`<!DOCTYPE html><body><div id="files_downloads">
        <div id="download_button" role="button">
            <svg class="icon icon-download">
            <use href="#icon-download"></use></svg>
        </div></div></body>`);
        const domWrapper = new DomWrapper(window);
        const browserHelper = new BrowserHelper(domWrapper, testLogger);
        domWrapper.getInnerText = jest.fn().mockReturnValueOnce("").mockReturnValueOnce("");
        domWrapper.getComputedStyle = jest.fn().mockReturnValueOnce({});

        expect(browserHelper.getElementData(domWrapper.grabElementByXpath(`//*[@id="download_button"]`) as HTMLElement))
            .toBeNull();
    });

});

describe('BrowserHelper.calcIsDisabled', () => {
    const {window} = (new JSDOM(`<!DOCTYPE html><body></body>`));
    const domHelper = new DomWrapper(window);
    const {document} = window;
    const browserHelper = new BrowserHelper(domHelper);

    it('returns true for element with ariaDisabled set to true', () => {
        const element = document.createElement('div');
        element.ariaDisabled = 'true';
        expect(browserHelper.calcIsDisabled(element)).toBe(true);
    });

    it('returns true for disabled HTMLButtonElement', () => {
        const element = document.createElement('button');
        element.disabled = true;
        expect(browserHelper.calcIsDisabled(element)).toBe(true);
    });

    it('returns true for disabled HTMLInputElement', () => {
        const element = document.createElement('input');
        element.disabled = true;
        expect(browserHelper.calcIsDisabled(element)).toBe(true);
    });

    it('returns true for element with disabled attribute', () => {
        const element = document.createElement('div');
        element.setAttribute('disabled', '');
        expect(browserHelper.calcIsDisabled(element)).toBe(true);
    });

    it('returns false for enabled HTMLButtonElement', () => {
        const element = document.createElement('button');
        element.disabled = false;
        expect(browserHelper.calcIsDisabled(element)).toBe(false);
    });

    it('returns false for element without disabled attribute', () => {
        const element = document.createElement('div');
        expect(browserHelper.calcIsDisabled(element)).toBe(false);
    });
});


describe('BrowserHelper.getInteractiveElements', () => {
    let testWindow: DOMWindow;
    let testDom: Document;
    let domWrapper: DomWrapper;
    let browserHelper: BrowserHelper;
    let bodyElem: HTMLElement;

    beforeEach(() => {
        const {window} = (new JSDOM(`<!DOCTYPE html><body></body>`));
        testWindow = window;
        testDom = testWindow.document;
        domWrapper = new DomWrapper(window);
        browserHelper = new BrowserHelper(domWrapper, testLogger);
        bodyElem = testDom.body;

        domWrapper.getInnerText = jest.fn().mockReturnValue("");
    });

    it('returns empty array when no interactive elements exist', () => {
        expect(browserHelper.getInteractiveElements()).toEqual([]);
    });

    it('returns data for single interactive element', () => {
        const button = testDom.createElement('button');
        button.setAttribute("name", "someButton");
        bodyElem.appendChild(button);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case 'button':
                    return [button];
                default:
                    return [];
            }
        });
        const result = browserHelper.getInteractiveElements();
        expect(result.length).toBe(1);
        expect(result[0].tagName).toEqual('button');
    });

    it('returns data for multiple interactive elements', () => {
        const button = testDom.createElement('button');
        button.setAttribute("name", "someButton");
        const input = testDom.createElement('input');
        input.setAttribute("placeholder", "some placeholder value");
        bodyElem.appendChild(button);
        bodyElem.appendChild(input);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case 'button':
                    return [button];
                case 'input':
                    return [input];
                default:
                    return [];
            }
        });
        const result = browserHelper.getInteractiveElements();
        expect(result.length).toBe(2);
        expect(result.map(data => data.tagName)).toEqual(expect.arrayContaining(['button', 'input']));
    });

    it('ignores hidden interactive elements', () => {
        const button = testDom.createElement('button');
        button.setAttribute("name", "someButton");
        button.style.display = 'none';
        const input = testDom.createElement('input');
        input.setAttribute("placeholder", "some placeholder value");
        bodyElem.appendChild(button);
        bodyElem.appendChild(input);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case 'button':
                    return [button];
                case 'input':
                    return [input];
                default:
                    return [];
            }
        });
        const result = browserHelper.getInteractiveElements();
        expect(result.length).toEqual(1);
        expect(result[0].tagName).toEqual('input');
    });

    it('ignores disabled interactive elements', () => {
        const button = testDom.createElement('button');
        button.setAttribute("name", "someButton");
        button.disabled = true;
        bodyElem.appendChild(button);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case 'button':
                    return [button];
                default:
                    return [];
            }
        });
        expect(browserHelper.getInteractiveElements()).toEqual([]);
    });

    it('returns data for interactive elements with specific roles', () => {
        const div = testDom.createElement('div');
        div.setAttribute('role', 'button');
        div.setAttribute("name", "some Button-Like Div");
        bodyElem.appendChild(div);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case '[role="button"]':
                    return [div];
                default:
                    return [];
            }
        });
        const result = browserHelper.getInteractiveElements();
        expect(result.length).toBe(1);
        expect(result[0].tagName).toBe('div');
    });

    it('returns unique elements even if they match multiple selectors', () => {
        const button = testDom.createElement('button');
        button.setAttribute("name", "someButton");
        const input = testDom.createElement('input');
        input.setAttribute("placeholder", "some placeholder value");
        input.type = 'button';
        input.setAttribute('onclick', '');
        const div = testDom.createElement('div');
        div.setAttribute('role', 'button');
        div.setAttribute("name", "some Button-Like Div");
        bodyElem.appendChild(button);
        bodyElem.appendChild(input);
        bodyElem.appendChild(div);
        domWrapper.fetchElementsByCss = jest.fn().mockImplementation((selector: string) => {
            switch (selector) {
                case 'button':
                    return [button];
                case 'input':
                    return [input];
                case '[type="button"]':
                    return [input];
                case '[onclick]':
                    return [input];
                case '[role="button"]':
                    return [div];
                default:
                    return [];
            }
        });
        const result = browserHelper.getInteractiveElements();
        expect(result.length).toBe(3);
    });
});