// The comparison of a stored reference with what a registry of DOIs holds for the same DOI.
// Nothing here writes or chooses: it says, field by field, whether the two agree.
//
// | Field        | Agrees when                                                                          |
// |--------------|--------------------------------------------------------------------------------------|
// | Title        | The folded titles are equal, with or without the subtitle that the registry keeps apart |
// | Year         | The stored year is one of the years that the registry gives for the work (print, online, issued) |
// | First author | The first name of the stored author string holds the family name of the first author, or is held by it |
//
// Folding removes case, diacritics, punctuation and spacing, so a title that differs in a dash,
// a full stop or a capital letter still agrees. Anything else differs and is shown to a person.
import { lookupFold } from "@eegml/shared";

/** What the portal holds about a cited work. A field it does not hold is undefined. */
export interface StoredReference {
  readonly title?: string;
  readonly year?: number;
  /** The author string as stored, in whatever style the source wrote it. */
  readonly authors?: string;
}

/** What the registry returned for a DOI. */
export interface RetrievedWork {
  readonly doi: string;
  readonly title: string | null;
  readonly subtitle: string | null;
  /** Every year that the registry gives for the work, in ascending order. */
  readonly years: readonly number[];
  readonly firstAuthorFamily: string | null;
  readonly firstAuthorGiven: string | null;
  readonly containerTitle: string | null;
  readonly type: string | null;
}

/**
 * | Value          | Meaning                                         |
 * |----------------|-------------------------------------------------|
 * | `same`         | Both sides state the field and they agree       |
 * | `differs`      | Both sides state the field and they disagree    |
 * | `notStated`    | The portal holds no value for the field         |
 * | `notRetrieved` | The registry returned no value for the field    |
 */
export type FieldComparison = "same" | "differs" | "notStated" | "notRetrieved";

export interface CitationComparison {
  readonly title: FieldComparison;
  readonly year: FieldComparison;
  readonly firstAuthor: FieldComparison;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decoded = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });

/**
 * The text of a title without the markup that a registry may keep in it. An entity is decoded
 * up to three times, because registries hold titles in which an ampersand was encoded twice.
 */
export function plainTitle(title: string): string {
  let text = title.replace(/<[^>]*>/g, "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded(text);
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** The part of an author string that names its first author: everything before the first separator. */
export function firstAuthorPart(authors: string): string {
  return (authors.split(/[,;&]|\s+and\s+|\s+et\s+al/i)[0] ?? "").trim();
}

function compareTitle(stored: string | undefined, work: RetrievedWork): FieldComparison {
  if (stored === undefined || lookupFold(stored) === "") return "notStated";
  if (work.title === null || lookupFold(plainTitle(work.title)) === "") return "notRetrieved";
  const wanted = lookupFold(stored);
  const main = lookupFold(plainTitle(work.title));
  const full = work.subtitle === null ? main : main + lookupFold(plainTitle(work.subtitle));
  return wanted === main || wanted === full ? "same" : "differs";
}

function compareYear(stored: number | undefined, work: RetrievedWork): FieldComparison {
  if (stored === undefined) return "notStated";
  if (work.years.length === 0) return "notRetrieved";
  return work.years.includes(stored) ? "same" : "differs";
}

function compareFirstAuthor(stored: string | undefined, work: RetrievedWork): FieldComparison {
  const first = stored === undefined ? "" : lookupFold(firstAuthorPart(stored));
  if (first === "") return "notStated";
  const family = work.firstAuthorFamily === null ? "" : lookupFold(work.firstAuthorFamily);
  if (family === "") return "notRetrieved";
  // A family name of two characters is too short to be found inside another name by chance alone.
  const [shorter, longer] = first.length <= family.length ? [first, family] : [family, first];
  return shorter.length >= 2 && longer.includes(shorter) ? "same" : "differs";
}

export function compareCitation(stored: StoredReference, work: RetrievedWork): CitationComparison {
  return {
    title: compareTitle(stored.title, work),
    year: compareYear(stored.year, work),
    firstAuthor: compareFirstAuthor(stored.authors, work),
  };
}

/**
 * The status that a comparison gives a citation.
 *
 * | Status       | When                                                                   |
 * |--------------|------------------------------------------------------------------------|
 * | `verified`   | Title, year and first author were all compared and all agree           |
 * | `mismatch`   | At least one of them was compared and differs                          |
 * | `unverified` | Nothing differs, and at least one of them could not be compared        |
 */
export function statusOfComparison(comparison: CitationComparison): "verified" | "mismatch" | "unverified" {
  const fields = [comparison.title, comparison.year, comparison.firstAuthor];
  if (fields.includes("differs")) return "mismatch";
  return fields.every((field) => field === "same") ? "verified" : "unverified";
}
