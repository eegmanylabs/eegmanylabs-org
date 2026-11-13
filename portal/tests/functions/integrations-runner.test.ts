// The job runner of the Google integrations against the fake, run in the test's own process with
// the background triggers switched off, so each run starts exactly when the test says: sheet
// synchronisation in both directions, convergence after the engine's own writes, conflicts,
// rows that move, appear and disappear, formulas and formats left alone, quotas with backoff,
// an outage that ends in the dead-letter state and a retry, lost access, the Drive change feed,
// push notifications and generated documents (acceptance scenarios 9, 10 and part of 15).
// Everything here is synthetic: invented laboratories, files and values on the example.org domain.
import {
  COLLECTIONS,
  generatedDocumentDocSchema,
  generatedDocumentId,
  laboratoryDocSchema,
  laboratoryEquipmentDocSchema,
  type SyncConflictDoc,
  sha256Hex,
  syncConflictDocSchema,
  syncReviewItemDocSchema,
  syncRunDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  FAKE_FILES,
  FAKE_TEMPLATES,
  HUMAN_TEXT,
  initialFakeState,
} from "../../functions/src/integrations/google/fake/fixtures";
import { receiveDriveNotification } from "../../functions/src/integrations/jobs/receiver";
import { renewDriveChannel } from "../../functions/src/integrations/jobs/runner";
import { DEMO_DOCUMENT_TEMPLATES, DEMO_SYNC_SOURCES, DEMO_WORKSPACE } from "../../tools/src/fixtures/demo-world";
import { adminDb } from "../support/admin";
import {
  DIRECTORY_MAPPING,
  EQUIPMENT_MAPPING,
  jobDependencies,
  resetWorkspace,
  runJob,
  seedWorkspaceWorld,
  TestClock,
  workspaceFake,
} from "./integrations-world";
import { auditOf, replication, resetWorld, standard, withoutTriggers } from "./support";

const DIRECTORY = FAKE_FILES.laboratoryDirectory;
const REGISTER = FAKE_FILES.equipmentRegister;
// Columns of the directory: key, name, city, website, contact notes.
const CITY = 2;
const WEBSITE = 3;
const NOTES = 4;
// Columns of the register: key, laboratory, configuration, channels, rates, cap, formula, notes.
const CHANNELS = 3;

withoutTriggers();

beforeEach(async () => {
  await resetWorld();
  resetWorkspace();
  await seedWorkspaceWorld();
});

afterAll(async () => {
  resetWorkspace();
});

async function laboratory(id: string) {
  return laboratoryDocSchema.parse((await adminDb.doc(COLLECTIONS.laboratories.docPath(id)).get()).data());
}

async function run(id: string) {
  return syncRunDocSchema.parse((await adminDb.doc(COLLECTIONS.syncRuns.docPath(id)).get()).data());
}

async function openConflicts(): Promise<SyncConflictDoc[]> {
  const found = await adminDb.collection(COLLECTIONS.syncConflicts.collectionPath()).get();
  return found.docs
    .map((document) => syncConflictDocSchema.parse(document.data()))
    .filter((conflict) => conflict.status === "open");
}

async function reviewKinds(mappingId: string): Promise<string[]> {
  const found = await adminDb
    .collection(COLLECTIONS.syncReviewItems.collectionPath())
    .where("mappingId", "==", mappingId)
    .get();
  return found.docs
    .map((document) => syncReviewItemDocSchema.parse(document.data()))
    .filter((item) => item.status === "open")
    .map((item) => item.kind)
    .sort();
}

function cellOf(fake: ReturnType<typeof workspaceFake>, file: string, key: string, column: number) {
  return fake.rowValues(file, 0, fake.rowIndexOfKey(file, 0, 0, key))[column];
}

describe("the fixtures", () => {
  it("of the demonstration world name the files of the fake", () => {
    const files = initialFakeState().files;
    for (const source of DEMO_SYNC_SOURCES) expect(files[source.fileId]?.sheet, source.key).toBeDefined();
    for (const template of DEMO_DOCUMENT_TEMPLATES)
      expect(files[template.templateFileId]?.doc, template.key).toBeDefined();
    expect(files[DEMO_WORKSPACE.generatedFolder]?.driveId).toBeDefined();
    expect(initialFakeState().account).toBe(DEMO_WORKSPACE.account);
    expect(Object.values(FAKE_TEMPLATES).every((id) => files[id] !== undefined)).toBe(true);
  });
});

