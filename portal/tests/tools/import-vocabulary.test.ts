// Integration tests of the importer of the community vocabulary (source C) against the Firestore
// emulator. The workbook is synthetic: every term, abbreviation, description and code in it is
// invented, and nothing is copied from the real sheet.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { shortHash } from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  VOCABULARY_ROWS,
  type VocabularyRow,
  type VocabularyWorkbookOptions,
  vocabularyWorkbook,
} from "../../tools/src/import/fixtures/vocabulary";
import { itemBuilders } from "../../tools/src/import/reconcile";
import { importer as vocabulary } from "../../tools/src/import/sources/community-vocabulary";
import { adminDb } from "../support/admin";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

async function workbookFile(options: VocabularyWorkbookOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "community-vocabulary.xlsx");
  writeFileSync(file, await vocabularyWorkbook(options));
  return file;
}

const rowsWith = (id: string, change: Partial<VocabularyRow>): VocabularyRow[] =>
  VOCABULARY_ROWS.map((row) => (row.id === id ? { ...row, ...change } : row));

const term = async (id: string) => (await adminDb.doc(`vocabularyTerms/${id}`).get()).data();

/** The terms that source C wrote. The seeding command and other sources write terms of other kinds. */
async function communityTerms() {
  return new Map([...(await documentsOf("vocabularyTerms"))].filter(([, data]) => data.kind === "community"));
}

async function sourceRecords() {
  const snapshot = await adminDb.collection("sourceRecords").where("sourceKey", "==", "c").get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
}

const recordOf = async (rowKey: string) => (await sourceRecords()).find((record) => record.rowKey === rowKey);

const items = itemBuilders(TEST_HASH_KEY);

interface Candidate {
  readonly key: string;
  readonly valueSource?: string;
  readonly sourceRecordId?: string;
}

