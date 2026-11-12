// The callable functions and triggers of the Google integrations, run against the emulators,
// where the functions serve the Google Workspace fake from the run's state file: linking,
// browsing and previewing Drive items within the portal's own permissions, mappings and their
// approval, runs started by hand and by a record's change, conflict resolution with its audit
// trail (acceptance scenario 10), generated documents (acceptance scenario 9) and the
// administration of connections, where only the name of a secret is ever stored.
// Fixtures are synthetic: fictitious accounts, laboratories and files on the example.org domain.
import {
  browseDriveFolderContract,
  COLLECTIONS,
  checkDriveLinkContract,
  controlIntegrationConnectionContract,
  controlSyncMappingContract,
  controlSyncRunContract,
  documentLinkDocSchema,
  generateDocumentContract,
  generatedDocumentDocSchema,
  laboratoryDocSchema,
  linkDriveResourceContract,
  previewDriveFileContract,
  requestSyncRunContract,
  resolveSyncConflictContract,
  resolveSyncReviewItemContract,
  saveDocumentTemplateContract,
  saveSyncMappingContract,
  sourceTabKey,
  syncConflictDocSchema,
  syncMappingDocSchema,
  syncRunDocSchema,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FAKE_ACCOUNT, FAKE_FILES, FAKE_TEMPLATES } from "../../functions/src/integrations/google/fake/fixtures";
import { FAKE_VIEW_ORIGIN } from "../../functions/src/integrations/google/fake/workspace";
import { enqueueRun } from "../../functions/src/integrations/jobs/queue";
import { adminDb } from "../support/admin";
import {
  DIRECTORY_MAPPING,
  EQUIPMENT_MAPPING,
  resetWorkspace,
  seedWorkspaceWorld,
  workspaceFake,
} from "./integrations-world";
import {
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  dataset,
  eventually,
  grantRole,
  leaveNoTrace,
  person,
  refusal,
  replication,
  resetWorld,
  settle,
} from "./support";

const ALPHA = "DemoAlpha2001";
const DIRECTORY = FAKE_FILES.laboratoryDirectory;
const CITY = 2;
const WEBSITE = 3;
const folderAddress = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const documentAddress = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

/**
 * Waits until no run waits or works. Writing the world starts runs through the triggers, and a
 * run of one test must never write into the world of the next.
 */
async function quietRuns(): Promise<void> {
  await eventually(async () => {
    const busy = await adminDb
      .collection(COLLECTIONS.syncRuns.collectionPath())
      .where("status", "in", ["queued", "running"])
      .get();
    return busy.empty;
  }, "the runs to end");
}

beforeEach(async () => {
  await quietRuns();
  await resetWorld();
  resetWorkspace();
  await seedWorkspaceWorld();
  await replication(ALPHA);
  await settle();
  await quietRuns();
});

afterAll(async () => {
  await quietRuns();
  resetWorkspace();
  await leaveNoTrace();
});

/** A member linked to a person of the directory. */
async function member(uid: string): Promise<Caller> {
  await person(`person-${uid}`, [], { displayName: `Synthetic ${uid}`, userId: uid });
  return account(uid, { personId: `person-${uid}` });
}

/** A lead of DemoAlpha2001, who may edit the team folder in Drive and may therefore link it. */
async function lead(uid: string): Promise<Caller> {
  const caller = await member(uid);
  await grantRole(uid, "replication_lead", "replication", ALPHA);
  workspaceFake().shareWithEditor(FAKE_FILES.alphaFolder, caller.email);
  return caller;
}

async function laboratory(id: string) {
  return laboratoryDocSchema.parse((await adminDb.doc(COLLECTIONS.laboratories.docPath(id)).get()).data());
}

/** Waits until a run has ended, as the trigger runs it. */
async function ended(runId: string) {
  return eventually(async () => {
    const run = syncRunDocSchema.safeParse((await adminDb.doc(COLLECTIONS.syncRuns.docPath(runId)).get()).data());
    return run.success && !["queued", "running"].includes(run.data.status) ? run.data : null;
  }, `the end of run ${runId}`);
}

/** Runs a mapping by hand and waits for its end. */
async function runMapping(caller: Caller, mappingId: string) {
  const { runId } = await call(caller, requestSyncRunContract, { mappingId });
  return ended(runId);
}