describe("a sheet synchronisation", () => {
  it("links on its first run without writing a value, anchors every row and tags every column", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    const { runId, status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("succeeded");
    expect((await run(runId)).stats).toMatchObject({
      anchorsRepaired: 4,
      cellsToSheet: 0,
      fieldsToApp: 0,
      conflicts: 0,
    });
    const grid = await fake.adapters().sheets.readTab(DIRECTORY, 0);
    expect(
      grid.metadata
        .filter((meta) => meta.metadataKey === "eegml.row")
        .map((meta) => meta.metadataValue)
        .sort(),
    ).toEqual(["demo-attention-lab", "demo-cognition-lab", "demo-memory-lab", "demo-signal-lab"]);
    expect(
      grid.metadata
        .filter((meta) => meta.metadataKey === "eegml.column")
        .map((meta) => meta.metadataValue)
        .sort(),
    ).toEqual(["city", "name", "website"]);
    // Three agreeing cells for each laboratory are now the base of the comparison.
    expect(
      (await adminDb.collection(COLLECTIONS.syncMappingCellState.collectionPath(DIRECTORY_MAPPING)).get()).size,
    ).toBe(12);
  });

  it("takes an external edit into the mapped field, with an audit entry of the synchronisation, and ignores its own echo", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");

    const { runId, status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("succeeded");
    const signal = await laboratory("demo-lab-signal");
    expect(signal.city).toBe("Harbour City");
    expect(signal.writeContext).toMatchObject({ origin: "sync", correlationId: DIRECTORY_MAPPING, causationId: runId });
    const [entry] = await auditOf("sync.recordUpdated", "demo-lab-signal");
    expect(entry).toMatchObject({
      actorKind: "sync",
      actorUid: null,
      changes: [{ field: "city", before: "Harbourtown", after: "Harbour City" }],
    });

    // The next run finds the three values equal and writes nothing on either side.
    const before = await fake.adapters().drive.getFile(DIRECTORY);
    const again = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect((await run(again.runId)).stats).toMatchObject({ cellsToSheet: 0, fieldsToApp: 0, anchorsRepaired: 0 });
    expect((await fake.adapters().drive.getFile(DIRECTORY)).version).toBe(before.version);
    expect(await auditOf("sync.recordUpdated", "demo-lab-signal")).toHaveLength(1);
  });

  it("writes an edit made in the portal to its one cell, and leaves the manual column, formats and every other cell alone", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    const header = fake.rowValues(DIRECTORY, 0, 0);
    const untouched = fake.rowValues(DIRECTORY, 0, fake.rowIndexOfKey(DIRECTORY, 0, 0, "demo-attention-lab"));
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-signal"))
      .update({ website: "https://signal.example.org/" });

    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(cellOf(fake, DIRECTORY, "demo-signal-lab", WEBSITE)).toEqual({ v: "https://signal.example.org/" });
    expect(cellOf(fake, DIRECTORY, "demo-signal-lab", NOTES)).toEqual({ v: "Call before visiting." });
    expect(fake.rowValues(DIRECTORY, 0, 0)).toEqual(header);
    expect(fake.rowValues(DIRECTORY, 0, fake.rowIndexOfKey(DIRECTORY, 0, 0, "demo-attention-lab"))).toEqual(untouched);
    const [entry] = await auditOf("sync.sheetUpdated", DIRECTORY_MAPPING);
    expect(entry?.changes).toEqual([
      { field: "demo-signal-lab website", before: null, after: "https://signal.example.org/" },
    ]);
  });

  it("flags simultaneous conflicting edits, writes neither side, and keeps both values against the base", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-memory"))
      .update({ website: "https://portal-side.example.org/" });
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-memory-lab", WEBSITE, "https://sheet-side.example.org/");
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-memory-lab", CITY, "Southfield");

    const { status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("partial");
    const [conflict, ...others] = await openConflicts();
    expect(others).toEqual([]);
    expect(conflict).toMatchObject({
      origin: "sheet",
      mappingId: DIRECTORY_MAPPING,
      rowKey: "demo-memory-lab",
      field: "website",
      baseValue: null,
      appValue: "https://portal-side.example.org/",
      sheetValue: "https://sheet-side.example.org/",
      externalModifiedBy: "Synthetic Sheet Editor",
      status: "open",
    });
    // The other field of the row synchronised as usual, and the conflicting one stayed apart.
    const memory = await laboratory("demo-lab-memory");
    expect(memory.city).toBe("Southfield");
    expect(memory.website).toBe("https://portal-side.example.org/");
    expect(cellOf(fake, DIRECTORY, "demo-memory-lab", WEBSITE)).toEqual({ v: "https://sheet-side.example.org/" });

    // A second run sees the same conflict and records no second one.
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(await openConflicts()).toHaveLength(1);
  });

  it("follows a sort that leaves the metadata behind, and a row a person inserts, without moving any value", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    fake.sortRows(DIRECTORY, 0, 0, true);
    fake.insertRow(DIRECTORY, 0, 1, [null, "A row with no key", "Nowhere"]);
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-cognition"))
      .update({ website: "https://cognition.example.org/" });

    const { runId } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect((await run(runId)).stats).toMatchObject({
      // Sorted in reverse, every row but the memory laboratory's has moved from under its anchor.
      anchorsRepaired: 3,
      blankKeys: 1,
      cellsToSheet: 1,
      fieldsToApp: 0,
    });
    expect(cellOf(fake, DIRECTORY, "demo-cognition-lab", WEBSITE)).toEqual({ v: "https://cognition.example.org/" });
    for (const [key, city] of [
      ["demo-attention-lab", "Northfield"],
      ["demo-signal-lab", "Harbourtown"],
      ["demo-cognition-lab", "Ridgeway"],
    ] as const) {
      expect(cellOf(fake, DIRECTORY, key, CITY)).toEqual({ v: city });
      expect((await laboratory(DEMO_KEYS[key] ?? key)).city).toBe(city);
    }
  });

  it("raises a review item for a row that has gone and for a key it does not know, and deletes nothing", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    fake.deleteRow(DIRECTORY, 0, fake.rowIndexOfKey(DIRECTORY, 0, 0, "demo-memory-lab"));
    fake.insertRow(DIRECTORY, 0, 5, ["demo-unknown-lab", "Synthetic Unknown Laboratory", "Elsewhere"]);
    const { status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("partial");
    expect(await reviewKinds(DIRECTORY_MAPPING)).toEqual(["missingRow", "unknownRow"]);
    expect((await laboratory("demo-lab-memory")).archivedAt).toBeNull();
    expect((await adminDb.collection(COLLECTIONS.laboratories.collectionPath()).get()).size).toBe(4);
  });

  it("never writes a formula cell, and keeps every formula and note of the sheet", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    const formulaBefore = cellOf(fake, REGISTER, "demo-cognition-lab:demo-equipment-cognition-1", 6);
    await runJob(dependencies, { kind: "sheetSync", mappingId: EQUIPMENT_MAPPING });
    fake.editCellByKey(REGISTER, 0, 0, "demo-cognition-lab:demo-equipment-cognition-1", CHANNELS, 96);
    await runJob(dependencies, { kind: "sheetSync", mappingId: EQUIPMENT_MAPPING });
    expect(cellOf(fake, REGISTER, "demo-cognition-lab:demo-equipment-cognition-1", 6)).toEqual(formulaBefore);
    expect(cellOf(fake, REGISTER, "demo-cognition-lab:demo-equipment-cognition-1", 7)).toEqual({
      v: "Cap sizes checked in spring.",
      note: "Written by the laboratory (synthetic).",
    });
    // The person's edit replaced the configuration through a successor, as the portal itself would.
    const current = await adminDb
      .collection(COLLECTIONS.laboratoryEquipment.collectionPath("demo-lab-cognition"))
      .where("isCurrent", "==", true)
      .get();
    expect(current.docs.map((document) => laboratoryEquipmentDocSchema.parse(document.data()))).toEqual([
      expect.objectContaining({
        channelCount: 96,
        supersedesId: "demo-equipment-cognition-2",
        writeContext: expect.objectContaining({ origin: "sync" }),
      }),
    ]);
    expect(cellOf(fake, REGISTER, "demo-cognition-lab:demo-equipment-cognition-1", CHANNELS)).toEqual({
      v: 96,
      fmt: { numberFormat: "0" },
    });
  });

  it("appends the row of an equipment chain made in the portal, keyed by the chain, with an audit entry (acceptance scenario 3)", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: EQUIPMENT_MAPPING });
    const at = Timestamp.now();
    await adminDb.doc(COLLECTIONS.laboratoryEquipment.docPath("demo-lab-memory", "synthetic-room-one")).set({
      ...standard(at),
      laboratoryId: "demo-lab-memory",
      name: "Room 1",
      isCurrent: true,
      validFrom: at,
      validTo: null,
      supersedesId: null,
      channelCount: 64,
      samplingRatesHz: [500, 1000],
    });
    await runJob(dependencies, { kind: "sheetSync", mappingId: EQUIPMENT_MAPPING });
    const key = "demo-memory-lab:synthetic-room-one";
    const row = fake.rowValues(REGISTER, 0, fake.rowIndexOfKey(REGISTER, 0, 0, key));
    expect(row.slice(0, 6).map((cell) => cell?.v ?? null)).toEqual([
      key,
      "Demo Memory Laboratory",
      "Room 1",
      64,
      "500, 1000",
      null,
    ]);
    const [entry] = await auditOf("sync.sheetUpdated", EQUIPMENT_MAPPING);
    expect(entry?.changes).toContainEqual({ field: key, before: null, after: "A row was appended." });
    // The appended row is anchored, so the next run is idle.
    const again = await runJob(dependencies, { kind: "sheetSync", mappingId: EQUIPMENT_MAPPING });
    expect((await run(again.runId)).stats).toMatchObject({ anchorsRepaired: 0, cellsToSheet: 0, rowsAppended: 0 });
  });

  it("writes nothing in a dry run, on either side, and stores the plan", async () => {
    await seedWorkspaceWorld({ directoryMode: "dryRun" });
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", WEBSITE, "https://signal.example.org/");
    const version = (await fake.adapters().drive.getFile(DIRECTORY)).version;
    const { runId, status } = await runJob(dependencies, {
      kind: "sheetSync",
      mappingId: DIRECTORY_MAPPING,
      mode: "dryRun",
    });
    expect(status).toBe("succeeded");
    expect((await run(runId)).plan).toContainEqual(
      expect.objectContaining({
        action: "writeApp",
        rowKey: "demo-signal-lab",
        field: "website",
        before: null,
        after: "https://signal.example.org/",
      }),
    );
    expect((await laboratory("demo-lab-signal")).website).toBeUndefined();
    expect(
      (await adminDb.collection(COLLECTIONS.syncMappingCellState.collectionPath(DIRECTORY_MAPPING)).get()).size,
    ).toBe(0);
    expect((await fake.adapters().drive.getFile(DIRECTORY)).version).toBe(version);
  });

  it("stops a mass change at the ceiling: nothing is written and the mapping is paused for review", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).update({ cellCeiling: 2 });
    for (const key of ["demo-attention-lab", "demo-memory-lab", "demo-signal-lab"]) {
      fake.editCellByKey(DIRECTORY, 0, 0, key, CITY, "Pasted city");
    }
    const { runId, status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("failed");
    expect((await run(runId)).errorKind).toBe("guard");
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("status")).toBe("paused");
    expect(await reviewKinds(DIRECTORY_MAPPING)).toEqual(["ceilingExceeded"]);
    expect((await laboratory("demo-lab-signal")).city).toBe("Harbourtown");
  });
});