/** The candidates of a stored item, or none for an item that was not found. */
const candidatesOf = (item: DocumentData | undefined): Candidate[] => (item?.candidates ?? []) as Candidate[];

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the community vocabulary importer", () => {
  it("captures every row of the used range, with an empty cell kept apart from a text", async () => {
    const report = await run(vocabulary, await workbookFile({ blankRowAbove: "trm_008" }), "preview");
    // The cells that are only formatted in advance, down to row 60, are no rows at all.
    expect(report.tabs).toEqual([
      expect.objectContaining({
        tabKey: "t0",
        cellAnnotations: 0,
        rows: expect.objectContaining({ header: 1, data: 8, annotation: 0, blank: 1 }),
        imported: 8,
        queued: 0,
        rawOnly: {},
        unaccounted: 0,
      }),
    ]);
    const records = await sourceRecords();
    expect(records).toHaveLength(1 + 8);
    // The row key is the identifier as written, and the row number is provenance only.
    expect(await recordOf("trm_001")).toMatchObject({
      tabKey: "t0",
      rowNumber: 2,
      raw: {
        A: { v: "trm_001", t: "string" },
        B: { v: "Participant - Invented Mood Inventory (Morning Form)", t: "string" },
        C: { v: "IMI-Morning", t: "string" },
        D: { v: "Invented morning mood (asked in person)", t: "string" },
        // The unused column: a cell that holds nothing is null, which is no empty text.
        E: null,
        F: { v: "snomed:900001007", t: "string" },
      },
    });
    expect((await recordOf("trm_008"))?.rowNumber).toBe(10);
    expect((await recordOf("trm_003"))?.raw).toMatchObject({ E: null, F: null });
    expect((await adminDb.doc("sources/c/tabs/t0").get()).data()).toMatchObject({
      name: "Sheet1",
      visibility: "visible",
      headerRow: 1,
      rowCount: 8,
      importerKey: "communityVocabulary",
    });
    // A preview writes the raw rows and no term.
    expect((await communityTerms()).size).toBe(0);
  });

  it("writes one term for each row, keyed by its identifier as written, with every value verbatim", async () => {
    const report = await run(vocabulary, await workbookFile(), "apply");
    expect(report.status).toBe("applied");
    expect(report.collections.vocabularyTerms).toMatchObject({ created: 8, changed: 0 });
    const terms = await communityTerms();
    expect([...terms.keys()].sort()).toEqual(VOCABULARY_ROWS.map((row) => row.id));
    const first = await recordOf("trm_001");
    expect(terms.get("trm_001")).toMatchObject({
      sourceId: "trm_001",
      kind: "community",
      name: "Participant - Invented Mood Inventory (Morning Form)",
      abbreviation: "IMI-Morning",
      description: "Invented morning mood (asked in person)",
      // The external code is stored as written and is resolved to nothing.
      sameAsSource: ["snomed:900001007"],
      labelsSource: ["Participant - Invented Mood Inventory (Morning Form)"],
      isDeprecated: false,
      sourceRecordIds: [first?.id],
    });
    expect(terms.get("trm_001")).not.toHaveProperty("invalidReason");
    // Nothing is corrected: two spaces stay two spaces, and transposed letters stay transposed.
    expect(terms.get("trm_004")?.description).toBe("has a made-up condition  (asked in person)");
    expect(terms.get("trm_007")?.abbreviation).toBe("DEMO-Taks");
    expect(terms.get("trm_003")?.sameAsSource).toEqual([]);
    // Two terms that share one external code stay two terms.
    expect(terms.get("trm_002")?.sameAsSource).toEqual(terms.get("trm_001")?.sameAsSource);
    expect(await schemaProblems()).toEqual([]);
  });

  it("raises one item for each thing a person has to confirm, under a fingerprint that the same sheet gives again", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    expect(await itemCounts()).toEqual({ vocabularyReview: 5, annotationReview: 1 });
    const record = async (id: string) => String((await recordOf(id))?.id);
    const expected = [
      // One external code that two terms share.
      items.vocabularyReview({
        subject: `c/t0/sameAs/${shortHash("snomed:900001007")}`,
        field: "same_as",
        claims: ["trm_001", "trm_002"].map((id) => ({ source: `c/t0/${id}`, value: "snomed:900001007" })),
      }),
      // A code from the extension of one namespace.
      items.vocabularyReview({
        subject: "c/t0/trm_004",
        field: "same_as",
        claims: [{ source: "c/t0/same_as/extension", value: "snomed:90000501000000106" }],
      }),
      // A type that only the name states.
      items.vocabularyReview({
        subject: "c/t0/trm_006",
        field: "valueType",
        claims: [{ source: "c/t0/name", value: "integer" }],
      }),
      // Two families of abbreviations, each a suggestion of a finer kind.
      items.vocabularyReview({
        subject: "c/t0/family/imi",
        field: "abbreviation",
        claims: ["trm_001", "trm_002"].map((id) => ({ source: `c/t0/${id}`, value: "IMI" })),
      }),
      items.vocabularyReview({
        subject: "c/t0/family/demo",
        field: "abbreviation",
        claims: ["trm_005", "trm_006", "trm_007"].map((id) => ({ source: `c/t0/${id}`, value: "DEMO" })),
      }),
      // Stray white space, to be reported to the owner of the sheet.
      items.annotationReview({
        subject: "c/t0/trm_004",
        field: "description",
        claims: [{ source: "c/t0/whitespace", value: "has a made-up condition  (asked in person)" }],
      }),
    ];
    const stored = await reconciliationItems();
    expect(stored.map((item) => item.id).sort()).toEqual(expected.map((item) => item.fingerprint).sort());
    const shared = stored.find((item) => item.id === expected[0]?.fingerprint);
    expect(shared).toMatchObject({ kind: "vocabularyReview", sourceKey: "c", status: "open" });
    expect(candidatesOf(shared).map((candidate) => candidate.sourceRecordId)).toEqual([
      await record("trm_001"),
      await record("trm_002"),
    ]);
    // Row numbers are no part of a fingerprint: the same terms one row further down raise nothing new.
    const before = await allDocuments();
    await run(vocabulary, await workbookFile({ blankRowAbove: "trm_001" }), "apply");
    const { created } = differences(before, await allDocuments());
    expect(created.filter((documentPath) => documentPath.startsWith("reconciliationItems/"))).toEqual([]);
    expect(await itemCounts()).toEqual({ vocabularyReview: 5, annotationReview: 1 });
  });

  it("writes nothing on a second run of the same sheet, and passes its verification", async () => {
    const file = await workbookFile();
    await run(vocabulary, file, "apply");
    const before = await allDocuments();
    const second = await run(vocabulary, file, "apply");
    expect(second.documentsWritten).toBe(0);
    expect(second.changesCommitted).toBe(0);
    expect(second.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0, seen: 9 });
    const { created, removed, rewritten } = differences(before, await allDocuments());
    expect(created).toEqual([`importBatches/${second.batchId}`]);
    expect(removed).toEqual([]);
    expect(rewritten).toEqual([]);
    // Another export of the same sheet has another file hash and the same rows.
    const again = await run(vocabulary, await workbookFile({ formattedDownTo: 90 }), "apply");
    expect(again.documentsWritten).toBe(0);
    const checks = await verify(vocabulary, file);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("marks a term with a reason as deprecated and keeps it, and asks once about each distinct reason", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const retired = VOCABULARY_ROWS.map((row) =>
      row.id === "trm_003" || row.id === "trm_008"
        ? { ...row, invalidReason: " duplicate " }
        : row.id === "trm_005"
          ? { ...row, invalidReason: "retired on an invented date" }
          : row.id === "trm_006"
            ? { ...row, invalidReason: "   " }
            : row,
    );
    const report = await run(vocabulary, await workbookFile({ rows: retired }), "apply");
    expect(report.collections.vocabularyTerms).toMatchObject({ created: 0, changed: 3 });
    expect(report.collections.vocabularyTerms?.fields).toEqual({ invalidReason: 3, isDeprecated: 3 });
    // The document and its identifier stay. The reason is kept as written.
    expect(await term("trm_003")).toMatchObject({
      isDeprecated: true,
      invalidReason: " duplicate ",
      sourceId: "trm_003",
    });
    expect(await term("trm_005")).toMatchObject({ isDeprecated: true, invalidReason: "retired on an invented date" });
    // A reason of white space alone is no reason.
    expect(await term("trm_006")).toMatchObject({ isDeprecated: false });
    expect(await term("trm_006")).not.toHaveProperty("invalidReason");
    const reasons = (await reconciliationItems()).filter((item) => item.field === "invalid_reason");
    expect(reasons).toHaveLength(2);
    expect(reasons.map((item) => item.id).sort()).toEqual(
      [
        items.vocabularyReview({
          subject: `c/t0/invalidReason/${shortHash("duplicate")}`,
          field: "invalid_reason",
          claims: [{ source: "c/t0/invalid_reason", value: "duplicate" }],
        }).fingerprint,
        items.vocabularyReview({
          subject: `c/t0/invalidReason/${shortHash("retired on an invented date")}`,
          field: "invalid_reason",
          claims: [{ source: "c/t0/invalid_reason", value: "retired on an invented date" }],
        }).fingerprint,
      ].sort(),
    );
    // When the sheet takes the reason back, the term is valid again and the question is closed.
    await run(vocabulary, await workbookFile(), "apply");
    expect(await term("trm_003")).toMatchObject({ isDeprecated: false });
    expect(await term("trm_003")).not.toHaveProperty("invalidReason");
    const closed = (await reconciliationItems()).filter((item) => reasons.some((reason) => reason.id === item.id));
    expect(closed.map((item) => item.status)).toEqual(["cleared", "cleared"]);
  });

  it("stores no external code that fails its checks, and sends each to review", async () => {
    const rows: VocabularyRow[] = [
      {
        id: "trm_001",
        name: "Meta - Invented one",
        abbreviation: "ONE",
        description: "one",
        sameAs: "snomed:900001008",
      },
      { id: "trm_002", name: "Meta - Invented two", abbreviation: "TWO", description: "two", sameAs: "icd10:F00" },
      { id: "trm_003", name: "Meta - Invented three", abbreviation: "THREE", description: "three", sameAs: "TRM_001" },
      { id: "trm_004", name: "Meta - Invented four", abbreviation: "FOUR", description: "four", sameAs: "900001007" },
      {
        id: "trm_005",
        name: "Meta - Invented five",
        abbreviation: "FIVE",
        description: "five",
        sameAs: " snomed:900002000",
      },
    ];
    await run(vocabulary, await workbookFile({ rows }), "apply");
    for (const id of ["trm_001", "trm_002", "trm_003", "trm_004"]) expect((await term(id))?.sameAsSource).toEqual([]);
    // An accepted code is stored exactly as the cell holds it, leading space included.
    expect((await term("trm_005"))?.sameAsSource).toEqual([" snomed:900002000"]);
    const checks = (await reconciliationItems())
      .filter((item) => item.field === "same_as")
      .map((item) => candidatesOf(item)[0]?.key.split(":")[0])
      .sort();
    expect(checks).toEqual([
      "c/t0/same_as/checkDigit",
      "c/t0/same_as/localIdentifier",
      "c/t0/same_as/shape",
      "c/t0/same_as/unknownPrefix",
    ]);
    // The cells themselves stay in the source records, whatever became of them.
    expect((await recordOf("trm_002"))?.raw).toMatchObject({ F: { v: "icd10:F00", t: "string" } });
  });

  it("imports a term whose identifier or name departs from the usual form, and says so", async () => {
    const rows: VocabularyRow[] = [
      ...VOCABULARY_ROWS,
      { id: "invented-term_9", name: "Meta - An identifier of another form", abbreviation: "OTHER", description: "x" },
      { id: "trm_010", name: "A name without a category", abbreviation: "NOCAT", description: "x" },
      {
        id: "trm_011",
        name: "Instrument - A category the sheet does not use",
        abbreviation: "NEWCAT",
        description: "x",
      },
    ];
    const report = await run(vocabulary, await workbookFile({ rows }), "apply");
    expect(report.collections.vocabularyTerms).toMatchObject({ created: 11 });
    expect(await term("invented-term_9")).toMatchObject({ sourceId: "invented-term_9", kind: "community" });
    expect(await term("trm_010")).toMatchObject({ name: "A name without a category" });
    const raised = (await reconciliationItems()).map((item) => item.id);
    for (const expected of [
      items.vocabularyReview({
        subject: "c/t0/invented-term_9",
        field: "id",
        claims: [{ source: "c/t0/pattern", value: "invented-term_9" }],
      }),
      items.vocabularyReview({
        subject: "c/t0/trm_010",
        field: "name",
        claims: [{ source: "c/t0/category", value: "" }],
      }),
      items.vocabularyReview({
        subject: "c/t0/trm_011",
        field: "name",
        claims: [{ source: "c/t0/category", value: "Instrument" }],
      }),
    ]) {
      expect(raised).toContain(expected.fingerprint);
    }
  });

  it("accounts for a row without a name and for content without an identifier, and imports neither", async () => {
    const rows: VocabularyRow[] = [
      ...VOCABULARY_ROWS,
      { id: "trm_009", abbreviation: "NONAME", description: "a term that the sheet has not named yet" },
      { name: "Meta - A row that has lost its identifier", abbreviation: "NOID" },
    ];
    const report = await run(vocabulary, await workbookFile({ rows }), "apply");
    expect(report.tabs[0]).toMatchObject({
      rows: expect.objectContaining({ data: 9, annotation: 1 }),
      imported: 8,
      queued: 1,
      unaccounted: 0,
    });
    expect((await communityTerms()).size).toBe(8);
    expect(await term("trm_009")).toBeUndefined();
    const counts = await itemCounts();
    expect(counts.vocabularyReview).toBe(6);
    expect(counts.annotationReview).toBe(2);
    const checks = await verify(vocabulary, await workbookFile({ rows }));
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("keeps an unknown extra column raw and reports it, and never maps data under a blank header", async () => {
    const rows = rowsWith("trm_002", { extra: "an invented remark" });
    await run(vocabulary, await workbookFile({ rows, extraHeader: "Status" }), "apply");
    expect((await recordOf("trm_002"))?.raw).toMatchObject({ G: { v: "an invented remark", t: "string" } });
    expect(await term("trm_002")).not.toHaveProperty("status");
    expect(await itemCounts()).toMatchObject({ structureChange: 1 });
    expect((await communityTerms()).size).toBe(8);
    await freshDatabase();
    await run(vocabulary, await workbookFile({ rows }), "apply");
    const [blank] = (await reconciliationItems()).filter((item) => item.kind === "structureChange");
    expect(candidatesOf(blank)[0]?.key).toMatch(/^c\/t0\/blankHeader:/);
    expect((await communityTerms()).size).toBe(8);
  });

  it("compares the headers after trimming and without regard to case", async () => {
    const headers = [" ID ", "Name", "ABBREVIATION", "description ", "Invalid_Reason", "same_as"];
    const report = await run(vocabulary, await workbookFile({ headers }), "apply");
    expect(report.blocking).toEqual([]);
    expect((await communityTerms()).size).toBe(8);
  });

  it.each<[string, VocabularyWorkbookOptions, string]>([
    ["a second tab", { secondTab: true }, "tabs"],
    [
      "a missing required header",
      { headers: ["id", "name", "abbreviation", "note", "invalid_reason", "same_as"] },
      "header",
    ],
    [
      "a header that occurs twice",
      { headers: ["id", "name", "Name", "description", "invalid_reason", "same_as"] },
      "header",
    ],
    ["an identifier with a space", { rows: rowsWith("trm_003", { id: "trm 003" }) }, "id"],
    ["an identifier that is no text", { rows: rowsWith("trm_003", { id: 3 }) }, "id"],
    ["an identifier of the reserved form", { rows: rowsWith("trm_003", { id: "__trm__" }) }, "id"],
    ["an identifier that occurs twice", { rows: rowsWith("trm_003", { id: "trm_002" }) }, "id"],
    ["two identifiers that differ only by case", { rows: rowsWith("trm_003", { id: "TRM_002" }) }, "id"],
  ])("imports nothing from a sheet with %s", async (_label, options, check) => {
    const file = await workbookFile(options);
    const preview = await run(vocabulary, file, "preview");
    expect(preview.blocking.map((entry) => entry.check)).toEqual([check]);
    const report = await run(vocabulary, file, "apply");
    expect(report.status).toBe("failed");
    expect((await communityTerms()).size).toBe(0);
    // The item that explains the block is written at once, so that a reviewer can act on it.
    expect(await itemCounts()).toEqual({ structureChange: 1 });
    const checks = await verify(vocabulary, file);
    expect(checks.find((entry) => entry.key === "structure")?.passed).toBe(false);
  });

  it("leaves an earlier import untouched when a later sheet is blocked", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const before = await communityTerms();
    const report = await run(
      vocabulary,
      await workbookFile({ rows: rowsWith("trm_003", { id: "trm_002", description: "changed" }) }),
      "apply",
    );
    expect(report.status).toBe("failed");
    expect(await communityTerms()).toEqual(before);
  });
});

