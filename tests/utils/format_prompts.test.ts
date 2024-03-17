import {_processString} from "../../src/utils/format_prompts";


describe('_processString', () => {
    it('should leave a normal string alone', () => {
        const input: string = "some string";
        expect(_processString(input)).toBe(input);
    });
    it('should remove double quotes from start and end of string', () => {
        expect(_processString("\"some string\"")).toBe("some string");
    });
    it('should not remove double quotes from middle of string', () => {
        const input: string = "some \"string\" containing \"-wrapped substring";
        expect(_processString(input)).toBe(input);
    });
    it('should not remove starting double quote if no ending double quote', () => {
        const input: string = "\"some string";
        expect(_processString(input)).toBe(input);
    });
    it('should not remove ending double quote if no starting double quote', () => {
        const input: string = "some string\"";
        expect(_processString(input)).toBe(input);
    });
    it('should remove period from end of string', () => {
        expect(_processString("some string.")).toBe("some string");
    });
    it('should not remove period from middle of string', () => {
        const input: string = "some. string";
        expect(_processString(input)).toBe(input);
    });
    it('should remove period from end of double-quote-wrapped string', () => {
        expect(_processString("\"some string.\"")).toBe("some string");
    });
    it('should remove ending period if starting double quote but no ending double quote', () => {
        expect(_processString("\"some string.")).toBe("\"some string");
    });
    //todo confirm with Boyuan about whether this aspect of existing behavior is desired
    it('should not remove period just before ending double quote if no starting double quote', () => {
        const input: string = "some string.\"";
        expect(_processString(input)).toBe(input);
    });
    //todo confirm with Boyuan about whether this aspect of existing behavior is desired
    it('should remove ending period but not double quotes from string with double quotes around it and period after the ending double quote', () => {
        expect(_processString("\"some string\".")).toBe("\"some string\"");
    });
});