describe("Drive links", () => {
  it("link a folder with its name and owner as the portal's account sees it, once, with an audit entry", async () => {
    const owner = await lead("uid-lead");
    const linked = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: false,
    });
    expect(linked).toMatchObject({
      accessStatus: "shared",
      title: "DemoAlpha2001 team folder (synthetic)",
      shareWith: null,
    });
    const link = documentLinkDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.documentLinks.docPath(linked.linkId)).get()).data(),
    );
    expect(link).toMatchObject({
      kind: "driveFolder",
      externalId: FAKE_FILES.alphaFolder,
      ownerName: "Synthetic Drive Owner",
      scopeKeys: [`rep:${ALPHA}`, "members"],
      url: `${FAKE_VIEW_ORIGIN}/folders/${FAKE_FILES.alphaFolder}`,
    });
    expect(link.modifiedAt).toBeDefined();
    expect(await auditOf("driveLink.created", linked.linkId)).toHaveLength(1);
    const again = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: false,
    });
    expect(again.linkId).toBe(linked.linkId);
  });

  it("keep an item the portal cannot open as restricted, and name the account to share it with", async () => {
    const owner = await lead("uid-lead");
    const linked = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: documentAddress(FAKE_FILES.privateProtocol),
      restricted: true,
    });
    expect(linked).toEqual({ linkId: linked.linkId, accessStatus: "restricted", title: null, shareWith: FAKE_ACCOUNT });
    // A link kept as restricted opens nothing, even once Drive would answer.
    expect(await codeOf(call(owner, previewDriveFileContract, { linkId: linked.linkId }))).toBe("failed-precondition");
    workspaceFake().restoreAccess(FAKE_FILES.privateProtocol);
    expect(await codeOf(call(owner, previewDriveFileContract, { linkId: linked.linkId }))).toBe("failed-precondition");
    // Only someone who controls the item in Drive opens the link to its readers.
    expect(await codeOf(call(owner, checkDriveLinkContract, { linkId: linked.linkId }))).toBe("permission-denied");
    workspaceFake().shareWithEditor(FAKE_FILES.privateProtocol, owner.email);
    expect(await call(owner, checkDriveLinkContract, { linkId: linked.linkId })).toEqual({
      accessStatus: "shared",
      shareWith: null,
    });
  });

  it("are refused to a member who does not manage the record, to an address that is not Drive's, and to a dataset without its replication", async () => {
    const reader = await member("uid-reader");
    expect(
      await codeOf(
        call(reader, linkDriveResourceContract, {
          entityType: "replication",
          entityId: ALPHA,
          address: folderAddress(FAKE_FILES.alphaFolder),
          restricted: false,
        }),
      ),
    ).toBe("permission-denied");
    const owner = await lead("uid-lead");
    expect(
      await codeOf(
        call(owner, linkDriveResourceContract, {
          entityType: "replication",
          entityId: ALPHA,
          address: "https://example.org/a-file",
          restricted: false,
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(owner, linkDriveResourceContract, {
          entityType: "dataset",
          entityId: "demo-dataset-1",
          address: folderAddress(FAKE_FILES.alphaFolder),
          restricted: false,
        }),
      ),
    ).toBe("not-found");
    // A dataset is linked as the registry holds it, which gives its replication.
    await dataset("demo-dataset-1", ALPHA, null);
    const linked = await call(owner, linkDriveResourceContract, {
      entityType: "dataset",
      entityId: "demo-dataset-1",
      address: folderAddress(FAKE_FILES.alphaDrafts),
      restricted: false,
    });
    expect((await adminDb.doc(COLLECTIONS.documentLinks.docPath(linked.linkId)).get()).data()).toMatchObject({
      entityType: "dataset",
      entityId: "demo-dataset-1",
      replicationId: ALPHA,
    });
  });

  it("are browsed and previewed by those who read them, within the linked folder only", async () => {
    const owner = await lead("uid-lead");
    const reader = await member("uid-reader");
    const { linkId } = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: false,
    });
    const top = await call(reader, browseDriveFolderContract, { linkId });
    expect(top.items.map((item) => [item.kind, item.name])).toEqual([
      ["folder", "Stage 1 drafts (synthetic)"],
      ["file", "Ethics approval (synthetic).pdf"],
      ["spreadsheet", "Recruitment tracker (synthetic)"],
    ]);
    expect(top.items[0]).toMatchObject({
      ownerName: "Synthetic Drive Owner",
      url: `${FAKE_VIEW_ORIGIN}/folders/${FAKE_FILES.alphaDrafts}`,
    });
    const drafts = await call(reader, browseDriveFolderContract, { linkId, folderId: FAKE_FILES.alphaDrafts });
    expect(drafts.path.map((folder) => folder.name)).toEqual([
      "DemoAlpha2001 team folder (synthetic)",
      "Stage 1 drafts (synthetic)",
    ]);
    // A file is described, and its content stays in Google, which applies the reader's own permissions.
    const document = await call(reader, previewDriveFileContract, { linkId, fileId: FAKE_FILES.alphaStageOne });
    expect(document.file).toMatchObject({ kind: "document", name: "Stage 1 report draft (synthetic)" });
    const sheet = await call(reader, previewDriveFileContract, { linkId, fileId: FAKE_FILES.alphaTracker });
    expect(Object.keys(sheet)).toEqual(["file"]);
    expect(JSON.stringify(sheet)).not.toContain("Demo Memory Laboratory");
    // Anything beside the linked folder stays closed, in the words of an item that does not exist.
    expect(
      await codeOf(call(reader, browseDriveFolderContract, { linkId, folderId: FAKE_FILES.cognitionFolder })),
    ).toBe("not-found");
    expect(await codeOf(call(reader, previewDriveFileContract, { linkId, fileId: FAKE_TEMPLATES.recruitment }))).toBe(
      "not-found",
    );
  });

  it("restricted to a team are read by that team alone, and lost access is reported in words", async () => {
    const owner = await lead("uid-lead");
    const outsider = await member("uid-outsider");
    const { linkId } = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: true,
    });
    expect(await codeOf(call(outsider, browseDriveFolderContract, { linkId }))).toBe("not-found");
    expect((await call(owner, browseDriveFolderContract, { linkId })).items).toHaveLength(3);
    workspaceFake().revokeAccess(FAKE_FILES.alphaFolder);
    const refused = await refusal(call(owner, browseDriveFolderContract, { linkId }));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain(FAKE_ACCOUNT);
  });
});

