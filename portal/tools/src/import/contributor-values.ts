// Readings of the cells of a contributor sheet (docs/MIGRATION_PLAN.md, section 4.7): the
// unified mapping from header text to field, the classes of a row, and the readings of a
// checkbox, an order value and an identifier. Everything here is pure, and nothing changes a
// raw value: every reading is a copy beside it.
import { CREDIT_ROLES, type CreditRoleKey, lookupFold } from "@eegml/shared";
import type { RawScalar } from "./model";

/**
 * The fields of a contributor sheet that are no CRediT role and no affiliation, by the header
 * that names each. Headers are compared whole, so `Funding acquisition`, `Funding` and
 * `Funding 2` are three columns.
 *
 * | Field                 | Header                                                               |
 * |-----------------------|----------------------------------------------------------------------|
 * | `orderInPublication`  | `Order in publication`                                               |
 * | `firstName`           | `Firstname`                                                          |
 * | `middleName`          | `Middle name`                                                        |
 * | `surname`             | `Surname`                                                            |
 * | `agreement`           | `I agree with the current version of the manuscript to be submitted` |
 * | `email`               | `Email address`                                                      |
 * | `funding`             | `Funding`                                                            |
 * | `orcid`               | `ORCID iD`                                                           |
 * | `correspondingAuthor` | `Corresponding author?`                                              |
 * | `conflictOfInterest`  | `Conflict of interest`                                               |
 *
 * An affiliation column is `Primary affiliation` or `Affiliation 1` for slot 1,
 * `Secondary affiliation` or `Affiliation 2` for slot 2, and `Affiliation N` for slot N.
 */
export const FIELD_HEADERS = {
  orderInPublication: "Order in publication",
  firstName: "Firstname",
  middleName: "Middle name",
  surname: "Surname",
  agreement: "I agree with the current version of the manuscript to be submitted",
  email: "Email address",
  funding: "Funding",
  orcid: "ORCID iD",
  correspondingAuthor: "Corresponding author?",
  conflictOfInterest: "Conflict of interest",
} as const;
export type ContributorField = keyof typeof FIELD_HEADERS;
const FIELDS = Object.keys(FIELD_HEADERS) as readonly ContributorField[];

/** The columns that hold a checkbox beside the fourteen roles. */
export const CHECKBOX_FIELDS: readonly ContributorField[] = ["agreement", "correspondingAuthor"];

/**
 * A header as headers are compared: trimmed, with runs of white space as one space, in lower
 * case, and with an en dash or an em dash read as a hyphen. The header itself is stored verbatim.
 */
export function normaliseHeader(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\u2013\u2014]/g, "-")
    .toLowerCase();
}

const FIELD_OF_HEADER = new Map(FIELDS.map((field) => [normaliseHeader(FIELD_HEADERS[field]), field]));
const ROLE_OF_HEADER = new Map(CREDIT_ROLES.map((role) => [normaliseHeader(role.name), role.key]));
const NAMED_SLOTS = new Map([
  ["primary affiliation", 1],
  ["secondary affiliation", 2],
]);

export interface HeaderCell {
  /** The name under which the cells of the column are stored: its column letter. */
  readonly label: string;
  /** The text of the header cell exactly as the sheet writes it, or an empty text. */
  readonly text: string;
}

export interface ColumnMap {
  readonly fields: ReadonlyMap<ContributorField, string>;
  readonly roles: ReadonlyMap<CreditRoleKey, string>;
  /** The affiliation columns by slot, from 1. */
  readonly affiliations: ReadonlyMap<number, string>;
  /** Columns whose header is no header of the mapping. Their cells stay in the source record. */
  readonly unknown: readonly HeaderCell[];
  /** Columns without a header. A column with data under a blank header is never mapped by guesswork. */
  readonly blank: readonly string[];
  /** Headers of the mapping that stand in the row more than once, as they are compared. */
  readonly duplicated: readonly string[];
  /** Headers that every sheet must have and that this row lacks, as the mapping spells them. */
  readonly missing: readonly string[];
}

