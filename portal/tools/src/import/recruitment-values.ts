// Readings of the cells of a recruitment and contact workbook (docs/MIGRATION_PLAN.md,
// section 4.6). Every function here is pure. A reading is stored beside the cell as written and
// never in its place, and anything that needs judgement is returned as such, for the queue.
import { singleEmail } from "./identity";
import type { RawCell, RawScalar } from "./model";
import { isStorableUrl } from "./records";
import { parseRef, serialToIsoDate } from "./workbook";

/** One part of the record of a cell, or null where the cell or the part is absent. */
export function cellPart(cell: RawCell | undefined, key: string): RawScalar {
  if (cell === undefined || cell === null || typeof cell !== "object") return null;
  return cell[key] ?? null;
}

/** The stored value of a cell record. */
export function storedValue(cell: RawCell | undefined): RawScalar {
  if (cell === undefined || cell === null) return null;
  return typeof cell === "object" ? (cell.v ?? null) : cell;
}

/** A cell as text: its text as written, a number in the characters the file holds, or null for a cell without a value. */
export function textOf(cell: RawCell | undefined): string | null {
  const value = storedValue(cell);
  if (value === null) return null;
  if (typeof value === "string") return value;
  const raw = cellPart(cell, "r");
  return typeof raw === "string" ? raw : String(value);
}

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** Every email-shaped text inside a cell. */
export function addressesIn(text: string): string[] {
  return text.match(ADDRESS) ?? [];
}

/**
 * What the first cell of a row below the header of an outreach tab is. The cell is classed
 * before the row counts as a contact.
 *
 * | Class           | The cell                                                              | The row becomes        |
 * |-----------------|-----------------------------------------------------------------------|------------------------|
 * | `empty`         | holds nothing, while another cell of the row holds something          | an annotation          |
 * | `recipientList` | holds two or more addresses, or a line break                          | an annotation          |
 * | `sectionLabel`  | ends with a colon, in a row with no other value                       | an annotation          |
 * | `severalPeople` | holds a colon inside, as a name with a role before a second name does | an annotation          |
 * | `freeText`      | has more than 5 words or more than 60 characters, and no address      | an annotation          |
 * | `contact`       | is anything else                                                      | one outreach contact   |
 */
export type NameCellClass = "empty" | "recipientList" | "sectionLabel" | "severalPeople" | "freeText" | "contact";

export function classifyNameCell(text: string | null, rowHasOtherContent: boolean): NameCellClass {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return "empty";
  const addresses = addressesIn(trimmed);
  if (addresses.length >= 2 || /[\r\n]/.test(trimmed)) return "recipientList";
  if (trimmed.endsWith(":") && !rowHasOtherContent) return "sectionLabel";
  if (trimmed.slice(0, -1).includes(":")) return "severalPeople";
  if (addresses.length === 0 && (trimmed.split(/\s+/).length > 5 || trimmed.length > 60)) return "freeText";
  return "contact";
}

/**
 * What a name cell of a contact row holds beyond one plain name. Each is a question for a
 * reviewer. The name itself is kept as written and is never split, merged or corrected.
 *
 * | Check          | The cell                                                        |
 * |----------------|-----------------------------------------------------------------|
 * | `tentative`    | ends with a question mark                                       |
 * | `semicolon`    | holds a semicolon, which separates people                       |
 * | `comma`        | holds a comma, which may separate people or parts of one name   |
 * | `annotation`   | holds a bracket, as a role beside a name does                   |
 * | `addressForm`  | has no space and reads like the local part of an address        |
 */
export type NameCheck = "tentative" | "semicolon" | "comma" | "annotation" | "addressForm";

export function nameChecks(name: string): NameCheck[] {
  const trimmed = name.trim();
  const checks: NameCheck[] = [];
  if (trimmed.endsWith("?")) checks.push("tentative");
  if (trimmed.includes(";")) checks.push("semicolon");
  if (trimmed.includes(",")) checks.push("comma");
  if (/[()[\]]/.test(trimmed)) checks.push("annotation");
  if (!/\s/.test(trimmed) && /[._-]|@/.test(trimmed)) checks.push("addressForm");
  return checks;
}

