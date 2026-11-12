// The Google Workspace fake reproduces the awkward behaviour the design relies on
// (docs/INTEGRATIONS.md, section 3.7). The files are the synthetic fixtures of the emulator.
import { describe, expect, it } from "vitest";
import { ExternalServiceError, MAX_CHANNEL_LIFETIME_MS } from "../types";
import { FAKE_ACCOUNT, FAKE_FILES, FAKE_TEMPLATES, initialFakeState } from "./fixtures";
import { MemoryStore } from "./store";
import { FakeWorkspace } from "./workspace";

function workspace(start = Date.UTC(2026, 10, 11, 9, 0, 0)) {
  let now = start;
  const fake = new FakeWorkspace(new MemoryStore(initialFakeState()), () => now);
  return { fake, adapters: fake.adapters(), advance: (milliseconds: number) => (now += milliseconds) };
}

async function failure(promise: Promise<unknown>): Promise<ExternalServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExternalServiceError) return error;
    throw error;
  }
  throw new Error("Expected the call to fail.");
}

const REGISTER = FAKE_FILES.equipmentRegister;

describe("the Drive of the fake", () => {
  it("raises the version and logs one change for every change to a file", async () => {
    const { fake, adapters } = workspace();
    const before = await adapters.drive.getFile(REGISTER);
    const token = await adapters.drive.getStartPageToken();
    fake.editCell(REGISTER, 0, 1, 7, "Checked again.");
    const after = await adapters.drive.getFile(REGISTER);
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(after.lastModifyingUser).toEqual({ displayName: "Synthetic Sheet Editor", me: false });
    const page = await adapters.drive.listChanges(token);
    expect(page.changes.map((change) => [change.fileId, change.removed])).toEqual([[REGISTER, false]]);
    expect(page.newStartPageToken).toBe(String(Number(token) + 1));
  });

  it("reports a removal, and answers 404, once the portal's account loses access", async () => {
    const { fake, adapters } = workspace();
    const token = await adapters.drive.getStartPageToken();
    fake.revokeAccess(FAKE_FILES.alphaFolder);
    expect((await failure(adapters.drive.getFile(FAKE_FILES.alphaStageOne))).status).toBe(404);
    const page = await adapters.drive.listChanges(token);
    expect(page.changes.every((change) => change.removed)).toBe(true);
    expect(page.changes.map((change) => change.fileId)).toContain(FAKE_FILES.alphaStageOne);
  });

  it("lists the children of a folder, folders first, page by page", async () => {
    const { adapters } = workspace();
    const first = await adapters.drive.listChildren(FAKE_FILES.alphaFolder, undefined, 2);
    expect(first.files.map((file) => file.name)).toEqual([
      "Stage 1 drafts (synthetic)",
      "Ethics approval (synthetic).pdf",
    ]);
    expect(first.nextPageToken).toBeDefined();
    const second = await adapters.drive.listChildren(FAKE_FILES.alphaFolder, first.nextPageToken, 2);
    expect(second.files.map((file) => file.name)).toEqual(["Recruitment tracker (synthetic)"]);
    expect(second.nextPageToken).toBeUndefined();
  });

  it("refuses to create a file outside a shared drive, where the service account would own it", async () => {
    const { adapters } = workspace();
    const refused = await failure(adapters.drive.copyFile(FAKE_TEMPLATES.recruitment, "Copy", FAKE_FILES.alphaFolder));
    expect([refused.status, refused.reason]).toEqual([403, "storageQuotaExceeded"]);
    const copy = await adapters.drive.copyFile(FAKE_TEMPLATES.recruitment, "Copy", FAKE_FILES.generatedFolder);
    expect(copy.driveId).toBeDefined();
    expect(copy.owners).toEqual([]);
  });

  it("caps a channel at a week, sends headers only on each change, and stops sending once it has expired", async () => {
    const { fake, adapters, advance } = workspace();
    const token = await adapters.drive.getStartPageToken();
    const opened = await adapters.drive.watchChanges(token, {
      id: "channel-1",
      token: "secret-token",
      address: "https://receiver.example.org/hook",
      expiration: Date.UTC(2027, 0, 1),
    });
    expect(opened.expiration).toBe(Date.UTC(2026, 10, 11, 9, 0, 0) + MAX_CHANNEL_LIFETIME_MS);
    fake.editCell(REGISTER, 0, 1, 7, "One.");
    expect(fake.takeNotifications().map((message) => [message.resourceState, message.messageNumber])).toEqual([
      ["sync", 1],
      ["change", 2],
    ]);
    advance(MAX_CHANNEL_LIFETIME_MS + 1);
    fake.editCell(REGISTER, 0, 1, 7, "Two.");
    expect(fake.takeNotifications()).toEqual([]);
  });
});

