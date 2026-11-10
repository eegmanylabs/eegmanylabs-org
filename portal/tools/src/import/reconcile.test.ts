// Unit tests of the builders of reconciliation items. Subjects and values are invented.
import { reconciliationKindSchema } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { itemBuilders, PERSONAL_KINDS } from "./reconcile";

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
    expect(item.candidates[0]).toMatchObject({ valueSource: " short ", sourceRecordId: "record-1" });
    expect(item.candidates[1]).not.toHaveProperty("valueSource");
    expect(item.blocking).toBe(false);
    expect(item.kind).toBe("annotationReview");
  });

  it("refuses a subject that is empty or spans lines", () => {
    expect(() => items.unparsedValue({ subject: "", claims: [] })).toThrow(RangeError);
    expect(() => items.unparsedValue({ subject: "one\ntwo", claims: [] })).toThrow(RangeError);
  });
});