describe("Drive links and what the portal's account was given for other purposes", () => {
  it("refuse a registered source, a template, the shared drive that holds them and the folder of generated documents", async () => {
    const owner = await lead("uid-lead");
    for (const id of [
      FAKE_FILES.laboratoryDirectory,
      FAKE_TEMPLATES.recruitment,
      FAKE_FILES.sharedDriveRoot,
      FAKE_FILES.generatedFolder,
    ]) {
      workspaceFake().shareWithEditor(id, owner.email);
      expect(
        await codeOf(
          call(owner, linkDriveResourceContract, {
            entityType: "replication",
            entityId: ALPHA,
            address: folderAddress(id),
            restricted: true,
          }),
        ),
        id,
      ).toBe("failed-precondition");
    }
    // Not even an administrator of the integrations links them.
    const admin = await administrator("uid-admin");
    expect(
      await codeOf(
        call(admin, linkDriveResourceContract, {
          entityType: "replication",
          entityId: ALPHA,
          address: folderAddress(FAKE_FILES.sharedDriveRoot),
          restricted: true,
        }),
      ),
    ).toBe("failed-precondition");
  });

  it("refuse an item the caller does not control, unless the caller administers the integrations", async () => {
    const owner = await lead("uid-lead");
    const input = {
      entityType: "replication" as const,
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.cognitionFolder),
      restricted: true,
    };
    expect(await codeOf(call(owner, linkDriveResourceContract, input))).toBe("permission-denied");
    const admin = await administrator("uid-admin");
    expect((await call(admin, linkDriveResourceContract, input)).accessStatus).toBe("shared");
  });

  it("refuse an item that another unit's record links already", async () => {
    const coordinator = await member("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "demo-lab-cognition");
    workspaceFake().shareWithEditor(FAKE_FILES.cognitionFolder, coordinator.email);
    await call(coordinator, linkDriveResourceContract, {
      entityType: "laboratory",
      entityId: "demo-lab-cognition",
      address: folderAddress(FAKE_FILES.cognitionFolder),
      restricted: true,
    });
    const owner = await lead("uid-lead");
    workspaceFake().shareWithEditor(FAKE_FILES.cognitionFolder, owner.email);
    expect(
      await codeOf(
        call(owner, linkDriveResourceContract, {
          entityType: "replication",
          entityId: ALPHA,
          address: folderAddress(FAKE_FILES.cognitionFolder),
          restricted: true,
        }),
      ),
    ).toBe("failed-precondition");
  });

  it("leave out of a listing, and refuse to open, a folder that later receives generated documents", async () => {
    const owner = await lead("uid-lead");
    const reader = await member("uid-reader");
    const { linkId } = await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: false,
    });
    const template = (await adminDb.collection(COLLECTIONS.documentTemplates.collectionPath()).limit(1).get()).docs[0];
    await template?.ref.update({ targetFolderId: FAKE_FILES.alphaDrafts });
    const top = await call(reader, browseDriveFolderContract, { linkId });
    expect(top.items.map((item) => item.name)).not.toContain("Stage 1 drafts (synthetic)");
    expect(await codeOf(call(reader, browseDriveFolderContract, { linkId, folderId: FAKE_FILES.alphaDrafts }))).toBe(
      "failed-precondition",
    );
    expect(await codeOf(call(reader, previewDriveFileContract, { linkId, fileId: FAKE_FILES.alphaStageOne }))).toBe(
      "failed-precondition",
    );
  });
});

