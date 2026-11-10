// The guard that stands between a plan and the database (docs/MIGRATION_PLAN.md, sections 8
// and 10). It reads every planned document before anything is compared or written, so a preview
// already shows what it finds and an apply cannot write it.
//
// | Check             | What it refuses                                                                                 |
// |-------------------|-------------------------------------------------------------------------------------------------|
// | `address`         | An email-shaped text in a document that every member can read, and in the path of any document  |
// | `identifier`      | An identifier that holds a word of a name or an address of the row it comes from                 |
// | `specialCategory` | A special-category cell of a row in a planned document that is no special-category document, or in an item |
//
// A finding blocks the batch and raises one item that names the source records, the collection
// and the fields. It never holds the value, and it never holds a path that failed the check.
import { lookupFold } from "@eegml/shared";
import { entryOf } from "./context";
import type { ImportPlan, PlannedDocument, PlannedItem, RawCell, RecordedRow } from "./model";
import type { ItemBuilders } from "./reconcile";
import { byCodePoint } from "./values";

export type GuardCheck = "address" | "identifier" | "specialCategory";

export interface GuardFinding {
  readonly check: GuardCheck;
  readonly collection: string;
  /** The fields that hold the value, or `(identifier)` for the path itself. */
  readonly fields: readonly string[];
  readonly recordIds: readonly string[];
}

/** The shape of an email address anywhere in a text. */
export const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** The shortest word of a name that the identifier check looks for. A shorter one stands in too many ordinary words. */
const MINIMUM_NAME_WORD = 3;
/** The shortest special-category term that the check compares. A code of one or two letters equals too much. */
const MINIMUM_SPECIAL_TERM = 3;
/** A part of an identifier that is a hash, which holds no word of anything. */
const HASH_PART = /^[0-9a-f]{12,64}$/;
const IDENTIFIER_FIELD = "(identifier)";

const textOf = (cell: RawCell | undefined): string | null => {
  const value = cell !== null && typeof cell === "object" ? (cell.v ?? null) : (cell ?? null);
  return typeof value === "string" ? value : null;
};

/** Every text of a value, however deeply it is nested. */
function* textsIn(value: unknown): Generator<string> {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const member of value) yield* textsIn(member);
  else if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const member of Object.values(value)) yield* textsIn(member);
  }
}

/** The fields of a planned document with the texts that each would hold. */
function fieldTexts(document: PlannedDocument): Map<string, string[]> {
  const texts = new Map<string, string[]>();
  for (const fields of [document.fixed, document.owned, document.union]) {
    for (const [field, value] of Object.entries(fields)) {
      texts.set(field, [...(texts.get(field) ?? []), ...textsIn(value)]);
    }
  }
  return texts;
}

const wordsOf = (text: string): string[] =>
  text
    .split(/[^\p{L}\p{N}]+/u)
    .map(lookupFold)
    .filter((word) => word !== "");