describe("the Sheets of the fake", () => {
  it("writes raw values, skips nulls, keeps formats, notes and formulas elsewhere, and never injects a formula", async () => {
    const { fake, adapters } = workspace();
    await adapters.sheets.writeRows(REGISTER, [
      {
        sheetId: 0,
        row: { kind: "position", index: 1 },
        values: [null, null, "=SUM(1,2)", 32, null, null, null, null],
      },
    ]);
    const row = fake.rowValues(REGISTER, 0, 1);
    expect(row[2]).toEqual({ v: "=SUM(1,2)" });
    expect(row[3]).toEqual({ v: 32, fmt: { numberFormat: "0" } });
    expect(row[6]).toEqual({ v: 21.333333333333332, f: "=D2/3" });
    expect(row[7]).toEqual({ v: "Cap sizes checked in spring.", note: "Written by the laboratory (synthetic)." });
    expect(fake.rowValues(REGISTER, 0, 0)[0]).toEqual({
      v: "Configuration key",
      fmt: { bold: true, backgroundColor: "#f3eeea" },
    });
  });

  it("resolves a write addressed by row metadata to the row's place when the write lands", async () => {
    const { fake, adapters } = workspace();
    await adapters.sheets.batchUpdate(REGISTER, [
      {
        createDeveloperMetadata: {
          metadataKey: "eegml.row",
          metadataValue: "row-b",
          location: { kind: "row", sheetId: 0, index: 2 },
        },
      },
    ]);
    // A person inserts a row above, so the row moves down by one.
    fake.insertRow(REGISTER, 0, 1, ["a-new-row"]);
    const [written] = await adapters.sheets.writeRows(REGISTER, [
      {
        sheetId: 0,
        row: { kind: "metadata", metadataKey: "eegml.row", metadataValue: "row-b" },
        values: [null, null, null, 256],
      },
    ]);
    expect(written?.[0]?.value).toBe("demo-attention-lab:demo-equipment-attention-1");
    expect(fake.rowValues(REGISTER, 0, 3)[3]?.v).toBe(256);
  });

  it("deletes metadata with its row, and leaves it behind on a sort unless told otherwise", async () => {
    const { fake, adapters } = workspace();
    await adapters.sheets.batchUpdate(REGISTER, [
      {
        createDeveloperMetadata: {
          metadataKey: "eegml.row",
          metadataValue: "first",
          location: { kind: "row", sheetId: 0, index: 1 },
        },
      },
    ]);
    fake.sortRows(REGISTER, 0, 0, true);
    let grid = await adapters.sheets.readTab(REGISTER, 0);
    expect(grid.metadata.find((meta) => meta.metadataValue === "first")?.location).toEqual({
      kind: "row",
      sheetId: 0,
      index: 1,
    });
    expect(grid.rows[1]?.[0]?.value).toBe("demo-cognition-lab:demo-equipment-cognition-1");
    fake.deleteRow(REGISTER, 0, 1);
    grid = await adapters.sheets.readTab(REGISTER, 0);
    expect(grid.metadata.filter((meta) => meta.metadataValue === "first")).toEqual([]);
  });

  it("refuses metadata beyond the budget of 30,000 characters", async () => {
    const { adapters } = workspace();
    const refused = await failure(
      adapters.sheets.batchUpdate(REGISTER, [
        {
          createDeveloperMetadata: {
            metadataKey: "eegml.row",
            metadataValue: "x".repeat(30_001),
            location: { kind: "row", sheetId: 0, index: 1 },
          },
        },
      ]),
    );
    expect(refused.status).toBe(400);
  });

  it("refuses a workbook kept in Drive, which is no native spreadsheet", async () => {
    const { adapters } = workspace();
    expect((await failure(adapters.sheets.getSpreadsheet(FAKE_FILES.workbook))).status).toBe(400);
  });
});