describe("mappings", () => {
  it("are saved by holders of integrations.manage, start as a dry run, and never take a field the target does not list", async () => {
    const core = await coreTeamMember("uid-core");
    const reader = await member("uid-reader");
    const input = {
      name: "Synthetic second directory",
      sourceKey: "demo-equipment-register",
      tabKey: sourceTabKey("Equipment"),
      collectionKey: "core:laboratories" as const,
      keyColumn: "Configuration key",
      columns: [{ field: "city", column: "City", direction: "bidirectional" as const }],
      sheetOnlyRows: "ignore" as const,
      appOnlyRecords: "ignore" as const,
      cellCeiling: 50,
    };
    expect(await codeOf(call(reader, saveSyncMappingContract, input))).toBe("permission-denied");
    const refused = await refusal(
      call(core, saveSyncMappingContract, {
        ...input,
        columns: [{ field: "genderSource", column: "Gender", direction: "bidirectional" }],
      }),
    );
    expect([refused.code, refused.message]).toEqual([
      "invalid-argument",
      "Laboratories have no field genderSource that a sheet may hold.",
    ]);
    const { mappingId, created } = await call(core, saveSyncMappingContract, input);
    expect(created).toBe(true);
    const stored = syncMappingDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.syncMappings.docPath(mappingId)).get()).data(),
    );
    expect(stored).toMatchObject({ mode: "dryRun", status: "active", approvedBy: null });
    expect(await auditOf("syncMapping.saved", mappingId)).toHaveLength(1);
  });

  it("are approved for live writes by a programme administrator alone, with the approver recorded, and paused and resumed", async () => {
    await seedWorkspaceWorld({ directoryMode: "dryRun" });
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");
    expect(
      await codeOf(call(core, controlSyncMappingContract, { mappingId: DIRECTORY_MAPPING, action: "approveLive" })),
    ).toBe("permission-denied");
    expect(
      await call(admin, controlSyncMappingContract, { mappingId: DIRECTORY_MAPPING, action: "approveLive" }),
    ).toEqual({
      status: "active",
      mode: "live",
    });
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("approvedBy")).toBe(
      "uid-admin",
    );
    const [approval] = await auditOf("syncMapping.liveApproved", DIRECTORY_MAPPING);
    expect(approval).toMatchObject({
      actorUid: "uid-admin",
      changes: [{ field: "mode", before: "dryRun", after: "live" }],
    });
    expect(
      await call(core, controlSyncMappingContract, {
        mappingId: DIRECTORY_MAPPING,
        action: "pause",
        reason: "Checking the sheet.",
      }),
    ).toEqual({
      status: "paused",
      mode: "live",
    });
    expect(await codeOf(call(core, requestSyncRunContract, { mappingId: DIRECTORY_MAPPING }))).toBe(
      "failed-precondition",
    );
    await call(core, controlSyncMappingContract, { mappingId: DIRECTORY_MAPPING, action: "resume" });
    await call(core, controlSyncMappingContract, { mappingId: DIRECTORY_MAPPING, action: "withdrawLive" });
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("mode")).toBe("dryRun");
  });
});