/** Checks a plan against the rows it was made from. Returns nothing where the plan is clean. */
export function guardPlan(plan: ImportPlan, rows: ReadonlyMap<string, readonly RecordedRow[]>): GuardFinding[] {
  const byRecord = new Map<string, RecordedRow>();
  for (const tab of rows.values()) for (const row of tab) byRecord.set(row.recordId, row);
  const nameWords = new Map<string, Set<string>>();
  const specialTerms = new Map<string, Set<string>>();
  for (const row of byRecord.values()) {
    const words = (row.personal ?? []).flatMap((label) => wordsOf(textOf(row.cells[row.labels.indexOf(label)]) ?? ""));
    const usable = words.filter((word) => word.length >= MINIMUM_NAME_WORD && !HASH_PART.test(word));
    if (usable.length > 0) nameWords.set(row.recordId, new Set(usable));
    const terms = Object.values(row.special ?? {})
      .map((cell) => (textOf(cell) ?? "").trim().toLowerCase())
      .filter((term) => term.length >= MINIMUM_SPECIAL_TERM);
    if (terms.length > 0) specialTerms.set(row.recordId, new Set(terms));
  }

  const findings: GuardFinding[] = [];
  const add = (check: GuardCheck, document: PlannedDocument, fields: readonly string[]) =>
    findings.push({
      check,
      collection: document.collection,
      fields: [...new Set(fields)].sort(byCodePoint),
      recordIds: [...document.sourceRecordIds],
    });
  for (const document of plan.documents) {
    const entry = entryOf(document.collection);
    const texts = fieldTexts(document);
    const holding = (test: (text: string) => boolean) =>
      [...texts].filter(([, values]) => values.some(test)).map(([field]) => field);

    const addressed = ["public", "member"].includes(entry.dataClass) ? holding((text) => EMAIL_SHAPED.test(text)) : [];
    if (document.ids.some((id) => id.includes("@"))) addressed.push(IDENTIFIER_FIELD);
    if (addressed.length > 0) add("address", document, addressed);

    const idWords = new Set(document.ids.flatMap(wordsOf).filter((word) => !HASH_PART.test(word)));
    const named = document.sourceRecordIds.some((recordId) =>
      [...(nameWords.get(recordId) ?? [])].some((word) => idWords.has(word)),
    );
    if (named) add("identifier", document, [IDENTIFIER_FIELD]);

    if (entry.dataClass !== "special") {
      const terms = new Set(document.sourceRecordIds.flatMap((recordId) => [...(specialTerms.get(recordId) ?? [])]));
      const special = terms.size === 0 ? [] : holding((text) => terms.has(text.trim().toLowerCase()));
      if (special.length > 0) add("specialCategory", document, special);
    }
  }
  for (const item of plan.items) {
    // An item is read by those who work the queue, who hold no grant for special-category data.
    const recordIds = item.candidates.flatMap((candidate) =>
      candidate.sourceRecordId !== undefined &&
      candidate.valueSource !== undefined &&
      specialTerms.get(candidate.sourceRecordId)?.has(candidate.valueSource.trim().toLowerCase())
        ? [candidate.sourceRecordId]
        : [],
    );
    if (recordIds.length > 0) {
      findings.push({ check: "specialCategory", collection: "reconciliationItems", fields: ["candidates"], recordIds });
    }
  }
  return findings;
}

const MESSAGES: Readonly<Record<GuardCheck, string>> = {
  address: "hold an email-shaped text where every member can read it, or in their path",
  identifier: "have an identifier that holds a word of a name or an address of their own row",
  specialCategory: "hold a special-category cell of their row outside a special-category document",
};

/** The most source records that one item of the guard names. The others are counted in the message. */
const MAX_NAMED_RECORDS = 50;

/**
 * Adds the findings of the guard to a plan: one blocking check and one blocking item for each
 * check and collection. The item names source records and fields, and no value.
 */
export function withGuard(
  plan: ImportPlan,
  findings: readonly GuardFinding[],
  sourceKey: string,
  items: ItemBuilders,
): ImportPlan {
  if (findings.length === 0) return plan;
  const grouped = new Map<string, GuardFinding[]>();
  for (const finding of findings) {
    const key = `${finding.check}/${finding.collection}`;
    grouped.set(key, [...(grouped.get(key) ?? []), finding]);
  }
  const blocking = [...plan.blocking];
  const added: PlannedItem[] = [];
  for (const [key, group] of [...grouped].sort(([a], [b]) => byCodePoint(a, b))) {
    const [first] = group;
    if (first === undefined) continue;
    const fields = [...new Set(group.flatMap((finding) => finding.fields))].sort(byCodePoint);
    const recordIds = [...new Set(group.flatMap((finding) => finding.recordIds))].sort(byCodePoint);
    blocking.push({
      check: `privacy/${first.check}`,
      message:
        `${group.length} planned documents of ${first.collection} ${MESSAGES[first.check]} ` +
        `(fields: ${fields.join(", ")}; ${recordIds.length} source records). Nothing is written until the source is corrected.`,
    });
    added.push({
      ...items.privacyReview({
        subject: `${sourceKey}/guard/${key}`,
        field: first.check,
        claims: [
          ...fields.map((field) => ({ source: `guard/${first.check}/field`, value: field, valueSource: field })),
          ...recordIds
            .slice(0, MAX_NAMED_RECORDS)
            .map((recordId) => ({ source: `guard/${first.check}/row`, value: recordId, sourceRecordId: recordId })),
        ],
      }),
      blocking: true,
    });
  }
  const stated = new Set(plan.items.map((item) => item.fingerprint));
  return { ...plan, blocking, items: [...plan.items, ...added.filter((item) => !stated.has(item.fingerprint))] };
}