/** Maps the columns of a sheet by the text of their headers, never by their letter or position. */
export function mapColumns(headers: readonly HeaderCell[]): ColumnMap {
  const fields = new Map<ContributorField, string>();
  const roles = new Map<CreditRoleKey, string>();
  const affiliations = new Map<number, string>();
  const unknown: HeaderCell[] = [];
  const blank: string[] = [];
  const duplicated = new Set<string>();
  for (const header of headers) {
    const text = normaliseHeader(header.text);
    if (text === "") {
      blank.push(header.label);
      continue;
    }
    const field = FIELD_OF_HEADER.get(text);
    const role = ROLE_OF_HEADER.get(text);
    const numbered = /^affiliation ([1-9])$/.exec(text);
    const slot = NAMED_SLOTS.get(text) ?? (numbered === null ? undefined : Number(numbered[1]));
    if (field !== undefined) {
      if (fields.has(field)) duplicated.add(text);
      else fields.set(field, header.label);
    } else if (role !== undefined) {
      if (roles.has(role)) duplicated.add(text);
      else roles.set(role, header.label);
    } else if (slot !== undefined) {
      if (affiliations.has(slot)) duplicated.add(text);
      else affiliations.set(slot, header.label);
    } else {
      unknown.push(header);
    }
  }
  const missing = [
    ...(["firstName", "surname"] as const).filter((field) => !fields.has(field)).map((field) => FIELD_HEADERS[field]),
    ...CREDIT_ROLES.filter((role) => !roles.has(role.key)).map((role) => role.name),
  ];
  return { fields, roles, affiliations, unknown, blank, duplicated: [...duplicated].sort(), missing };
}

/** What a checkbox cell says. `tick` is null for a blank cell and for any value that is no checkbox value. */
export interface CheckboxReading {
  readonly tick: boolean | null;
  /** True for a cell that holds something other than a stored boolean or the exact texts `TRUE` and `FALSE`. */
  readonly odd: boolean;
  readonly blank: boolean;
}

/**
 * Reads a checkbox from a stored boolean or from the exact texts `TRUE` and `FALSE`, which is
 * what a text export of a checkbox holds. A blank cell is unknown and never false, and any
 * other value is unknown as well and goes to review.
 */
export function readCheckbox(value: RawScalar): CheckboxReading {
  if (typeof value === "boolean") return { tick: value, odd: false, blank: false };
  if (value === "TRUE" || value === "FALSE") return { tick: value === "TRUE", odd: false, blank: false };
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return { tick: null, odd: false, blank: true };
  }
  return { tick: null, odd: true, blank: false };
}

/** The text of a cell as a verbatim field holds it: a stored boolean as the sheet shows it, a number in its digits. */
export function verbatimText(value: RawScalar): string | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return typeof value === "number" ? String(value) : value;
}

/** Whether a name cell names somebody: a text or a number of which something is left after trimming. */
export function holdsName(value: RawScalar): boolean {
  return (typeof value === "string" || typeof value === "number") && String(value).trim() !== "";
}

/**
 * The classes of a row of a contributor sheet, decided on trimmed values. Every row of the
 * used range is classified, because checkbox columns hold a stored `FALSE` in every row of a
 * table that was left at its default length.
 *
 * | Class         | Test                                               | Handling                    |
 * |---------------|----------------------------------------------------|-----------------------------|
 * | `contributor` | First name and surname both present                | Imported                    |
 * | `halfNamed`   | Exactly one of the two present                     | Review, no import           |
 * | `placeholder` | No name, and a value that is no checkbox value     | Annotation of the table, review |
 * | `strayTick`   | No name, no other data, at least one `TRUE`        | Review                      |
 * | `filler`      | No name and nothing except `FALSE`                 | Skipped and counted         |
 * | `blank`       | Nothing                                            | Skipped and counted         |
 */
export type ContributorRowClass = "contributor" | "halfNamed" | "placeholder" | "strayTick" | "filler" | "blank";

export function classifyRow(
  firstName: RawScalar,
  surname: RawScalar,
  others: readonly RawScalar[],
): ContributorRowClass {
  const named = [holdsName(firstName), holdsName(surname)].filter(Boolean).length;
  if (named === 2) return "contributor";
  if (named === 1) return "halfNamed";
  // A stored boolean in a name cell is no name. It counts with the other cells of the row.
  const readings = [firstName, surname, ...others].map(readCheckbox);
  if (readings.some((reading) => reading.odd)) return "placeholder";
  if (readings.some((reading) => reading.tick === true)) return "strayTick";
  return readings.some((reading) => reading.tick === false) ? "filler" : "blank";
}

