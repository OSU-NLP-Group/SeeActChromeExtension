import {BrowserHelper} from "../../src/utils/BrowserHelper";

describe('BrowserHelper.removeAndCollapseEol', () => {
    const browserHelper = new BrowserHelper();

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
    const browserHelper = new BrowserHelper();

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