/** The people a name cell lists: its parts between semicolons. No other character separates people. */
export function peopleIn(name: string): string[] {
  return name
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * What an address cell holds.
 *
 * | Status     | The cell, trimmed                                                                 |
 * |------------|-----------------------------------------------------------------------------------|
 * | `absent`   | is empty                                                                          |
 * | `valid`    | is exactly one address. `canonical` is that address in lower case, for matching   |
 * | `reversed` | is no address, and is one when its characters are read backwards. `decoded` is a candidate that is used for nothing until a reviewer confirms it |
 * | `invalid`  | is anything else                                                                  |
 */
export type AddressReading =
  | { readonly status: "absent" | "invalid" }
  | { readonly status: "valid"; readonly canonical: string }
  | { readonly status: "reversed"; readonly decoded: string };

export function readAddress(cell: string | null): AddressReading {
  if (cell === null || cell.trim() === "") return { status: "absent" };
  const canonical = singleEmail(cell);
  if (canonical !== null) return { status: "valid", canonical };
  const decoded = singleEmail([...cell.trim()].reverse().join(""));
  return decoded === null ? { status: "invalid" } : { status: "reversed", decoded };
}

/**
 * What a date cell of an outreach row holds. Dates are day first.
 *
 * | Status       | The cell                                                                          | `iso`  |
 * |--------------|-----------------------------------------------------------------------------------|--------|
 * | `absent`     | is empty                                                                          |        |
 * | `parsed`     | is a text `dd.mm.yy` or `dd.mm.yyyy`, or a true date whose day is above 12 or equals its month | set |
 * | `ambiguous`  | is a true date whose day is 12 or less: day and month may have changed places when it was typed | the date as stored, for comparison only |
 * | `unreadable` | is anything else, a date that does not exist included                             |        |
 */
export type DateReading =
  | { readonly status: "absent" | "unreadable" }
  | { readonly status: "parsed" | "ambiguous"; readonly iso: string; readonly form: "text" | "trueDate" };

function isoOf(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date.toISOString().slice(0, 10) : null;
}

export function readOutreachDate(cell: RawCell | undefined, date1904 = false): DateReading {
  const value = storedValue(cell);
  if (value === null || (typeof value === "string" && value.trim() === "")) return { status: "absent" };
  const type = cellPart(cell, "t");
  if (typeof value === "string" && type !== "isoDate") {
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value.trim());
    if (!match) return { status: "unreadable" };
    const year = (match[3] ?? "").length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const iso = isoOf(year, Number(match[2]), Number(match[1]));
    return iso === null ? { status: "unreadable" } : { status: "parsed", iso, form: "text" };
  }
  let iso: string | null = null;
  if (typeof value === "number" && cellPart(cell, "z") !== null && value > 0) iso = serialToIsoDate(value, date1904);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) iso = value.slice(0, 10);
  if (iso === null) return { status: "unreadable" };
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return { status: day <= 12 && day !== month ? "ambiguous" : "parsed", iso, form: "trueDate" };
}

/** The colour of a fill as the importer buckets it. `other` is reviewed, and `none` covers white and no fill. */
export type FillBucket = "none" | "red" | "green" | "other";

/**
 * Buckets a fill colour, given as six hexadecimal digits after the theme has been resolved. The
 * hue decides, so every red and every green of a palette falls into its bucket whichever shade
 * a person picked. A colour without saturation that is nearly white is a pasted background.
 */