describe("acceptance scenario 10", () => {
  it("takes an external sheet edit into the mapped field, flags simultaneous conflicting edits and resolves them with an audit trail", async () => {
    const admin = await administrator("uid-admin");
    const fake = workspaceFake();
    expect((await runMapping(admin, DIRECTORY_MAPPING)).status).toBe("succeeded");

    // An edit in the sheet reaches the portal.
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    expect((await runMapping(admin, DIRECTORY_MAPPING)).status).toBe("succeeded");
    expect((await laboratory("demo-lab-signal")).city).toBe("Harbour City");

    // Both sides change one field before the next run.
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-memory-lab", WEBSITE, "https://sheet-side.example.org/");
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-memory"))
      .update({ website: "https://portal-side.example.org/" });
    const conflict = await eventually(async () => {
      await runMapping(admin, DIRECTORY_MAPPING).catch(() => null);
      const found = await adminDb
        .collection(COLLECTIONS.syncConflicts.collectionPath())
        .where("mappingId", "==", DIRECTORY_MAPPING)
        .get();
      return found.docs.find((document) => document.get("status") === "open");
    }, "the conflict");
    expect(syncConflictDocSchema.parse(conflict.data())).toMatchObject({
      field: "website",
      appValue: "https://portal-side.example.org/",
      sheetValue: "https://sheet-side.example.org/",
    });

    // A side that changes again after the conflict was recorded refreshes it, and nothing is written.
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-memory-lab", WEBSITE, "https://sheet-side-again.example.org/");
    expect(await call(admin, resolveSyncConflictContract, { conflictId: conflict.id, resolution: "keepApp" })).toEqual({
      status: "refreshed",
    });
    expect((await adminDb.doc(conflict.ref.path).get()).get("sheetValue")).toBe(
      "https://sheet-side-again.example.org/",
    );

    // The administrator keeps the sheet's value: the record takes it, and the audit names the resolver.
    const reader = await member("uid-reader");
    expect(
      await codeOf(call(reader, resolveSyncConflictContract, { conflictId: conflict.id, resolution: "keepSheet" })),
    ).toBe("permission-denied");
    expect(
      await call(admin, resolveSyncConflictContract, {
        conflictId: conflict.id,
        resolution: "keepSheet",
        note: "The sheet is current.",
      }),
    ).toEqual({ status: "resolved" });
    expect((await laboratory("demo-lab-memory")).website).toBe("https://sheet-side-again.example.org/");
    expect((await adminDb.doc(conflict.ref.path).get()).data()).toMatchObject({
      status: "resolved",
      resolution: "keepSheet",
      resolvedBy: "uid-admin",
      resolvedValue: "https://sheet-side-again.example.org/",
    });
    const [entry] = await auditOf("syncConflict.resolved", conflict.id);
    expect(entry).toMatchObject({ actorUid: "uid-admin", actorKind: "user" });
    // With the base set, the next run finds nothing to do.
    const settled = await runMapping(admin, DIRECTORY_MAPPING);
    expect(settled.stats).toMatchObject({ cellsToSheet: 0, fieldsToApp: 0, conflicts: 0 });
  });

  it("merges a value a person enters, writing it to both sides", async () => {
    const admin = await administrator("uid-admin");
    const fake = workspaceFake();
    await runMapping(admin, DIRECTORY_MAPPING);
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-attention-lab", CITY, "Northfield Town");
    await adminDb.doc(COLLECTIONS.laboratories.docPath("demo-lab-attention")).update({ city: "North field" });
    const conflict = await eventually(async () => {
      await runMapping(admin, DIRECTORY_MAPPING);
      const found = await adminDb
        .collection(COLLECTIONS.syncConflicts.collectionPath())
        .where("status", "==", "open")
        .get();
      return found.docs[0];
    }, "the conflict");
    await call(admin, resolveSyncConflictContract, {
      conflictId: conflict.id,
      resolution: "merged",
      mergedValue: "Northfield",
    });
    expect((await laboratory("demo-lab-attention")).city).toBe("Northfield");
    expect(fake.rowValues(DIRECTORY, 0, fake.rowIndexOfKey(DIRECTORY, 0, 0, "demo-attention-lab"))[CITY]?.v).toBe(
      "Northfield",
    );
  });
});