/** The laboratory of each key of the directory. */
const DEMO_KEYS: Readonly<Record<string, string>> = {
  "demo-attention-lab": "demo-lab-attention",
  "demo-memory-lab": "demo-lab-memory",
  "demo-signal-lab": "demo-lab-signal",
  "demo-cognition-lab": "demo-lab-cognition",
};

describe("failures (acceptance scenario 15)", () => {
  it("rides out quota errors with backoff and finishes the run", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    fake.arrangeFault({ service: "sheets", method: "readTab", status: 429, reason: "RATE_LIMIT_EXCEEDED", times: 2 });
    fake.arrangeFault({ service: "drive", method: "getFile", status: 403, reason: "userRateLimitExceeded", times: 1 });
    const { status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("succeeded");
    // Two to the power of the attempt in seconds, with the injected jitter of zero.
    expect(dependencies.waits).toEqual([1_000, 1_000, 2_000]);
  });

  it("leaves the records as they were through an outage, retries the run later, dead-letters it, and recovers on a retry", async () => {
    const fake = workspaceFake();
    const clock = new TestClock();
    const dependencies = jobDependencies(fake.adapters(), clock);
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    fake.setOutage("sheets", true);

    const { runId, status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("retrying");
    expect(dependencies.waits).toHaveLength(4);
    const failed = await run(runId);
    expect(failed).toMatchObject({ status: "retrying", errorKind: "outage", attempts: 1 });
    expect(failed.nextAttemptAt?.toMillis()).toBeGreaterThan(clock.now().getTime());
    expect((await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleSheets")).get()).get("status")).toBe(
      "degraded",
    );
    expect((await laboratory("demo-lab-signal")).city).toBe("Harbourtown");
    expect((await adminDb.doc(COLLECTIONS.syncLeases.docPath("demo-laboratory-directory")).get()).exists).toBe(false);

    // Every later attempt fails the same way, until the run is dead-lettered and needs a person.
    for (let attempt = 2; attempt <= failed.maxAttempts; attempt += 1) {
      await adminDb.doc(COLLECTIONS.syncRuns.docPath(runId)).update({ status: "queued" });
      const { executeRun } = await import("../../functions/src/integrations/jobs/runner");
      await executeRun(runId, dependencies);
    }
    expect(await run(runId)).toMatchObject({ status: "deadLetter", errorKind: "outage" });
    expect((await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleSheets")).get()).get("status")).toBe(
      "needsAttention",
    );

    fake.setOutage("sheets", false);
    await adminDb
      .doc(COLLECTIONS.syncRuns.docPath(runId))
      .update({ status: "queued", maxAttempts: failed.maxAttempts + 1 });
    const { executeRun } = await import("../../functions/src/integrations/jobs/runner");
    expect(await executeRun(runId, dependencies)).toBe("succeeded");
    expect((await laboratory("demo-lab-signal")).city).toBe("Harbour City");
    expect((await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleSheets")).get()).get("status")).toBe(
      "live",
    );
  });

  it("stops at once when access is lost, pauses the mapping for a person, and touches no record", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    fake.revokeAccess(DIRECTORY);
    const { runId, status } = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING });
    expect(status).toBe("failed");
    expect((await run(runId)).errorKind).toBe("accessLost");
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("status")).toBe(
      "needsAttention",
    );
    expect(await reviewKinds(DIRECTORY_MAPPING)).toEqual(["accessLost"]);
    expect((await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleSheets")).get()).get("status")).toBe(
      "needsAttention",
    );
    expect((await laboratory("demo-lab-signal")).city).toBe("Harbourtown");
    // A scheduled run passes over the mapping until a person has dealt with it.
    const later = await runJob(dependencies, { kind: "sheetSync", mappingId: DIRECTORY_MAPPING, trigger: "schedule" });
    expect(later.status).toBe("skipped");
  });

  it("refuses a workbook kept in Drive, which is imported and never synchronised", async () => {
    await adminDb
      .doc(COLLECTIONS.sourceLocation.docPath("demo-laboratory-directory"))
      .update({ externalId: FAKE_FILES.workbook });
    const fake = workspaceFake();
    const { runId, status } = await runJob(jobDependencies(fake.adapters()), {
      kind: "sheetSync",
      mappingId: DIRECTORY_MAPPING,
    });
    expect(status).toBe("failed");
    expect((await run(runId)).error).toContain("not a native Google Sheet");
  });
});

describe("the Drive change feed and push notifications", () => {
  it("starts the runs of changed spreadsheets, checks changed links and pauses the mapping of a removed one", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await runJob(dependencies, { kind: "driveChanges" });
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    fake.revokeAccess(REGISTER);
    const { runId } = await runJob(dependencies, { kind: "driveChanges" });
    expect((await run(runId)).stats).toMatchObject({ changes: 2, runsQueued: 1 });
    const queued = await adminDb
      .collection(COLLECTIONS.syncRuns.collectionPath())
      .where("status", "==", "queued")
      .get();
    expect(queued.docs.map((document) => document.get("mappingId"))).toEqual([DIRECTORY_MAPPING]);
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(EQUIPMENT_MAPPING)).get()).get("status")).toBe(
      "needsAttention",
    );
  });

  it("answers unknown channels and wrong tokens with 404, and enqueues one read for each new message only", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    const channelId = await renewDriveChannel(dependencies, "https://receiver.example.org/hook");
    const [opening] = fake.takeNotifications();
    expect(opening?.resourceState).toBe("sync");
    const at = new Date();
    const headers = (token: string, messageNumber: number, resourceState = "change") => ({
      channelId,
      token,
      messageNumber: String(messageNumber),
      resourceState,
    });
    expect(await receiveDriveNotification(adminDb, headers(opening?.token ?? "", 1, "sync"), at)).toEqual({
      status: 200,
      queued: false,
    });
    expect(await receiveDriveNotification(adminDb, headers("a wrong token", 2), at)).toEqual({ status: 404 });
    expect(
      await receiveDriveNotification(adminDb, { ...headers(opening?.token ?? "", 2), channelId: "unknown" }, at),
    ).toEqual({ status: 404 });
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    const [change] = fake.takeNotifications();
    expect(
      await receiveDriveNotification(adminDb, headers(change?.token ?? "", change?.messageNumber ?? 0), at),
    ).toEqual({ status: 200, queued: true });
    // The same message again, or an older one, is ignored.
    expect(
      await receiveDriveNotification(adminDb, headers(change?.token ?? "", change?.messageNumber ?? 0), at),
    ).toEqual({ status: 200, queued: false });
    const channel = await adminDb.doc(COLLECTIONS.driveChannels.docPath(channelId)).get();
    expect(channel.get("tokenHash")).toBe(sha256Hex(opening?.token ?? ""));
    expect(JSON.stringify(channel.data())).not.toContain(opening?.token ?? "no token");
  });
});