/** The words that state a rule for the order of authors in place of a number, as they are compared. */
export const ORDER_RULES = ["alphabetical", "last"] as const;
export type OrderRule = (typeof ORDER_RULES)[number];

export type OrderReading =
  | { readonly kind: "absent" }
  | { readonly kind: "number"; readonly order: number }
  | { readonly kind: "rule"; readonly rule: OrderRule }
  /** A fraction, a negative number or any other text. It is kept verbatim and goes to review. */
  | { readonly kind: "unread" };

/**
 * Reads the order in publication. A number is an order only when its stored value is whole, a
 * blank stays absent, and nothing is ever derived from the position of the row.
 */
export function readOrder(value: RawScalar): OrderReading {
  if (value === null || (typeof value === "string" && value.trim() === "")) return { kind: "absent" };
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && value <= 100_000
      ? { kind: "number", order: value }
      : { kind: "unread" };
  }
  if (typeof value !== "string") return { kind: "unread" };
  const rule = ORDER_RULES.find((candidate) => candidate === value.trim().toLowerCase());
  return rule === undefined ? { kind: "unread" } : { kind: "rule", rule };
}

/** The shape of an ORCID iD, bare or as an address on `orcid.org`, whatever its check digit says. */
export const ORCID_SHAPE = /^(?:https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[\dXx]$/;

/** Whether a text holds a letter, a digit or a sign outside ASCII, which an address read by the importer never does. */
export function holdsNonAscii(text: string): boolean {
  return /[^\p{ASCII}]/u.test(text);
}

/**
 * What the cells of a column hold, for the check of a header against its content and for the
 * validation of a column override.
 *
 * | Kind       | Every cell that holds something is                    |
 * |------------|-------------------------------------------------------|
 * | `empty`    | (the column holds nothing)                            |
 * | `integers` | A whole number                                        |
 * | `order`    | A whole number or one of the words of an order rule   |
 * | `booleans` | A stored boolean, or the text `TRUE` or `FALSE`       |
 * | `orcid`    | An ORCID iD by its shape                              |
 * | `email`    | One address by its shape                              |
 * | `text`     | Anything else                                         |
 */
export type ContentKind = "empty" | "integers" | "order" | "booleans" | "orcid" | "email" | "text";

const ADDRESS_SHAPE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>().]+$/;

export function contentKindOf(values: readonly RawScalar[]): ContentKind {
  const held = values.filter((value) => !(value === null || (typeof value === "string" && value.trim() === "")));
  if (held.length === 0) return "empty";
  if (held.every((value) => typeof value === "number" && Number.isInteger(value))) return "integers";
  if (held.every((value) => readOrder(value).kind === "number" || readOrder(value).kind === "rule")) return "order";
  if (held.every((value) => !readCheckbox(value).odd)) return "booleans";
  if (held.every((value) => typeof value === "string" && ORCID_SHAPE.test(value.trim()))) return "orcid";
  if (held.every((value) => typeof value === "string" && ADDRESS_SHAPE.test(value.trim()))) return "email";
  return "text";
}

/** The pairs of adjacent characters of a text. */
function bigrams(text: string): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let index = 0; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return pairs;
}

/** The share of character pairs that two texts have in common, from 0 to 1 (the Sørensen-Dice coefficient). */
export function similarity(first: string, second: string): number {
  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;
  const [a, b] = [bigrams(first), bigrams(second)];
  let shared = 0;
  for (const [pair, count] of a) shared += Math.min(count, b.get(pair) ?? 0);
  return (2 * shared) / (first.length - 1 + second.length - 1);
}

/** The similarity from which two affiliation strings are shown to a reviewer as a possible pair. */
export const NEAR_DUPLICATE_SIMILARITY = 0.8;

/** The shortest folded string whose presence inside another one counts as containment. */
const CONTAINMENT_MIN_LENGTH = 10;

/**
 * Whether two affiliation strings may name one institution: their lookup folds differ, and
 * one contains the other or they share most of their character pairs. Such a pair is queued
 * for a reviewer. Nothing is ever merged on it.
 */
export function nearDuplicateAffiliations(first: string, second: string): boolean {
  const [a, b] = [lookupFold(first), lookupFold(second)];
  if (a === "" || b === "" || a === b) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return (
    (shorter.length >= CONTAINMENT_MIN_LENGTH && longer.includes(shorter)) ||
    similarity(a, b) >= NEAR_DUPLICATE_SIMILARITY
  );
}
