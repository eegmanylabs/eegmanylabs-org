// Reading a DOI out of the places in which a workbook keeps one (docs/MIGRATION_PLAN.md,
// section 4.3): the text of a citation, the target of a link and the argument of a `HYPERLINK`
// formula. A DOI is returned as it is written. It is put in lower case for a key only, by the
// caller.
//
// | Written                                              | Read as                          |
// |------------------------------------------------------|----------------------------------|
// | `https://doi.org/10.1000/example.1.`                 | `10.1000/example.1`              |
// | `(doi: 10.1000/0000-0000(91)12345-X)`                | `10.1000/0000-0000(91)12345-X`   |
// | `10.1000/example.2), and`                            | `10.1000/example.2`              |

/** The start of a DOI and everything up to the next white space, quotation mark or angle bracket. */
const DOI_RUN = /10\.\d{4,9}\/[^\s"<>]+/g;

const occurrences = (text: string, character: string): number => text.split(character).length - 1;

/**
 * Takes from the end of a run what belongs to the sentence around it: a full stop, a comma, a
 * semicolon, and a closing parenthesis that no opening one inside the DOI answers. Parentheses
 * inside a DOI are kept.
 */
function withoutTrailingPunctuation(run: string): string {
  let doi = run;
  for (;;) {
    const last = doi.at(-1);
    const unbalanced = last === ")" && occurrences(doi, ")") > occurrences(doi, "(");
    if (last !== "." && last !== "," && last !== ";" && !unbalanced) return doi;
    doi = doi.slice(0, -1);
  }
}

/** Whether a text is one DOI and nothing else. */
export function isDoi(text: string): boolean {
  return /^10\.\d{4,9}\/\S+$/.test(text);
}

/** Every DOI that a text contains, as written, in the order of the text. */
export function doisIn(text: string): string[] {
  return [...text.matchAll(DOI_RUN)].map((match) => withoutTrailingPunctuation(match[0])).filter(isDoi);
}

/** The DOI that a link target names, or null. An escaped character in the address is read as the character. */
export function doiOfAddress(address: string): string | null {
  let readable = address;
  try {
    readable = decodeURIComponent(address);
  } catch {
    // An address with a stray per cent sign is read as it stands.
  }
  return doisIn(readable)[0] ?? null;
}

/** The address that a `HYPERLINK` formula links to, when the formula states it as a literal. Null for any other formula. */
export function hyperlinkFormulaTarget(formula: string): string | null {
  const match = /^=?\s*HYPERLINK\(\s*"((?:[^"]|"")*)"/i.exec(formula);
  return match?.[1] === undefined ? null : match[1].replaceAll('""', '"');
}

/** The addresses that a text contains: everything from `http://` or `https://` to the next white space. */
export function addressesIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s"<>]+/g)].map((match) => match[0]);
}

/** Whether an address ends in a closing parenthesis that no opening one answers, which a pasted sentence leaves behind. */
export function endsInStrayParenthesis(address: string): boolean {
  return address.endsWith(")") && occurrences(address, ")") > occurrences(address, "(");
}