describe("runs", () => {
  it("start when a record changes, and never from the engine's own writes", async () => {
    const admin = await administrator("uid-admin");
    const fake = workspaceFake();
    await runMapping(admin, DIRECTORY_MAPPING);
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-cognition"))
      .update({ website: "https://cognition.example.org/" });
    await eventually(
      async () =>
        fake.rowValues(DIRECTORY, 0, fake.rowIndexOfKey(DIRECTORY, 0, 0, "demo-cognition-lab"))[WEBSITE]?.v ===
        "https://cognition.example.org/",
      "the website in the sheet",
    );
    fake.editCellByKey(DIRECTORY, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    await runMapping(admin, DIRECTORY_MAPPING);
    const runs = async () => (await adminDb.collection(COLLECTIONS.syncRuns.collectionPath()).get()).size;
    const count = await runs();
    // The write of the city came from synchronisation, so it started no run of its own.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(await runs()).toBe(count);
  });

  it("are retried and cancelled by hand", async () => {
    const admin = await administrator("uid-admin");
    const fake = workspaceFake();
    fake.revokeAccess(DIRECTORY);
    const failed = await runMapping(admin, DIRECTORY_MAPPING);
    expect(failed).toMatchObject({ status: "failed", errorKind: "accessLost" });
    fake.restoreAccess(DIRECTORY);
    const runId =
      (await adminDb.collection(COLLECTIONS.syncRuns.collectionPath()).where("status", "==", "failed").get()).docs[0]
        ?.id ?? "";
    expect(await call(admin, controlSyncRunContract, { runId, action: "retry" })).toEqual({ status: "queued" });
    expect((await ended(runId)).status).toBe("succeeded");
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("status")).toBe("active");
    expect(await codeOf(call(admin, controlSyncRunContract, { runId, action: "cancel" }))).toBe("failed-precondition");
  });

  it("leave a row that has gone for review, and append it again once its state is forgotten", async () => {
    const admin = await administrator("uid-admin");
    const fake = workspaceFake();
    await runMapping(admin, EQUIPMENT_MAPPING);
    const key = "demo-attention-lab:demo-equipment-attention-1";
    fake.deleteRow(FAKE_FILES.equipmentRegister, 0, fake.rowIndexOfKey(FAKE_FILES.equipmentRegister, 0, 0, key));
    expect((await runMapping(admin, EQUIPMENT_MAPPING)).status).toBe("partial");
    const item = (
      await adminDb.collection(COLLECTIONS.syncReviewItems.collectionPath()).where("kind", "==", "missingRow").get()
    ).docs[0];
    expect(item?.get("rowKey")).toBe(key);
    await call(admin, resolveSyncReviewItemContract, {
      itemId: item?.id ?? "",
      action: "forgetRow",
      note: "The row was deleted by mistake.",
    });
    await runMapping(admin, EQUIPMENT_MAPPING);
    expect(fake.rowIndexOfKey(FAKE_FILES.equipmentRegister, 0, 0, key)).toBeGreaterThan(0);
  });
});

describe("dry runs", () => {
  it("are recorded on their mapping with what they planned, and never as a live success", async () => {
    await seedWorkspaceWorld({ directoryMode: "dryRun" });
    const admin = await administrator("uid-admin");
    const run = await runMapping(admin, DIRECTORY_MAPPING);
    expect(run.status).toBe("succeeded");
    const mapping = syncMappingDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).data(),
    );
    expect(mapping).toMatchObject({ lastRunDry: true, lastSuccessAt: null });
    expect(mapping.lastRunAt).not.toBeNull();
    expect(mapping.lastStats).toBeDefined();
  });
});

describe("generated documents and their audience", () => {
  it("keep recruitment, which states each laboratory's figures, to the replication's team and programme staff", async () => {
    const owner = await lead("uid-lead");
    const { generatedDocumentId } = await call(owner, generateDocumentContract, {
      kind: "recruitment",
      entityType: "replication",
      entityId: ALPHA,
    });
    const recruitment = generatedDocumentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(generatedDocumentId)).get()).data(),
    );
    expect(recruitment).toMatchObject({
      templateKind: "recruitment",
      restricted: true,
      scopeKeys: [`rep:${ALPHA}`, "programme"],
    });
    const { generatedDocumentId: progressId } = await call(owner, generateDocumentContract, {
      kind: "replicationProgress",
      entityType: "replication",
      entityId: ALPHA,
    });
    expect(
      generatedDocumentDocSchema.parse(
        (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(progressId)).get()).data(),
      ),
    ).toMatchObject({ restricted: false, scopeKeys: [`rep:${ALPHA}`, "members"] });
  });

  it("are asked for by kind by those who manage the record, and a template that is off says so", async () => {
    const owner = await lead("uid-lead");
    const template = (
      await adminDb.collection(COLLECTIONS.documentTemplates.collectionPath()).where("kind", "==", "milestones").get()
    ).docs[0];
    await template?.ref.update({ enabled: false });
    const refused = await refusal(
      call(owner, generateDocumentContract, { kind: "milestones", entityType: "replication", entityId: ALPHA }),
    );
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("switched off");
    expect(
      await codeOf(
        call(owner, generateDocumentContract, {
          kind: "milestones",
          templateKey: "milestones",
          entityType: "replication",
          entityId: ALPHA,
        }),
      ),
    ).toBe("invalid-argument");
  });
});