describe("a generated document (acceptance scenario 9)", () => {
  const DOCUMENT = generatedDocumentId("laboratory-progress", "laboratory", "demo-lab-memory");

  async function requestDocument(): Promise<void> {
    const now = Timestamp.now();
    await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(DOCUMENT)).set({
      ...standard(now),
      templateKey: "laboratory-progress",
      entityType: "laboratory",
      entityId: "demo-lab-memory",
      title: "Laboratory progress: Demo Memory Laboratory",
      managedSections: {},
      lastGeneratedAt: null,
      status: "pending",
      restricted: false,
      replicationId: null,
      laboratoryId: "demo-lab-memory",
      scopeKeys: ["lab:demo-lab-memory", "members"],
    });
  }

  async function record() {
    return generatedDocumentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(DOCUMENT)).get()).data(),
    );
  }

  it("is copied into the shared drive, adopts its sections with provenance, and keeps the human text", async () => {
    const fake = workspaceFake();
    await requestDocument();
    const { status } = await runJob(jobDependencies(fake.adapters()), {
      kind: "documentUpdate",
      generatedDocumentId: DOCUMENT,
    });
    expect(status).toBe("succeeded");
    const stored = await record();
    expect(stored.status).toBe("current");
    expect(Object.keys(stored.managedSections).sort()).toEqual(["equipment", "participations", "profile"]);
    const text = fake.documentText(stored.externalDocumentId ?? "");
    expect(text).toContain(HUMAN_TEXT);
    expect(text).not.toContain("{{portal:");
    expect(text).toContain("No description is recorded.");
    expect(
      text.match(
        /Source: .* in the EEGManyLabs portal, as of \d{4}-\d{2}-\d{2}\. https:\/\/portal\.example\.org\/#\/labs\/demo-lab-memory/g,
      ),
    ).toHaveLength(3);
    expect(
      (
        await workspaceFake()
          .adapters()
          .drive.getFile(stored.externalDocumentId ?? "")
      ).driveId,
    ).toBe("fake-shared-drive");
  });

  it("updates its managed sections from the records while human text around them stays untouched", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await requestDocument();
    await runJob(dependencies, { kind: "documentUpdate", generatedDocumentId: DOCUMENT });
    const externalId = (await record()).externalDocumentId ?? "";
    fake.replaceInDocument(externalId, HUMAN_TEXT, `${HUMAN_TEXT} The team added this sentence.`);
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-memory"))
      .update({ description: "A synthetic laboratory of memory." });

    const { status } = await runJob(dependencies, { kind: "documentUpdate", generatedDocumentId: DOCUMENT });
    expect(status).toBe("succeeded");
    const text = fake.documentText(externalId);
    expect(text).toContain("A synthetic laboratory of memory.");
    expect(text).not.toContain("No description is recorded.");
    expect(text).toContain(`${HUMAN_TEXT} The team added this sentence.`);
  });

  it("never writes over a hand edit of a section, and offers the edit of the designated field for review", async () => {
    const fake = workspaceFake();
    const dependencies = jobDependencies(fake.adapters());
    await requestDocument();
    await runJob(dependencies, { kind: "documentUpdate", generatedDocumentId: DOCUMENT });
    const externalId = (await record()).externalDocumentId ?? "";
    fake.replaceInDocument(externalId, "No description is recorded.", "A description written in the document.");
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-memory"))
      .update({ description: "Changed in the portal meanwhile." });

    const { status } = await runJob(dependencies, { kind: "documentUpdate", generatedDocumentId: DOCUMENT });
    expect(status).toBe("partial");
    expect(fake.documentText(externalId)).toContain("A description written in the document.");
    expect(fake.documentText(externalId)).not.toContain("Changed in the portal meanwhile.");
    expect((await record()).managedSections.profile?.status).toBe("edited");
    expect(await openConflicts()).toEqual([
      expect.objectContaining({
        origin: "document",
        generatedDocumentId: DOCUMENT,
        section: "profile",
        field: "description",
        appValue: "Changed in the portal meanwhile.",
        sheetValue: "A description written in the document.",
      }),
    ]);
  });

  it("is never created outside a shared drive", async () => {
    await adminDb
      .doc(COLLECTIONS.documentTemplates.docPath("laboratory-progress"))
      .update({ targetFolderId: FAKE_FILES.alphaFolder });
    await requestDocument();
    const { runId, status } = await runJob(jobDependencies(workspaceFake().adapters()), {
      kind: "documentUpdate",
      generatedDocumentId: DOCUMENT,
    });
    expect(status).toBe("failed");
    expect((await run(runId)).errorKind).toBe("accessLost");
    expect((await record()).status).toBe("failed");
  });

  it("waits for a retry through an outage, and is marked failed only once the attempts are spent", async () => {
    const fake = workspaceFake();
    await requestDocument();
    fake.setOutage("drive", true);
    const dependencies = jobDependencies(fake.adapters());
    const { runId, status } = await runJob(dependencies, { kind: "documentUpdate", generatedDocumentId: DOCUMENT });
    expect(status).toBe("retrying");
    const waiting = await record();
    expect(waiting.status).toBe("stale");
    expect(waiting.statusReason).toContain("will be tried again");
    expect(waiting.statusReason).toContain("synthetic Google fake");
    const { executeRun } = await import("../../functions/src/integrations/jobs/runner");
    const runs = await adminDb.doc(COLLECTIONS.syncRuns.docPath(runId)).get();
    for (let attempt = 2; attempt <= Number(runs.get("maxAttempts")); attempt += 1) {
      await adminDb.doc(COLLECTIONS.syncRuns.docPath(runId)).update({ status: "queued" });
      await executeRun(runId, dependencies);
    }
    expect((await record()).status).toBe("failed");
    fake.setOutage("drive", false);
  });

  it("generates the recruitment of a replication from the resolver, the three modalities apart", async () => {
    await replication("DemoBeta2005");
    const id = generatedDocumentId("replication-recruitment", "replication", "DemoBeta2005");
    const now = Timestamp.now();
    await adminDb.doc(COLLECTIONS.participations.docPath("DemoBeta2005__demo-lab-cognition")).set({
      ...standard(now),
      replicationId: "DemoBeta2005",
      laboratoryId: "demo-lab-cognition",
      scopeKeys: ["rep:DemoBeta2005", "lab:demo-lab-cognition"],
      status: "collecting",
      statusHistoryId: null,
      readinessStatus: "approved",
      custom: {},
      dataOrigin: "demo",
    });
    await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(id)).set({
      ...standard(now),
      templateKey: "replication-recruitment",
      entityType: "replication",
      entityId: "DemoBeta2005",
      title: "Recruitment: DemoBeta2005",
      managedSections: {},
      lastGeneratedAt: null,
      status: "pending",
      restricted: false,
      replicationId: "DemoBeta2005",
      laboratoryId: null,
      scopeKeys: ["rep:DemoBeta2005", "members"],
    });
    const fake = workspaceFake();
    await runJob(jobDependencies(fake.adapters()), { kind: "documentUpdate", generatedDocumentId: id });
    const stored = generatedDocumentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(id)).get()).data(),
    );
    const text = fake.documentText(stored.externalDocumentId ?? "");
    expect(text).toContain(
      "Demo Cognition Laboratory | reported unknown, verified unknown | reported unknown, verified unknown",
    );
    expect(text).toContain("never added together");
  });
});
