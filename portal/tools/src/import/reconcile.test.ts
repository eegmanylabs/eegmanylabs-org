// Unit tests of the builders of reconciliation items. Subjects and values are invented.
import { reconciliationKindSchema } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { itemBuilders, PERSONAL_KINDS, statesSealedValue } from "./reconcile";

const SECRET = "a-synthetic-secret-for-tests-of-32-bytes-or-more";
const items = itemBuilders(SECRET);

const conflict = (overrides: { readonly liveValue?: string; readonly rowNumberNote?: string } = {}) =>
  items.valueConflict({
    subject: "AlphaBeta2001",
    field: "theme",
    entityRefs: [{ entityType: "replication", entityId: "AlphaBeta2001" }],
    claims: [
      { source: "portal", value: overrides.liveValue ?? "Memory", valueSource: overrides.liveValue ?? "Memory" },
      { source: "h/replications", value: "Attention", valueSource: "Attention", sourceRecordId: "record-1" },
    ],
  });

describe("itemBuilders", () => {
  it("has a builder for every kind of the plan", () => {
    expect(Object.keys(items).sort()).toEqual([...reconciliationKindSchema.options].sort());
    expect(Object.keys(PERSONAL_KINDS).sort()).toEqual([...reconciliationKindSchema.options].sort());
  });

  it("gives the same disagreement the same fingerprint on every run", () => {
    expect(conflict().fingerprint).toBe(conflict().fingerprint);
    expect(conflict().fingerprint).toMatch(/^[0-9a-f]{20}$/);
  });

  it("leaves source records, batches and the order of the claims out of the fingerprint", () => {
    const reordered = items.valueConflict({
      subject: "AlphaBeta2001",
      field: "theme",
      claims: [
        { source: "h/replications", value: "Attention", sourceRecordId: "another-revision" },
        { source: "portal", value: "Memory" },
      ],
    });
    expect(reordered.fingerprint).toBe(conflict().fingerprint);
  });

  it("gives a new fingerprint when a value, the field, the subject or the kind changes", () => {
    const base = conflict().fingerprint;
    expect(conflict({ liveValue: "Emotion" }).fingerprint).not.toBe(base);
    const claims = [
      { source: "portal", value: "Memory" },
      { source: "h/replications", value: "Attention" },
    ];
    expect(items.valueConflict({ subject: "AlphaBeta2001", field: "psychConstruct", claims }).fingerprint).not.toBe(
      base,
    );
    expect(items.valueConflict({ subject: "AlphaGamma2002", field: "theme", claims }).fingerprint).not.toBe(base);
    expect(items.vocabularyReview({ subject: "AlphaBeta2001", field: "theme", claims }).fingerprint).not.toBe(base);
  });

  it("keys the hash of a personal value with the secret, so that the candidate key cannot be reversed by guessing", () => {
    const claims = [{ source: "h/people", value: "Ada Example", valueSource: "Ada Example" }];
    const personal = items.duplicatePerson({ subject: "p__one+p__two", claims });
    const other = itemBuilders(`${SECRET}-of-another-environment`).duplicatePerson({
      subject: "p__one+p__two",
      claims,
    });
    const plain = items.vocabularyReview({ subject: "p__one+p__two", claims });
    expect(personal.fingerprint).not.toBe(other.fingerprint);
    expect(personal.candidates[0]?.key).not.toBe(other.candidates[0]?.key);
    expect(personal.candidates[0]?.key).not.toBe(plain.candidates[0]?.key);
    expect(personal.candidates[0]?.key).toMatch(/^h\/people:[0-9a-f]{20}$/);
  });

  it("stores the value as written for the reviewer, and leaves a value out that is too long for the field", () => {
    const long = "x".repeat(10_001);
    const item = items.annotationReview({
      subject: "b/t0/note",
      claims: [
        { source: "b/t0", value: "short", valueSource: " short ", sourceRecordId: "record-1" },
        { source: "b/t0", value: long, valueSource: long, sourceRecordId: "record-2" },
      ],
    });
    const byRecord = new Map(item.candidates.map((candidate) => [candidate.sourceRecordId, candidate]));
    expect(byRecord.get("record-1")).toMatchObject({ valueSource: " short ", sourceRecordId: "record-1" });
    expect(byRecord.get("record-2")).not.toHaveProperty("valueSource");
    expect(item.blocking).toBe(false);
    expect(item.kind).toBe("annotationReview");
  });

  it("gives every statement of a shared question one key, whatever its candidates, and no key to any other item", () => {
    const first = items.duplicatePerson({
      subject: "contributorName/aa",
      shared: true,
      claims: [{ source: "ctable__one", value: "row-one" }],
    });
    const fuller = items.duplicatePerson({
      subject: "contributorName/aa",
      shared: true,
      claims: [
        { source: "ctable__one", value: "row-one" },
        { source: "ctable__two", value: "row-two" },
      ],
    });
    expect(first.fingerprint).not.toBe(fuller.fingerprint);
    expect(first.subjectKey).toMatch(/^[0-9a-f]{20}$/);
    expect(fuller.subjectKey).toBe(first.subjectKey);
    // The key follows the kind, the subject and the field.
    const about = { subject: "contributorName/aa", shared: true, claims: [] } as const;
    expect(items.ambiguousEmail(about).subjectKey).not.toBe(first.subjectKey);
    expect(items.duplicatePerson({ ...about, field: "email" }).subjectKey).not.toBe(first.subjectKey);
    expect(items.duplicatePerson({ ...about, subject: "contributorName/bb" }).subjectKey).not.toBe(first.subjectKey);
    expect(items.duplicatePerson({ subject: "contributorName/aa", claims: [] })).not.toHaveProperty("subjectKey");
  });

  it("refuses a subject that is empty or spans lines", () => {
    expect(() => items.unparsedValue({ subject: "", claims: [] })).toThrow(RangeError);
    expect(() => items.unparsedValue({ subject: "one\ntwo", claims: [] })).toThrow(RangeError);
  });

  it("gives an item the same fingerprint in whatever order its claims were made, and keeps the order of the claims", () => {
    const claims = [
      { source: "f/leads", value: "b", valueSource: "B", sourceRecordId: "record-2" },
      { source: "f/counts", value: "a", valueSource: "A", sourceRecordId: "record-1" },
    ];
    const forward = items.conflictingLead({ subject: "Delta1999", claims });
    const backward = items.conflictingLead({ subject: "Delta1999", claims: [...claims].reverse() });
    expect(backward.fingerprint).toBe(forward.fingerprint);
    // The first claim is what the importer states first, such as the stored value before the expected one.
    expect(forward.candidates.map((candidate) => candidate.sourceRecordId)).toEqual(["record-2", "record-1"]);
  });
});

