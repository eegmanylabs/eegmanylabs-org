import { describe, expect, it } from "vitest";
import { SEARCH_TOKENS_PER_PART } from "./schemas/system";
import { SEARCH_PREFIX_MAX, searchQueryTokens, searchTokenParts, searchTokensOf } from "./search-tokens";

describe("the tokens of the search index", () => {
  it("hold every folded word with its beginnings, so a query finds a word by its first letters", () => {
    const tokens = searchTokensOf(["Électrode impedance"]);
    expect(tokens).toEqual(expect.arrayContaining(["e", "el", "electrode", "imp", "impedance"]));
    for (const typed of ["elec", "IMPED", "impedance"]) {
      expect(searchQueryTokens(typed)?.every((token) => tokens.includes(token))).toBe(true);
    }
    expect(searchQueryTokens("montage")?.every((token) => tokens.includes(token))).toBe(false);
  });

  it("hold a long word whole and by its first letters only up to the longest beginning", () => {
    const tokens = searchTokensOf(["electroencephalography"]);
    expect(tokens).toContain("electroencephalography");
    expect(tokens).toContain("electroencep".slice(0, SEARCH_PREFIX_MAX));
    expect(tokens.filter((token) => token.startsWith("electroencephal") && token !== "electroencephalography")).toEqual(
      [],
    );
  });

  it("split many tokens into parts and give nothing to search for an empty query", () => {
    const many = Array.from({ length: SEARCH_TOKENS_PER_PART + 10 }, (_, index) => `t${index}`);
    expect(searchTokenParts(many).map((part) => part.length)).toEqual([SEARCH_TOKENS_PER_PART, 10]);
    expect(searchTokenParts([])).toEqual([[]]);
    expect(searchQueryTokens("   ")).toBeNull();
    expect(searchQueryTokens("!!!")).toBeNull();
  });
});