describe("generated documents (acceptance scenario 9)", () => {
  it("are generated by those who manage the record, and a hand edit of the designated field is taken in by a reviewer", async () => {
    const coordinator = await member("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "demo-lab-memory");
    const outsider = await member("uid-outsider");
    const input = {
      templateKey: "laboratory-progress",
      entityType: "laboratory",
      entityId: "demo-lab-memory",
    } as const;
    expect(await codeOf(call(outsider, generateDocumentContract, input))).toBe("permission-denied");
    const { generatedDocumentId, runId } = await call(coordinator, generateDocumentContract, input);
    expect((await ended(runId)).status).toBe("succeeded");
    const stored = generatedDocumentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(generatedDocumentId)).get()).data(),
    );
    expect(stored).toMatchObject({ status: "current", scopeKeys: ["lab:demo-lab-memory", "members"] });

    const fake = workspaceFake();
    fake.replaceInDocument(
      stored.externalDocumentId ?? "",
      "No description is recorded.",
      "Written in the document by the laboratory.",
    );
    const second = await call(coordinator, generateDocumentContract, input);
    expect((await ended(second.runId)).status).toBe("partial");
    const conflict = (
      await adminDb
        .collection(COLLECTIONS.syncConflicts.collectionPath())
        .where("generatedDocumentId", "==", generatedDocumentId)
        .get()
    ).docs[0];
    const admin = await administrator("uid-admin");
    expect(
      await call(admin, resolveSyncConflictContract, { conflictId: conflict?.id ?? "", resolution: "keepSheet" }),
    ).toEqual({
      status: "resolved",
    });
    expect((await laboratory("demo-lab-memory")).description).toBe("Written in the document by the laboratory.");
    expect(await auditOf("generatedDocument.sectionTaken", "demo-lab-memory")).toHaveLength(1);
    const after = generatedDocumentDocSchema.parse(
      (await adminDb.doc(COLLECTIONS.generatedDocuments.docPath(generatedDocumentId)).get()).data(),
    );
    expect(after.status).toBe("current");
    expect(fake.documentText(stored.externalDocumentId ?? "")).toContain("Written in the document by the laboratory.");
  });

  it("use templates that holders of integrations.manage register, in a shared drive only", async () => {
    const core = await coreTeamMember("uid-core");
    const input = {
      key: "synthetic-template",
      kind: "meetings",
      name: "Synthetic meetings",
      externalDocumentId: FAKE_TEMPLATES.meetings,
      targetFolderId: FAKE_FILES.generatedFolder,
      enabled: true,
      mode: "dryRun",
    } as const;
    expect(await call(core, saveDocumentTemplateContract, input)).toEqual({ key: "synthetic-template", created: true });
    expect(await codeOf(call(core, saveDocumentTemplateContract, { ...input, mode: "live" }))).toBe(
      "permission-denied",
    );
    expect(
      await codeOf(call(core, saveDocumentTemplateContract, { ...input, targetFolderId: FAKE_FILES.alphaFolder })),
    ).toBe("failed-precondition");
  });
});