describe("a later import of the community vocabulary", () => {
  it("follows the sheet where one cell has changed, and keeps the earlier row", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const earlier = await recordOf("trm_003");
    const changed = rowsWith("trm_003", { description: "A description that the invented sheet now gives" });
    const report = await run(vocabulary, await workbookFile({ rows: changed }), "apply");
    expect(report.sourceRecords).toMatchObject({ created: 1, superseded: 1 });
    expect(report.collections.vocabularyTerms).toMatchObject({ created: 0, changed: 1, unchanged: 7 });
    expect(report.collections.vocabularyTerms?.fields).toEqual({ description: 1 });
    const current = (await sourceRecords()).find(
      (record) => record.rowKey === "trm_003" && record.supersededById === null,
    );
    expect(await term("trm_003")).toMatchObject({
      description: "A description that the invented sheet now gives",
      sourceRecordIds: [current?.id],
    });
    expect((await adminDb.doc(`sourceRecords/${earlier?.id}`).get()).data()).toMatchObject({
      supersededById: current?.id,
    });
  });

  it("never overwrites an edit made in the portal, and raises one conflict for it", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    await adminDb.doc("vocabularyTerms/trm_003").update({ description: "Edited by an invented administrator" });
    const changed = rowsWith("trm_003", { description: "A description that the invented sheet now gives" });
    const report = await run(vocabulary, await workbookFile({ rows: changed }), "apply");
    expect(report.conflicts).toBe(1);
    expect((await term("trm_003"))?.description).toBe("Edited by an invented administrator");
    // The value the sheet now gives is recorded beside the live one.
    expect((await term("trm_003"))?.importedValues).toMatchObject({
      description: "A description that the invented sheet now gives",
    });
    expect((await itemCounts()).valueConflict).toBe(1);
    await run(vocabulary, await workbookFile({ rows: changed }), "apply");
    expect((await itemCounts()).valueConflict).toBe(1);
  });

  it("does not let an identifier change its meaning by itself: a new name with a new abbreviation waits for a person", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const reused = rowsWith("trm_003", {
      name: "Participant - A wholly different invented scale",
      abbreviation: "WDIS",
    });
    const file = await workbookFile({ rows: reused });
    const report = await run(vocabulary, file, "apply");
    expect(report.tabs[0]).toMatchObject({ imported: 7, queued: 1 });
    expect(await term("trm_003")).toMatchObject({
      name: "Participant - Fictional Handedness Checklist",
      abbreviation: "FHC",
    });
    const counts = await itemCounts();
    expect(counts.valueConflict).toBe(1);
    // The term still stands behind a row of the sheet, so nothing counts as gone.
    expect(counts.missingFromSource).toBeUndefined();
    const again = await run(vocabulary, file, "apply");
    expect(again.documentsWritten).toBe(0);
    expect((await verify(vocabulary, file)).filter((check) => !check.passed)).toEqual([]);

    // Once a person has given the term the values of the sheet, the import follows the sheet again.
    await adminDb.doc("vocabularyTerms/trm_003").update({
      name: "Participant - A wholly different invented scale",
      abbreviation: "WDIS",
    });
    const settled = await run(vocabulary, file, "apply");
    expect(settled.tabs[0]).toMatchObject({ imported: 8, queued: 0 });
    expect((await term("trm_003"))?.importedValues).toMatchObject({ abbreviation: "WDIS" });
    expect((await itemCounts()).valueConflict).toBeUndefined();
    expect((await itemCounts("cleared")).valueConflict).toBe(1);
  });

  it("holds a term whose category changes, and follows a name that changes alone", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const moved = rowsWith("trm_005", { name: "Participant - Has invented signal" });
    await run(vocabulary, await workbookFile({ rows: moved }), "apply");
    expect((await term("trm_005"))?.name).toBe("Meta - Has invented signal");
    expect((await itemCounts()).valueConflict).toBe(1);
    await freshDatabase();
    await run(vocabulary, await workbookFile(), "apply");
    const renamed = rowsWith("trm_005", { name: "Meta - Has an invented signal" });
    await run(vocabulary, await workbookFile({ rows: renamed }), "apply");
    expect(await term("trm_005")).toMatchObject({
      name: "Meta - Has an invented signal",
      // Every spelling that the sheet has given the term is kept.
      labelsSource: ["Meta - Has invented signal", "Meta - Has an invented signal"],
    });
    expect((await itemCounts()).valueConflict).toBeUndefined();
  });

  it("keeps a term that has vanished from the sheet, without treating it as deprecated", async () => {
    await run(vocabulary, await workbookFile(), "apply");
    const without = VOCABULARY_ROWS.filter((row) => row.id !== "trm_008");
    const report = await run(vocabulary, await workbookFile({ rows: without }), "apply");
    expect(report.sourceRecords).toMatchObject({ missing: 1 });
    expect(await term("trm_008")).toMatchObject({ isDeprecated: false, name: "Meta - Time of an invented day" });
    const [missing] = (await reconciliationItems()).filter((item) => item.kind === "missingFromSource");
    expect(missing).toMatchObject({ status: "open", sourceKey: "c" });
    expect(candidatesOf(missing).map((candidate) => candidate.valueSource)).toContain("vocabularyTerms/trm_008");
  });

  it("prints and stores counts and identifiers only: no cell content reaches the batch or its log", async () => {
    const blocked = await run(
      vocabulary,
      await workbookFile({ rows: rowsWith("trm_003", { id: "trm 003" }) }),
      "apply",
    );
    const applied = await run(vocabulary, await workbookFile(), "apply");
    const contents = VOCABULARY_ROWS.flatMap((row) => [row.name, row.abbreviation, row.description, row.sameAs]).filter(
      (value): value is string => value !== undefined,
    );
    for (const batchId of [blocked.batchId, applied.batchId]) {
      const batch = (await adminDb.doc(`importBatches/${batchId}`).get()).data();
      const log = await adminDb.collection(`importBatches/${batchId}/log`).get();
      const text = JSON.stringify([batch?.stats, batch?.inputFiles, log.docs.map((doc) => doc.data().message)]);
      for (const content of contents) expect(text).not.toContain(content);
      expect(text).not.toContain("trm 003");
    }
    expect(JSON.stringify(applied)).not.toMatch(/Invented|invented|IMI|DEMO/);
  });
});
