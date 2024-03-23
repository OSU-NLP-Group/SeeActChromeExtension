import {BrowserHelper} from "../../src/utils/BrowserHelper";

describe('BrowserHelper.removeAndCollapseEol', () => {
    const browserHelper = new BrowserHelper();

    it("shouldn't affect a string with no newlines and no consecutive whitespace chars", () => {
        expect(browserHelper.removeAndCollapseEol("hello world")).toBe("hello world");
    });

    it("should replace newlines with spaces", () => {
        expect(browserHelper.removeAndCollapseEol("hello\nworld")).toBe("hello world");
    });

    it("should replace multiple consecutive whitespace chars with a single space", () => {
        expect(browserHelper.removeAndCollapseEol("hello\n\n\nworld, I'm \tZoe")).toBe("hello world, I'm Zoe");
    });

});