describe("the Docs of the fake", () => {
  it("shifts indexes within a batch, grows a range around an insertion, and refuses a stale revision", async () => {
    const { fake, adapters } = workspace();
    const copy = await adapters.drive.copyFile(FAKE_TEMPLATES.recruitment, "Copy", FAKE_FILES.generatedFolder);
    const document = await adapters.docs.getDocument(copy.id);
    const at = document.body.indexOf("{{portal:recruitment}}") + 1;
    const { revisionId, createdRangeIds } = await adapters.docs.batchUpdate(
      copy.id,
      [
        { deleteContentRange: { range: { startIndex: at, endIndex: at + "{{portal:recruitment}}".length } } },
        { insertText: { index: at, text: "Generated" } },
        { createNamedRange: { name: "portal:recruitment", range: { startIndex: at, endIndex: at + 9 } } },
      ],
      document.revisionId,
    );
    expect(createdRangeIds[2]).toMatch(/^fake-range-/);
    fake.replaceInDocument(copy.id, "nera", "NERA");
    const edited = await adapters.docs.getDocument(copy.id);
    const range = edited.namedRanges[0]?.ranges[0];
    expect(edited.body.slice((range?.startIndex ?? 1) - 1, (range?.endIndex ?? 1) - 1)).toBe("GeNERAted");
    const stale = await failure(
      adapters.docs.batchUpdate(copy.id, [{ insertText: { index: 1, text: "x" } }], revisionId),
    );
    expect([stale.status, stale.reason]).toEqual([400, "failedPrecondition"]);
  });

  it("rejects a whole batch for one bad request", async () => {
    const { adapters } = workspace();
    const before = await adapters.docs.getDocument(FAKE_FILES.alphaStageOne);
    const refused = await failure(
      adapters.docs.batchUpdate(
        FAKE_FILES.alphaStageOne,
        [
          { insertText: { index: 1, text: "Kept? " } },
          { deleteContentRange: { range: { startIndex: 5, endIndex: 2 } } },
        ],
        before.revisionId,
      ),
    );
    expect(refused.status).toBe(400);
    expect((await adapters.docs.getDocument(FAKE_FILES.alphaStageOne)).body).toBe(before.body);
  });

  it("splits a range, and removes a range whose text is deleted", async () => {
    const { fake, adapters } = workspace();
    const document = await adapters.docs.getDocument(FAKE_FILES.alphaStageOne);
    const { revisionId } = await adapters.docs.batchUpdate(
      FAKE_FILES.alphaStageOne,
      [{ createNamedRange: { name: "portal:intro", range: { startIndex: 22, endIndex: 34 } } }],
      document.revisionId,
    );
    fake.splitNamedRange(FAKE_FILES.alphaStageOne, "portal:intro", 28);
    expect((await adapters.docs.getDocument(FAKE_FILES.alphaStageOne)).namedRanges[0]?.ranges).toHaveLength(2);
    const current = await adapters.docs.getDocument(FAKE_FILES.alphaStageOne);
    await adapters.docs.batchUpdate(
      FAKE_FILES.alphaStageOne,
      [{ deleteContentRange: { range: { startIndex: 20, endIndex: 40 } } }],
      current.revisionId,
    );
    expect((await adapters.docs.getDocument(FAKE_FILES.alphaStageOne)).namedRanges).toEqual([]);
    expect(revisionId).not.toBe(current.revisionId);
  });
});

describe("the faults of the fake", () => {
  it("answers 429 for Sheets and 403 for Drive once the quota of a minute is spent, and recovers the next minute", async () => {
    const { fake, adapters, advance } = workspace();
    fake.setQuotaPerMinute(2);
    await adapters.sheets.getSpreadsheet(REGISTER);
    await adapters.sheets.getSpreadsheet(REGISTER);
    expect((await failure(adapters.sheets.getSpreadsheet(REGISTER))).status).toBe(429);
    await adapters.drive.getFile(REGISTER);
    await adapters.drive.getFile(REGISTER);
    const drive = await failure(adapters.drive.getFile(REGISTER));
    expect([drive.status, drive.reason]).toEqual([403, "userRateLimitExceeded"]);
    advance(60_000);
    await expect(adapters.sheets.getSpreadsheet(REGISTER)).resolves.toMatchObject({ spreadsheetId: REGISTER });
  });

  it("answers 503 through an outage, and arranged faults a given number of times", async () => {
    const { fake, adapters } = workspace();
    fake.setOutage("docs", true);
    expect((await failure(adapters.docs.getDocument(FAKE_FILES.alphaStageOne))).status).toBe(503);
    fake.setOutage("docs", false);
    fake.arrangeFault({ service: "drive", method: "getFile", status: 500, times: 2 });
    expect((await failure(adapters.drive.getFile(REGISTER))).status).toBe(500);
    expect((await failure(adapters.drive.getFile(REGISTER))).status).toBe(500);
    await expect(adapters.drive.about()).resolves.toEqual({ emailAddress: FAKE_ACCOUNT });
    await expect(adapters.drive.getFile(REGISTER)).resolves.toMatchObject({ id: REGISTER });
  });
});