describe("connections", () => {
  it("test each service with a read of its own, so an outage of one is never reported as working", async () => {
    const core = await coreTeamMember("uid-core");
    const fake = workspaceFake();
    fake.setOutage("docs", true);
    const docs = await call(core, controlIntegrationConnectionContract, { system: "googleDocs", action: "test" });
    expect(docs.status).toBe("degraded");
    expect(docs.message).toContain("did not answer for Docs");
    // Drive still answers, and its test leaves Docs as it was.
    expect(
      (await call(core, controlIntegrationConnectionContract, { system: "googleDrive", action: "test" })).status,
    ).toBe("live");
    const connection = async (system: string) =>
      (await adminDb.doc(COLLECTIONS.integrationConnections.docPath(system)).get()).data();
    expect((await connection("googleDocs"))?.status).toBe("degraded");
    fake.setOutage("docs", false);
    expect(
      (await call(core, controlIntegrationConnectionContract, { system: "googleDocs", action: "test" })).status,
    ).toBe("live");
    expect(
      (await call(core, controlIntegrationConnectionContract, { system: "googleSheets", action: "test" })).message,
    ).toContain("Sheets answered");
  });

  it("record Drive's health from the calls people wait for", async () => {
    const owner = await lead("uid-lead");
    await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleDrive")).update({ lastSuccessAt: null });
    await call(owner, linkDriveResourceContract, {
      entityType: "replication",
      entityId: ALPHA,
      address: folderAddress(FAKE_FILES.alphaFolder),
      restricted: true,
    });
    const drive = (await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleDrive")).get()).data();
    expect(drive?.lastSuccessAt).not.toBeNull();
  });

  it("refuse a run of a mapping while Google Sheets is paused, in words", async () => {
    const core = await coreTeamMember("uid-core");
    await call(core, controlIntegrationConnectionContract, { system: "googleSheets", action: "pause" });
    const refused = await refusal(call(core, requestSyncRunContract, { mappingId: DIRECTORY_MAPPING }));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("Google Sheets is paused");
  });

  it("are tested, paused and resumed, and name a secret without ever holding one", async () => {
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");
    expect(await call(core, controlIntegrationConnectionContract, { system: "googleDrive", action: "test" })).toEqual({
      status: "live",
      message: `Drive answered as ${FAKE_ACCOUNT}.`,
    });
    expect(
      (await call(core, controlIntegrationConnectionContract, { system: "googleSheets", action: "pause" })).status,
    ).toBe("paused");
    // A run asked for by hand is refused in words; one that an event starts is skipped.
    expect(await codeOf(call(admin, requestSyncRunContract, { mappingId: DIRECTORY_MAPPING }))).toBe(
      "failed-precondition",
    );
    const { runId } = await enqueueRun(adminDb, {
      kind: "sheetSync",
      mappingId: DIRECTORY_MAPPING,
      mode: "live",
      trigger: "event",
      eventKey: "test:paused-connection",
      requestedBy: "system:test",
      at: new Date(),
    });
    expect(await ended(runId)).toMatchObject({ status: "skipped", error: "The connection is paused." });
    expect(
      (await call(core, controlIntegrationConnectionContract, { system: "googleSheets", action: "resume" })).status,
    ).toBe("live");
    expect(
      await codeOf(
        call(core, controlIntegrationConnectionContract, {
          system: "googleDocs",
          action: "setCredentialRef",
          credentialRef: "GOOGLE_DOCS_REFRESH_TOKEN",
        }),
      ),
    ).toBe("permission-denied");
    expect(
      await codeOf(
        call(admin, controlIntegrationConnectionContract, {
          system: "googleDocs",
          action: "setCredentialRef",
          credentialRef: "ya29.a-token-value",
        }),
      ),
    ).toBe("invalid-argument");
    await call(admin, controlIntegrationConnectionContract, {
      system: "googleDocs",
      action: "setCredentialRef",
      credentialRef: "GOOGLE_DOCS_REFRESH_TOKEN",
    });
    expect(
      (await adminDb.doc(COLLECTIONS.integrationConnections.docPath("googleDocs")).get()).get("credentialRef"),
    ).toBe("GOOGLE_DOCS_REFRESH_TOKEN");
    expect(await auditOf("integration.credentialNamed", "googleDocs")).toHaveLength(1);
  });

  it("renew the Drive push channel and keep only the hash of its token", async () => {
    const core = await coreTeamMember("uid-core");
    await call(core, controlIntegrationConnectionContract, { system: "googleDrive", action: "renewChannel" });
    const channels = await adminDb.collection(COLLECTIONS.driveChannels.collectionPath()).get();
    expect(channels.size).toBe(1);
    expect(channels.docs[0]?.get("tokenHash")).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await codeOf(
        call(core, controlIntegrationConnectionContract, { system: "googleSheets", action: "renewChannel" }),
      ),
    ).toBe("invalid-argument");
  });
});