describe("statesSealedValue", () => {
  it("seals the outcome labels, the null-significance labels and the links to the market's documents (questions 7 and 22)", () => {
    expect(statesSealedValue("e/hypotheses/replicated", "labelsSource")).toBe(true);
    expect(statesSealedValue("e/hypotheses/null-sig", "nullSigSource")).toBe(true);
    for (const column of ["studyDescr_pdf", "infosheet_link"]) {
      for (const claim of ["target", "text", "noAddress"]) {
        expect(statesSealedValue(`e/hypotheses/${column}/${claim}`, column), `${column}/${claim}`).toBe(true);
      }
    }
    // A value of a row outside the list of its column is a label of that row.
    expect(statesSealedValue("e/hypotheses", "null-sig")).toBe(true);
    expect(statesSealedValue("e/hypotheses", "replicated")).toBe(true);
  });

  it("leaves shown what names no row's label or link: an option of a list, and the label of a link as a spelling", () => {
    expect(statesSealedValue("e/hypotheses/list", "null-sig")).toBe(false);
    expect(statesSealedValue("e/hypotheses/list", "replicated")).toBe(false);
    expect(statesSealedValue("e/hypotheses/infosheet_link", "sourceLabel")).toBe(false);
    expect(statesSealedValue("e/hypotheses", "originalTitle")).toBe(false);
  });

  it("hides the value of a sealed claim and keys its hash with the subject, whatever the call site says", () => {
    const item = items.linkDefect({
      subject: "AlphaBeta2001",
      field: "studyDescr_pdf",
      claims: [
        {
          source: "e/hypotheses/studyDescr_pdf/target",
          value: "https://example.org/a",
          valueSource: "https://example.org/a",
        },
      ],
    });
    expect(item.sealed).toBe(true);
    expect(item.candidates[0]).not.toHaveProperty("valueSource");
  });
});
