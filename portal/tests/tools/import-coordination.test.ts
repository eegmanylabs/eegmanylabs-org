// Integration tests of the importer of the historical replication coordination workbook
// (source A) against the Firestore emulator. The workbook is a synthetic fixture that encodes
// only what the project brief states about the real one, which could not be opened: every
// study, person, number and address (on example.org) in it is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { COLLECTION_ENTRIES, historicalAggregateId, sourceTabKey } from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type CoordinationWorkbookOptions,
  coordinationWorkbook,
  SUMMARY_ROWS,
  type SummaryRow,
} from "../../tools/src/import/fixtures/coordination-workbook";
import { websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { itemBuilders } from "../../tools/src/import/reconcile";
import { importer as coordination } from "../../tools/src/import/sources/coordination-workbook";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { importCli } from "./cli-support";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  OBSERVED_ON,
  reconciliationItems,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

const SUMMARY = sourceTabKey("Invented summary");
const OUTREACH = sourceTabKey("Invented outreach");

async function workbookFile(options: CoordinationWorkbookOptions = {}): Promise<string> {
  const file = path.join(temporaryDirectory(), "coordination.xlsx");
  writeFileSync(file, await coordinationWorkbook(options));
  return file;
}

async function applyWebsite(): Promise<void> {
  await run(website, writeWebsiteFixture(temporaryDirectory(), websiteFixture()), "apply");
}

const openItems = async (kind?: string) =>
  (await reconciliationItems()).filter(
    (item) => item.sourceKey === "a" && item.status === "open" && (kind === undefined || item.kind === kind),
  );
const withRow = (study: string, numbers: SummaryRow["numbers"]): SummaryRow[] =>
  SUMMARY_ROWS.map((row) => (row.study === study ? { ...row, numbers } : row));

/** The record of a study row of the summary, by the key of the row. */
async function recordOf(rowKey: string): Promise<string> {
  const records = await adminDb.collection("sourceRecords").where("sourceKey", "==", "a").get();
  const found = records.docs.filter((doc) => doc.get("rowKey") === rowKey && doc.get("supersededById") === null);
  return found[0]?.id ?? "";
}

/** Writes a figure as the importer of source F leaves one: a current aggregate bound to a source record of that source. */
async function figureOfSourceF(studyId: string, metricKey: string, value: number): Promise<string> {
  const recordId = `invented-record-of-f-${studyId.toLowerCase()}`;
  await adminDb
    .doc(`sourceRecords/${recordId}`)
    .set({ sourceKey: "f", tabKey: "t", rowKey: studyId.toLowerCase(), supersededById: null });
  await adminDb.doc(`historicalAggregates/${historicalAggregateId(metricKey, recordId)}`).set({
    replicationIds: [studyId],
    metricKey,
    valueSource: String(value),
    valueNumeric: value,
    sourceRecordId: recordId,
    isCurrent: true,
    dataOrigin: "importedHistorical",
  });
  return recordId;
}

const MEMBER_READABLE = COLLECTION_ENTRIES.filter(
  (entry) => entry.dataClass === "public" || entry.dataClass === "member",
);
const memberReadable = (documentPath: string): boolean => {
  const segments = documentPath.split("/");
  return MEMBER_READABLE.some((entry) => {
    const parts = entry.path.split("/");
    return (
      parts.length === segments.length && parts.every((part, index) => part.startsWith("{") || part === segments[index])
    );
  });
};

const items = itemBuilders(TEST_HASH_KEY);

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

describe("the coordination workbook importer", () => {
  it("accounts for every row of every tab, and registers that its source was never seen", async () => {
    await applyWebsite();
    const report = await run(coordination, await workbookFile(), "apply");
    expect(report).toMatchObject({ sourceKey: "a", status: "applied", blocking: [] });
    const byTab = Object.fromEntries(report.tabs.map((tab) => [tab.tabKey, tab]));
    expect(byTab[SUMMARY]).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 6, derived: 1, blank: 2 }),
      // Four studies with figures. The row of two studies and the row of no study wait in the queue.
      imported: 4,
      queued: 2,
      rawOnly: {},
      unaccounted: 0,
    });
    expect(byTab[OUTREACH]).toMatchObject({
      rows: expect.objectContaining({ banner: 1, header: 1, data: 2 }),
      imported: 2,
      unaccounted: 0,
    });
    expect((await adminDb.doc("sources/a").get()).data()).toMatchObject({
      title: "Historical replication coordination workbook",
      authority: "historical",
      notes: expect.stringMatching(/synthetic fixtures only/),
    });
    expect((await adminDb.doc(`sources/a/tabs/${OUTREACH}`).get()).data()).toMatchObject({
      visibility: "hidden",
      importerKey: "coordinationWorkbook",
    });
    expect(await schemaProblems()).toEqual([]);
  });

  it("stores each figure as a historical aggregate bound to its own source record, a blank as absent and a zero as zero", async () => {
    await applyWebsite();
    await run(coordination, await workbookFile(), "apply");
    const aggregates = await documentsOf("historicalAggregates");
    // 5 + 3 + 5 + 2 figures of the four studies. The five of the combined row are written beneath neither study.
    expect(aggregates.size).toBe(15);
    const gamma = await recordOf("alphagamma2002");
    expect(aggregates.get(historicalAggregateId("totalNMainCollected", gamma))).toMatchObject({
      replicationIds: ["AlphaGamma2002"],
      metricKey: "totalNMainCollected",
      valueNumeric: 0,
      valueSource: "0",
      sourceRecordId: gamma,
      isCurrent: true,
      dataOrigin: "importedHistorical",
    });
    // A blank cell is unknown: no figure is written for it, and nothing is ever read as zero.
    expect(aggregates.has(historicalAggregateId("nLabsFinished", gamma))).toBe(false);
    expect(aggregates.has(historicalAggregateId("totalNRest", gamma))).toBe(false);
    for (const aggregate of aggregates.values()) {
      expect(aggregate).not.toHaveProperty("snapshotDate");
      expect(aggregate.replicationIds).toHaveLength(1);
    }
    // No recruitment report and no participation follows from a historical figure.
    expect((await documentsOf("recruitmentReports")).size).toBe(0);
    expect((await documentsOf("participations")).size).toBe(0);
    // The total below the study rows is computed, and is imported as no figure.
    const total = [...aggregates.values()].filter((aggregate) => aggregate.valueNumeric === 36);
    expect(total).toEqual([]);
  });

  it("queues what a person has to decide: two studies in one cell, an unknown study, a struck study, impossible counts", async () => {
    await applyWebsite();
    const statusBefore = (await adminDb.doc("replications/EpsilonVanZeta2010").get()).data();
    await run(coordination, await workbookFile(), "apply");
    const unmatched = await openItems("unmatchedIdentifier");
    const combined = unmatched.find((item) => item.entityRefs.length === 2);
    // The numbers of the combined row are never apportioned between its two studies.
    expect(combined?.entityRefs.map((ref: { entityId: string }) => ref.entityId)).toEqual(["EtaTheta2005", "Iota2004"]);
    expect(combined?.candidates.map((candidate: { valueSource?: string }) => candidate.valueSource)).toEqual(
      expect.arrayContaining(["Iota2004 + EtaTheta2005", "7", "210", "2", "40", "20"]),
    );
    expect(unmatched.some((item) => item.candidates[0]?.valueSource === "NoSuchStudy1999")).toBe(true);
    // The title of the outreach tab is a label. No reviewer has said which study it belongs to.
    expect(unmatched.some((item) => item.candidates[0]?.valueSource === "Invented outreach")).toBe(true);
    expect((await documentsOf("replications")).has("NoSuchStudy1999")).toBe(false);
    // Strike-through changes no status: it is a question.
    expect((await openItems("statusQuestion")).map((item) => item.entityRefs[0]?.entityId)).toEqual([
      "EpsilonVanZeta2010",
    ]);
    expect((await adminDb.doc("replications/EpsilonVanZeta2010").get()).data()).toEqual(statusBefore);
    // More laboratories finished than signed is kept as written, and queued.
    const finished = (await openItems("valueConflict")).filter((item) => item.field === "nLabsFinished");
    expect(finished.map((item) => item.entityRefs[0]?.entityId)).toEqual(["Delta1999"]);
  });

  it("names every column of the summary that the brief does not state, and keeps its cells in the source records", async () => {
    await applyWebsite();
    const report = await run(
      coordination,
      await workbookFile({ extraColumn: { header: "Comments", value: "an invented comment" } }),
      "apply",
    );
    expect(report.status).toBe("applied");
    const [column] = await openItems("structureChange");
    expect(column?.candidates).toEqual([expect.objectContaining({ valueSource: "Comments" })]);
    expect(column?.id).toBe(
      items.structureChange({
        subject: `a/${SUMMARY}/header/comments`,
        claims: [{ source: `a/${SUMMARY}/header`, value: "Comments" }],
      }).fingerprint,
    );
    const documents = await allDocuments();
    const holding = [...documents].filter(([, stored]) => JSON.stringify(stored.data).includes("an invented comment"));
    expect(holding.length).toBe(6);
    for (const [documentPath] of holding) expect(documentPath).toMatch(/^sourceRecords\//);
  });

  it("keeps its figures apart from those of the recruitment workbook, and queues each difference with both values", async () => {
    await applyWebsite();
    const sameRecord = await figureOfSourceF("AlphaBeta2001", "nLabsSigned", 12);
    const otherRecord = await figureOfSourceF("Delta1999", "totalNToBeRun", 175);
    const before = await documentsOf("historicalAggregates");
    const report = await run(coordination, await workbookFile(), "apply");
    const aggregates = await documentsOf("historicalAggregates");
    // The figures of the other workbook are untouched, and stay current beside those of this one.
    for (const [id, aggregate] of before) expect(aggregates.get(id)).toEqual(aggregate);
    expect(aggregates.size).toBe(before.size + 15);
    const delta = await recordOf("delta1999");
    expect(aggregates.get(historicalAggregateId("totalNToBeRun", delta))).toMatchObject({
      valueNumeric: 150,
      isCurrent: true,
    });

    const compared = (await openItems("valueConflict")).filter((item) => item.field === "totalNToBeRun");
    expect(compared).toHaveLength(1);
    expect(compared[0]).toMatchObject({ entityRefs: [{ entityType: "replication", entityId: "Delta1999" }] });
    // Both values are kept with the record of each. Neither is chosen.
    expect(compared[0]?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ valueSource: "150", sourceRecordId: delta }),
        expect.objectContaining({ valueSource: "175", sourceRecordId: otherRecord }),
      ]),
    );
    expect(compared[0]?.id).toBe(
      items.valueConflict({
        subject: "Delta1999",
        field: "totalNToBeRun",
        claims: [
          { source: "a", value: "150" },
          { source: "f", value: "175" },
        ],
      }).fingerprint,
    );
    // An equal figure is no difference, and a figure that only one workbook states is none either.
    expect((await openItems("valueConflict")).some((item) => item.field === "nLabsSigned")).toBe(false);
    expect(sameRecord).not.toBe("");
    expect(report.items.raise.valueConflict).toBe(2);
  });

  it("writes nothing on a second run, and passes every check of the verification", async () => {
    await applyWebsite();
    await figureOfSourceF("Delta1999", "totalNToBeRun", 175);
    const file = await workbookFile();
    await run(coordination, file, "apply");
    const before = await allDocuments();
    const again = await run(coordination, file, "apply");
    expect(again).toMatchObject({ status: "applied", documentsWritten: 0, changesCommitted: 0 });
    const changed = differences(before, await allDocuments());
    expect(changed.created).toEqual([`importBatches/${again.batchId}`]);
    expect(changed.rewritten).toEqual([]);
    expect((await run(coordination, await workbookFile(), "apply")).documentsWritten).toBe(0);
    expect((await verify(coordination, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("adds a new figure when a number changes, keeps the earlier one, and leaves an edit of the portal alone", async () => {
    await applyWebsite();
    await run(coordination, await workbookFile(), "apply");
    const first = await recordOf("alphabeta2001");
    const firstId = historicalAggregateId("nLabsSigned", first);
    const report = await run(
      coordination,
      await workbookFile({ rows: withRow("AlphaBeta2001", [13, 300, 4, 120, 80]) }),
      "apply",
    );
    // The row of the study and the total below the study rows, whose cached result has changed with it.
    expect(report.sourceRecords).toMatchObject({ created: 2, superseded: 2 });
    const second = await recordOf("alphabeta2001");
    expect(second).not.toBe(first);
    const aggregates = await documentsOf("historicalAggregates");
    // The changed row is a new source record, so it adds new figures. The earlier ones stay, and are no longer current.
    expect(aggregates.get(firstId)).toMatchObject({ valueNumeric: 12, isCurrent: false });
    expect(aggregates.get(historicalAggregateId("nLabsSigned", second))).toMatchObject({
      valueNumeric: 13,
      isCurrent: true,
    });
    expect(aggregates.size).toBe(20);

    // A maintainer marks an earlier figure as current again. The import states its own value and does not overwrite.
    await adminDb.doc(`historicalAggregates/${firstId}`).update({ isCurrent: true, updatedBy: "uid-of-a-maintainer" });
    await run(coordination, await workbookFile({ rows: withRow("AlphaBeta2001", [13, 300, 4, 120, 80]) }), "apply");
    expect((await adminDb.doc(`historicalAggregates/${firstId}`).get()).get("isCurrent")).toBe(true);
    expect((await openItems("valueConflict")).some((item) => item.field === "isCurrent")).toBe(true);
  });

  it("writes names and addresses to restricted documents only", async () => {
    await applyWebsite();
    const report = await run(coordination, await workbookFile(), "apply");
    const contacts = await documentsOf("outreachContacts");
    expect(contacts.size).toBe(2);
    const documents = await allDocuments();
    const holding = [...documents].filter(([, stored]) =>
      ["hal.nobody@example.org", "ida.specimen@example.org", "an invented note"].some((value) =>
        JSON.stringify(stored.data).includes(value),
      ),
    );
    expect(holding.length).toBeGreaterThan(0);
    for (const [documentPath] of holding) {
      expect(memberReadable(documentPath), documentPath).toBe(false);
      expect(documentPath).toMatch(
        /^(outreachContacts\/[^/]+|sourceRecords\/[^/]+|importBatches\/[^/]+\/changes\/\d+)$/,
      );
    }
    for (const value of ["example.org", "Nobody", "Specimen", "Ada", "invented note"]) {
      expect(JSON.stringify(report), value).not.toContain(value);
    }
  });
});

describe("the structure check of the coordination workbook", () => {
  it("stops with a precise report when the summary is not as the brief states, and imports nothing", async () => {
    await applyWebsite();
    const report = await run(
      coordination,
      await workbookFile({
        headers: ["StudyID", "Leader", "NLabsSigned", "Total N Subjects To Be Run", "NLabsFinished"],
      }),
      "apply",
    );
    expect(report.status).toBe("failed");
    expect(report.blocking.map((check) => check.check)).toEqual(["summary", "summaryLayout"]);
    expect((await documentsOf("historicalAggregates")).size).toBe(0);
    expect((await documentsOf("outreachContacts")).size).toBe(0);
    // The items that explain the stop are written at once, with what was found.
    const blocking = await openItems("structureChange");
    expect(blocking).toHaveLength(2);
    expect(JSON.stringify(blocking)).toContain("D: Total N Subjects To Be Run (read as TotalNSubjectsToBeRun)");
    expect(JSON.stringify(blocking)).toContain("missing: TotalNRest");
  });

  it("stops on a tab of no known layout", async () => {
    await applyWebsite();
    const report = await run(coordination, await workbookFile({ unknownTab: true }), "preview");
    expect(report.blocking.map((check) => check.check)).toEqual(["unknownTab"]);
    expect((await documentsOf("historicalAggregates")).size).toBe(0);
  });
});

describe("the command line with the coordination workbook", () => {
  it("prints counts and identifiers only, and exits with the status of a blocked source when the structure differs", async () => {
    await applyWebsite();
    const config = path.join(temporaryDirectory(), "sources.json");
    writeFileSync(config, JSON.stringify({ hashKey: TEST_HASH_KEY, sources: {} }));
    const base = ["--observed-on", OBSERVED_ON, "--config", config];
    const applied = importCli(["run", "a", "--input", await workbookFile(), "--mode", "apply", ...base]);
    expect(applied.stderr).toBe("");
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("import apply of source a");
    expect(applied.stdout).toContain("historicalAggregates: 15 created");
    for (const value of ["example.org", "Nobody", "Specimen", "Ada", "Fictional", "invented note"]) {
      expect(applied.output, value).not.toContain(value);
    }
    expect(importCli(["list"]).stdout).toMatch(
      /^ {2}a {2}Historical replication coordination workbook: coordinationWorkbook\..*synthetic fixtures only/m,
    );
    const blocked = importCli([
      "run",
      "a",
      "--input",
      await workbookFile({ headerRow: 3 }),
      "--mode",
      "preview",
      ...base,
    ]);
    expect(blocked.status).toBe(3);
    expect(blocked.stdout).toContain(
      "Blocking check summaryLayout: Row 3 of a tab holds 7 of the seven summary headers",
    );
  });
});