export function fillBucket(rgb: string | null): FillBucket {
  if (rgb === null || !/^[0-9A-Fa-f]{6}$/.test(rgb)) return rgb === null ? "none" : "other";
  const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(rgb.slice(at, at + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const spread = max - min;
  if (spread < 0.08) return lightness > 0.9 ? "none" : "other";
  let hue: number;
  if (max === red) hue = ((green - blue) / spread) % 6;
  else if (max === green) hue = (blue - red) / spread + 2;
  else hue = (red - green) / spread + 4;
  const degrees = (hue * 60 + 360) % 360;
  if (degrees <= 20 || degrees >= 340) return "red";
  if (degrees >= 80 && degrees <= 160) return "green";
  return "other";
}

/** The buckets of the name cell and the result cell of one row as one: the one that is set, or `other` where they differ. */
export function rowFillBucket(name: FillBucket, result: FillBucket): FillBucket {
  if (name === "none") return result;
  if (result === "none" || result === name) return name;
  return "other";
}

/** The reading of a result that the importer proposes. A reviewer sets the category of a contact, never the importer. */
export type ResultProposal = "accepted" | "declined" | "noReply";

/**
 * The words by which a short result is read. They are everyday words for the outcome of an
 * invitation and no list of the values of any source. A result that none of them reads, that
 * two categories read, or that is longer than a status is left to a reviewer.
 */
const RESULT_WORDS: Readonly<Record<ResultProposal, readonly RegExp[]>> = {
  accepted: [/\bagreed\b/, /\baccept(?:s|ed)?\b/],
  declined: [/\breject(?:s|ed)?\b/, /\bdeclin(?:es|ed)\b/],
  noReply: [/\bno (?:response|reply|answer)\b/, /\b(?:did not|didn't|didn’t|has not|hasn't) (?:respond|reply|answer)/],
};

/** The longest result, in characters and in words, that is read as a status. A longer one is a narrative. */
const RESULT_STATUS_MAX_LENGTH = 60;
export const RESULT_STATUS_MAX_WORDS = 8;

export function proposeResult(result: string): ResultProposal | null {
  const text = result.trim().toLowerCase();
  if (text === "" || text.length > RESULT_STATUS_MAX_LENGTH || text.split(/\s+/).length > RESULT_STATUS_MAX_WORDS) {
    return null;
  }
  const read = (Object.keys(RESULT_WORDS) as ResultProposal[]).filter((category) =>
    RESULT_WORDS[category].some((word) => word.test(text)),
  );
  return read.length === 1 ? (read[0] ?? null) : null;
}

/** The parameters that carry an access token or the state of a session, which no stored address keeps. */
const SESSION_PARAMETERS: readonly string[] = ["casa_token", "login", "via"];

export interface FoundLink {
  /** The address as the source holds it: the target of the hyperlink where there is one, otherwise the text. */
  readonly urlSource: string;
  /** The address without session parameters and without an empty fragment, or null when it is no storable address. */
  readonly url: string | null;
  /** Whether a session parameter was removed. */
  readonly carriedSession: boolean;
}

/** An address in the form in which it is stored: no access token, no session parameter and no empty fragment. */
export function normaliseLink(address: string): Pick<FoundLink, "url" | "carriedSession"> {
  const trimmed = address.trim();
  if (!isStorableUrl(trimmed)) return { url: null, carriedSession: false };
  const url = new URL(trimmed);
  let carriedSession = false;
  for (const parameter of [...url.searchParams.keys()]) {
    // A publisher may write the name and the value as one encoded name, as in `via%3Dihub`.
    if (!SESSION_PARAMETERS.includes(parameter.split("=")[0]?.toLowerCase() ?? "")) continue;
    url.searchParams.delete(parameter);
    carriedSession = true;
  }
  if (url.hash === "") url.hash = "";
  const normalised = url.toString();
  return isStorableUrl(normalised) ? { url: normalised, carriedSession } : { url: null, carriedSession };
}

/**
 * The addresses of one cell. The target of a hyperlink is preferred over the text, so a text
 * that repeats the target, with or without a trailing character, gives one link.
 */
export function linksIn(text: string | null, hyperlink: string | null): FoundLink[] {
  const found: string[] = [];
  if (hyperlink !== null && /^https?:\/\//i.test(hyperlink)) found.push(hyperlink);
  for (const match of (text ?? "").match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const address = match.replace(/[.,;:!?)\]]+$/, "");
    const covered = found.some(
      (other) => normaliseLink(other).url !== null && normaliseLink(other).url === normaliseLink(address).url,
    );
    if (!covered) found.push(address);
  }
  return found.map((urlSource) => ({ urlSource, ...normaliseLink(urlSource) }));
}

/** The DOI that a text names through an address on doi.org, in lower case, or null. */
export function doiIn(text: string | null, hyperlink: string | null): string | null {
  for (const candidate of [hyperlink, text]) {
    const match = /https?:\/\/(?:dx\.)?doi\.org\/(\S+)/i.exec(candidate ?? "");
    if (match) return (match[1] ?? "").replace(/[.,;]+$/, "").toLowerCase();
  }
  return null;
}

/**
 * Recomputes a total or a median from the numbers of a tab, for the comparison with the cached
 * value of a derived cell. It reads `SUM` and `MEDIAN` over ranges and single cells, and returns
 * null for any other formula. A cell without a number counts for nothing, as in a spreadsheet.
 */
export function recomputeAggregate(
  formula: string,
  numberAt: (row: number, column: number) => number | null,
): number | null {
  const match = /^=?\s*(SUM|MEDIAN)\(([^()]*)\)\s*$/i.exec(formula);
  if (!match) return null;
  const values: number[] = [];
  for (const part of (match[2] ?? "").split(",").map((entry) => entry.trim())) {
    const range = /^(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?$/.exec(part);
    if (!range) return null;
    const start = parseRef(range[1] ?? "");
    const end = parseRef(range[2] ?? range[1] ?? "");
    for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
      for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
        const value = numberAt(row, column);
        if (value !== null) values.push(value);
      }
    }
  }
  if ((match[1] ?? "").toUpperCase() === "SUM") return values.reduce((sum, value) => sum + value, 0);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Whether a formula is a plain total or median over one range of one column, as a derived row of a summary tab is. */
export function isPlainColumnAggregate(formula: string): boolean {
  const match = /^=?\s*(?:SUM|MEDIAN)\(\$?([A-Z]{1,3})\$?\d+:\$?([A-Z]{1,3})\$?\d+\)\s*$/i.exec(formula);
  return match !== null && match[1] === match[2];
}
