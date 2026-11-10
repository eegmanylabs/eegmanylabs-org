// Checks of external codes that a source refers to (docs/MIGRATION_PLAN.md, section 4.5). A
// code is checked for its shape and its check digit only. Nothing is looked up, and no label is
// fetched: what a code means is for a person to confirm.

/** The multiplication table of the dihedral group of order ten, on which the Verhoeff scheme rests. */
const VERHOEFF_MULTIPLY: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** The permutation that the scheme applies to a digit, by the position of the digit from the right. */
const VERHOEFF_PERMUTE: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Whether the last digit of a number is its correct Verhoeff check digit. False for anything but digits. */
export function hasValidVerhoeffDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let check = 0;
  [...digits].reverse().forEach((digit, position) => {
    check = VERHOEFF_MULTIPLY[check]?.[VERHOEFF_PERMUTE[position % 8]?.[Number(digit)] ?? 0] ?? 0;
  });
  return check === 0;
}

/**
 * What the reference to an external concept in a `same_as` cell is.
 *
 * | Status           | The cell holds                                                             | Stored on the term |
 * |------------------|----------------------------------------------------------------------------|--------------------|
 * | `accepted`       | `snomed:` and a code of 6 to 18 digits with a correct check digit          | yes, verbatim      |
 * | `checkDigit`     | The same shape with a check digit that is wrong                            | no                 |
 * | `unknownPrefix`  | A prefix and a code, with a prefix other than `snomed`                     | no                 |
 * | `shape`          | Anything else                                                              | no                 |
 *
 * An accepted code is in the long format when the two digits before its check digit begin with
 * `1`. Such a code belongs to the extension of one namespace, a national one for example, and
 * the international edition does not hold it.
 */
export type ExternalCode =
  | { readonly status: "accepted"; readonly system: "snomed"; readonly code: string; readonly extension: boolean }
  | { readonly status: "checkDigit" | "unknownPrefix" | "shape" };

/** Reads a `same_as` cell as a prefix and a code. The cell itself is stored as written, never this reading. */
export function parseExternalCode(cell: string): ExternalCode {
  const match = /^([A-Za-z][A-Za-z0-9_.-]*):(\S+)$/.exec(cell.trim());
  if (!match) return { status: "shape" };
  const [, prefix = "", code = ""] = match;
  if (prefix !== "snomed") return { status: "unknownPrefix" };
  if (!/^[1-9]\d{5,17}$/.test(code)) return { status: "shape" };
  if (!hasValidVerhoeffDigit(code)) return { status: "checkDigit" };
  return { status: "accepted", system: "snomed", code, extension: code.at(-3) === "1" };
}
