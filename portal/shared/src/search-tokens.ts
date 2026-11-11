// The tokens of the search index (docs/DATA_MODEL.md, section 13). An entry holds the folded
// words of a record with their beginnings, so that the search function finds a page by the
// first letters of a word with one array-membership query for each word typed. The trigger that
// writes the index and the function that searches it both use these two functions.
import { searchFold, searchWords } from "./ids";
import { SEARCH_TOKENS_PER_PART } from "./schemas/system";

/** The longest beginning of a word that the index holds. A longer word is held whole as well. */
export const SEARCH_PREFIX_MAX = 12;
/** The longest token. A longer word is cut to this length. */
const TOKEN_MAX = 100;

/** The distinct tokens of some texts: every folded word with each of its beginnings, in order of first use. */
export function searchTokensOf(texts: readonly string[]): string[] {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const word of searchFold(text).split("-")) {
      if (word === "") continue;
      const whole = word.slice(0, TOKEN_MAX);
      for (let length = 1; length <= Math.min(SEARCH_PREFIX_MAX, whole.length); length += 1) {
        tokens.add(whole.slice(0, length));
      }
      tokens.add(whole);
    }
  }
  return [...tokens];
}

/** The tokens of an index entry, in parts of at most `SEARCH_TOKENS_PER_PART`, and always at least one part. */
export function searchTokenParts(tokens: readonly string[]): string[][] {
  const parts: string[][] = [];
  for (let start = 0; start < tokens.length; start += SEARCH_TOKENS_PER_PART) {
    parts.push(tokens.slice(start, start + SEARCH_TOKENS_PER_PART));
  }
  return parts.length === 0 ? [[]] : parts;
}

/** The tokens that a query asks for, one for each word, at most eight. Null when nothing searchable was typed. */
export function searchQueryTokens(query: string): string[] | null {
  const words = searchWords(query);
  if (words === null || words.length === 0) return null;
  return [...new Set(words.map((word) => word.slice(0, TOKEN_MAX)))].slice(0, 8);
}
