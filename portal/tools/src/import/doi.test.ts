// Unit tests of the DOI reader. Every DOI and address here is invented, on prefixes and hosts
// that are reserved for examples.
import { describe, expect, it } from "vitest";
import { addressesIn, doiOfAddress, doisIn, endsInStrayParenthesis, hyperlinkFormulaTarget, isDoi } from "./doi";

describe("doisIn", () => {
  it("reads a DOI out of a citation and leaves the full stop of the sentence behind", () => {
    expect(
      doisIn("Invented, A. (2001). A study. Journal, 1(1), 1–2. https://doi.org/10.1000/invented.2001.01."),
    ).toEqual(["10.1000/invented.2001.01"]);
    expect(doisIn("see 10.1000/a.b, and 10.1000/c.d; then nothing")).toEqual(["10.1000/a.b", "10.1000/c.d"]);
  });

  it("keeps the parentheses and the capitals that belong to a DOI", () => {
    expect(doisIn("https://doi.org/10.1000/0000-0000(91)12345-X")).toEqual(["10.1000/0000-0000(91)12345-X"]);
    expect(doisIn("10.1000/S0000-0000(02)00042-7.")).toEqual(["10.1000/S0000-0000(02)00042-7"]);
  });

  it("strips a closing parenthesis only when nothing inside the DOI opens it", () => {
    expect(doisIn("(doi: 10.1000/invented.7)")).toEqual(["10.1000/invented.7"]);
    expect(doisIn("(doi: 10.1000/0000(94)54321-8).")).toEqual(["10.1000/0000(94)54321-8"]);
    expect(doisIn("(10.1000/abc(1)2))")).toEqual(["10.1000/abc(1)2"]);
  });

  it("finds nothing in a text without a DOI, and nothing in a year or a page range", () => {
    expect(doisIn("Invented, A. (2001). A study without one. Journal, 10.5, 1–2.")).toEqual([]);
    expect(doisIn("")).toEqual([]);
  });
});

describe("the other places of a DOI", () => {
  it("reads the DOI of a link target, with an escaped character read as the character", () => {
    expect(doiOfAddress("https://doi.org/10.1000/INVENTED(2002)02")).toBe("10.1000/INVENTED(2002)02");
    expect(doiOfAddress("https://doi.org/10.1000/a%28b%29c")).toBe("10.1000/a(b)c");
    expect(doiOfAddress("https://forms.example.org/alpha")).toBeNull();
    expect(doiOfAddress("https://doi.org/10.1000/odd%zz")).toBe("10.1000/odd%zz");
  });

  it("reads the address of a HYPERLINK formula that states it as a literal", () => {
    expect(hyperlinkFormulaTarget('HYPERLINK("https://doi.org/10.1000/invented.9","An invented citation")')).toBe(
      "https://doi.org/10.1000/invented.9",
    );
    expect(hyperlinkFormulaTarget('=hyperlink( "https://pages.example.org/a""b" )')).toBe(
      'https://pages.example.org/a"b',
    );
    expect(hyperlinkFormulaTarget("HYPERLINK(A1,B1)")).toBeNull();
    expect(hyperlinkFormulaTarget('CONCATENATE("https://pages.example.org/")')).toBeNull();
  });

  it("tells one whole DOI from a text that merely contains one", () => {
    expect(isDoi("10.1000/invented.1")).toBe(true);
    expect(isDoi("doi 10.1000/invented.1")).toBe(false);
    expect(isDoi("10.1000/with space")).toBe(false);
  });

  it("lists the addresses of a text and notices a parenthesis that a sentence left on one", () => {
    expect(addressesIn("see https://osf.example.org/abcde and http://lab.example.org/x) for more")).toEqual([
      "https://osf.example.org/abcde",
      "http://lab.example.org/x)",
    ]);
    expect(endsInStrayParenthesis("https://docs.example.org/document/d/abc)")).toBe(true);
    expect(endsInStrayParenthesis("https://pages.example.org/wiki/Topic_(sense)")).toBe(false);
    expect(endsInStrayParenthesis("https://pages.example.org/plain")).toBe(false);
  });
});
