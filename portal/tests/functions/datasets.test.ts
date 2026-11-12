// Integration tests of the dataset registry, run against the emulators, where the functions serve
// the storage fake from the run's state file (docs/DATA_MODEL.md, section 10; docs/INTEGRATIONS.md,
// section 7): registering a dataset on an institutional server with no central copy (acceptance
// scenario 8), reads of locations that only the leads, the laboratory's coordinators and the
// administrators may make and that are always recorded, scans against expected manifests, an
// outage, a refused account and a slow server with recovery afterwards (acceptance scenario 15),
// the workflow and its history, transfers that are only recorded and approved, the BIDS report,
// quality control with the task that the arrival of data opens once, relocations, viewer links
// that nothing depends on, and the links of tasks that now resolve.
// Fixtures are synthetic: fictitious accounts, laboratories, servers and files on the example.org domain.
import {
  addStorageRefContract,
  advanceTransferContract,
  type CallableInput,
  COLLECTIONS,
  changeStorageRefContract,
  checkStorageEndpointContract,
  createTaskContract,
  createTaskListContract,
  datasetAccessEventDocSchema,
  datasetDetailDocSchema,
  datasetDocSchema,
  datasetManifestDocSchema,
  datasetQcTaskId,
  datasetStorageRefDocSchema,
  datasetTransferDocSchema,
  getStorageEndpointConnectionContract,
  getStorageLocationContract,
  importBidsReportContract,
  openViewerLinkContract,
  recordManifestContract,
  recordQcAssessmentContract,
  registerDatasetContract,
  requestTransferContract,
  saveDatasetWorkflowContract,
  saveStorageEndpointContract,
  saveViewerLinkContract,
  scanStorageRefContract,
  setDatasetStatusContract,
  statusHistoryDocSchema,
  storageEndpointDocSchema,
  taskDocSchema,
  updateDatasetContract,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sweepEndpoints } from "../../functions/src/datasets/endpoints";
import type { StorageFake } from "../../functions/src/integrations/storage/fake";
import {
  FAKE_BASE_PATHS,
  FAKE_DATASET_PATHS,
  FAKE_SERVERS,
  syntheticBidsFiles,
  syntheticDigest,
} from "../../functions/src/integrations/storage/fixtures";
import { adminDb } from "../support/admin";
import {
  type DatasetWorld,
  datasetWorld,
  ENDPOINTS,
  freshStorageFake,
  LAB_BREMEN,
  REASON,
  STUDY,
  STUDY_FOLDER,
} from "./datasets-world";
import {
  auditOf,
  type Caller,
  call,
  codeOf,
  dataOf,
  leaveNoTrace,
  notificationsOf,
  refusal,
  resetWorld,
} from "./support";

const BREMEN_KEY = "DataStudy2001-bremen-main";
const MUNICH_KEY = "DataStudy2001-munich-main";

let world: DatasetWorld;
let fake: StorageFake;

beforeEach(async () => {
  await resetWorld();
  fake = freshStorageFake();
  world = await datasetWorld();
});

afterAll(leaveNoTrace);

type Registration = CallableInput<typeof registerDatasetContract>;

function registration(fields: Partial<Registration> = {}): Registration {
  return {
    datasetKey: BREMEN_KEY,
    replicationId: STUDY,
    laboratoryId: LAB_BREMEN,
    title: "Flanker task, main experiment, Bremen",
    modality: "main",
    groupingLabel: "Session 1",
    sourceInstitutionId: null,
    storageOwnerPersonId: null,
    protocolId: null,
    expectedFileCount: null,
    expectedParticipants: 3,
    metadata: { amplifier: "Synthetic amplifier", samplingRateHz: 1000 },
    storage: {
      endpointKey: ENDPOINTS.bremen,
      role: "primary",
      path: FAKE_DATASET_PATHS.alphaAttention,
      viewerSupport: [],
    },
    ...fields,
  };
}

async function register(caller: Caller, fields: Partial<Registration> = {}) {
  return call(caller, registerDatasetContract, registration(fields));
}

const datasetOf = async (key: string) => datasetDocSchema.parse(await dataOf(COLLECTIONS.datasets.docPath(key)));
const refOf = async (key: string, id: string) =>
  datasetStorageRefDocSchema.parse(await dataOf(COLLECTIONS.datasetStorageRefs.docPath(key, id)));
const endpointOf = async (key: string) =>
  storageEndpointDocSchema.parse(await dataOf(COLLECTIONS.storageEndpoints.docPath(key)));

/** The expected files of the Bremen dataset, as a laboratory would upload them: path, size and checksum. */
function expectedFiles(participants: readonly string[] = ["01", "02", "03"]) {
  return syntheticBidsFiles(participants, "flanker").map((file) => ({
    relativePath: file.path,
    sizeBytes: file.size,
    checksumAlgorithm: "sha256",
    checksum: syntheticDigest(file.path),
  }));
}

async function expect3Participants(caller: Caller, key = BREMEN_KEY) {
  await call(caller, recordManifestContract, {
    datasetKey: key,
    kind: "expected",
    storageRefId: null,
    origin: "upload",
    files: expectedFiles(),
  });
}

const bremenRoot = `${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}`;

describe("registerDataset (acceptance scenario 8)", () => {
  it("registers a dataset held on an institutional server, with no central copy and no participant identity", async () => {
    const { storageRefId } = await register(world.lead);
    expect(storageRefId).not.toBeNull();
    const dataset = await datasetOf(BREMEN_KEY);
    expect(dataset).toMatchObject({
      replicationId: STUDY,
      laboratoryId: LAB_BREMEN,
      participationId: `${STUDY}__${LAB_BREMEN}`,
      workflowStatusKey: "received",
      bidsStatus: "notStarted",
      qcStatus: "notStarted",
      availability: "unknown",
      analysisReady: false,
      dataOrigin: "live",
    });
    // The registry document names no path, no host and no metadata.
    const text = JSON.stringify(dataset);
    expect(text).not.toContain(FAKE_DATASET_PATHS.alphaAttention);
    expect(text).not.toContain(FAKE_SERVERS.bremen);
    expect(text).not.toContain("Synthetic amplifier");
    const detail = datasetDetailDocSchema.parse(await dataOf(COLLECTIONS.datasetDetail.docPath(BREMEN_KEY)));
    expect(detail.metadata).toEqual({ amplifier: "Synthetic amplifier", samplingRateHz: 1000 });
    const location = await dataOf(COLLECTIONS.datasetStorageRefLocation.docPath(BREMEN_KEY, storageRefId ?? ""));
    expect(location?.uri).toBe(FAKE_DATASET_PATHS.alphaAttention);
    const history = statusHistoryDocSchema.parse(
      await dataOf(COLLECTIONS.statusHistory.docPath(dataset.statusHistoryId ?? "")),
    );
    expect(history).toMatchObject({
      entityType: "dataset",
      entityId: BREMEN_KEY,
      fromStatusKey: null,
      toStatusKey: "received",
    });
    expect((await endpointOf(ENDPOINTS.bremen)).scopeKeys).toEqual([`rep:${STUDY}`, `lab:${LAB_BREMEN}`]);
    const [audit] = await auditOf("dataset.registered", BREMEN_KEY);
    expect(audit?.actorUid).toBe(world.lead.uid);
  });

  it("is open to the laboratory's coordinator, and refused to its members, another replication's lead and a duplicate", async () => {
    await register(world.coordinatorBremen);
    expect(await codeOf(register(world.coordinatorBremen))).toBe("already-exists");
    expect(await codeOf(register(world.memberBremen, { datasetKey: "member-attempt" }))).toBe("permission-denied");
    expect(await codeOf(register(world.otherLead, { datasetKey: "other-attempt" }))).toBe("permission-denied");
    expect(await codeOf(register(world.coordinatorMunich, { datasetKey: "munich-attempt" }))).toBe("permission-denied");
  });

  it("registers a dataset with no copy at all, since central storage is never required", async () => {
    const { storageRefId } = await register(world.lead, { storage: null });
    expect(storageRefId).toBeNull();
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("noStorage");
  });

  it("refuses a retired server and a protocol that is not the replication's", async () => {
    await adminDb.doc(COLLECTIONS.storageEndpoints.docPath(ENDPOINTS.munich)).update({ status: "retired" });
    expect(
      await codeOf(
        register(world.lead, {
          storage: { endpointKey: ENDPOINTS.munich, role: "primary", path: `${STUDY_FOLDER}/x`, viewerSupport: [] },
        }),
      ),
    ).toBe("failed-precondition");
    expect(await codeOf(register(world.lead, { protocolId: "no-such-protocol" }))).toBe("invalid-argument");
  });
});

describe("the location of a copy", () => {
  it("is served to the lead, the laboratory's coordinator and administrators, and every read is recorded", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    for (const caller of [world.lead, world.coordinatorBremen, world.admin]) {
      const location = await call(caller, getStorageLocationContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
      expect(location).toEqual({
        uri: FAKE_DATASET_PATHS.alphaAttention,
        endpointName: "Synthetic Bremen EEG server",
        protocol: "sftp",
        host: FAKE_SERVERS.bremen,
        port: null,
        basePath: FAKE_BASE_PATHS.bremen,
      });
    }
    const events = (
      await adminDb.collection(COLLECTIONS.datasetAccessEvents.collectionPath(BREMEN_KEY)).get()
    ).docs.map((snapshot) => datasetAccessEventDocSchema.parse(snapshot.data()));
    expect(
      events
        .filter((event) => event.action === "viewLocation")
        .map((event) => event.uid)
        .sort(),
    ).toEqual([world.admin.uid, world.coordinatorBremen.uid, world.lead.uid].sort());
    expect(events.filter((event) => event.action === "viewConnection")).toHaveLength(3);
    expect(await auditOf("storageLocation.viewed", BREMEN_KEY)).toHaveLength(3);
  });

  it("is refused to the laboratory's members, another laboratory's coordinator, another replication's lead and members", async () => {
    const { storageRefId } = await register(world.lead);
    for (const caller of [world.memberBremen, world.coordinatorMunich, world.otherLead, world.member]) {
      expect(
        await codeOf(
          call(caller, getStorageLocationContract, { datasetKey: BREMEN_KEY, storageRefId: storageRefId ?? "" }),
        ),
      ).toBe("permission-denied");
    }
    expect((await adminDb.collection(COLLECTIONS.datasetAccessEvents.collectionPath(BREMEN_KEY)).get()).size).toBe(0);
  });
});

describe("scanStorageRef and recordManifest", () => {
  it("lists a copy without reading a recording, compares it with the expected files, verifies it and opens the QC task once", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    await expect3Participants(world.lead);
    expect((await datasetOf(BREMEN_KEY)).expectedFileCount).toBe(12);
    const scan = await call(world.coordinatorBremen, scanStorageRefContract, {
      datasetKey: BREMEN_KEY,
      storageRefId: refId,
    });
    expect(scan).toMatchObject({ status: "ok", counts: { present: 12 } });
    expect(fake.contentReads()).toEqual([`${FAKE_SERVERS.bremen}:${bremenRoot}/SHA256SUMS`]);

    const ref = await refOf(BREMEN_KEY, refId);
    expect(ref).toMatchObject({ availability: "available", lastScanStatus: "ok", latestManifestId: scan.manifestId });
    expect(ref.verificationManifestId).toBe(scan.manifestId);
    expect(ref.lastSeenAt).not.toBeNull();
    const dataset = await datasetOf(BREMEN_KEY);
    expect(dataset).toMatchObject({ availability: "available", receivedFileCount: 12, qcStatus: "pending" });
    expect(dataset.receivedAt).toBeDefined();
    const manifest = datasetManifestDocSchema.parse(
      await dataOf(COLLECTIONS.datasetManifests.docPath(BREMEN_KEY, scan.manifestId ?? "")),
    );
    expect(manifest).toMatchObject({
      kind: "listing",
      origin: "scan",
      fileCount: 12,
      checksumCount: 12,
      chunkCount: 1,
    });

    const task = taskDocSchema.parse(await dataOf(COLLECTIONS.tasks.docPath(datasetQcTaskId(BREMEN_KEY))));
    expect(task.links).toEqual([{ entityType: "dataset", entityId: BREMEN_KEY }]);
    expect(task.assigneeUids).toEqual([world.coordinatorBremen.uid]);
    expect(task.collaboratorUids).toEqual([world.lead.uid]);
    expect(
      (await notificationsOf(world.coordinatorBremen.uid)).filter((item) => item.type === "assignment"),
    ).toHaveLength(1);

    // A second scan writes a second listing and no second task.
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    const qcTasks = await adminDb.collection(COLLECTIONS.tasks.collectionPath()).where("title", "==", task.title).get();
    expect(qcTasks.size).toBe(1);
    expect(await auditOf("storageRef.scanned", BREMEN_KEY)).toHaveLength(2);
  });

  it("reports missing, unexpected and different files against the expected manifest", async () => {
    const { storageRefId } = await register(world.lead);
    await expect3Participants(world.lead);
    fake.removeFile(FAKE_SERVERS.bremen, `${bremenRoot}/sub-03/eeg/sub-03_task-flanker_eeg.eeg`);
    fake.putFile(FAKE_SERVERS.bremen, `${bremenRoot}/stray.txt`, { size: 3, modified: "2026-10-06T08:00:00.000Z" });
    fake.putFile(FAKE_SERVERS.bremen, `${bremenRoot}/sub-02/eeg/sub-02_task-flanker_eeg.vhdr`, {
      size: 1,
      modified: "2026-10-06T08:00:00.000Z",
    });
    const scan = await call(world.lead, scanStorageRefContract, {
      datasetKey: BREMEN_KEY,
      storageRefId: storageRefId ?? "",
    });
    expect(scan.counts).toEqual({ present: 10, mismatch: 1, missing: 1, unexpected: 1 });
    expect((await datasetOf(BREMEN_KEY)).receivedFileCount).toBe(11);
    expect((await refOf(BREMEN_KEY, storageRefId ?? "")).verificationManifestId).toBeNull();
  });

  it("records a listing made inside the institution for a server the portal cannot reach, and refuses to scan it", async () => {
    const { storageRefId } = await register(world.lead, {
      storage: {
        endpointKey: ENDPOINTS.institutional,
        role: "primary",
        path: `${STUDY_FOLDER}/flanker`,
        viewerSupport: [],
      },
    });
    expect(
      await codeOf(
        call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: storageRefId ?? "" }),
      ),
    ).toBe("failed-precondition");
    await expect3Participants(world.lead);
    const listing = await call(world.coordinatorBremen, recordManifestContract, {
      datasetKey: BREMEN_KEY,
      kind: "listing",
      storageRefId,
      origin: "upload",
      files: expectedFiles(["01", "02"]),
    });
    expect(listing.counts).toEqual({ present: 9, missing: 3 });
    expect((await refOf(BREMEN_KEY, storageRefId ?? "")).availability).toBe("available");
    expect(
      await codeOf(
        call(world.lead, recordManifestContract, {
          datasetKey: BREMEN_KEY,
          kind: "expected",
          storageRefId: null,
          origin: "manual",
          files: [{ relativePath: "../escape.eeg" }],
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(world.memberBremen, recordManifestContract, {
          datasetKey: BREMEN_KEY,
          kind: "expected",
          storageRefId: null,
          origin: "manual",
          files: [{ relativePath: "a.eeg" }],
        }),
      ),
    ).toBe("permission-denied");
  });
});

describe("faults of a server and recovery (acceptance scenario 15)", () => {
  it("keeps the registry usable from the last listing while a server is down, tells people once, and recovers", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    const first = await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    const seen = (await refOf(BREMEN_KEY, refId)).lastSeenAt;

    fake.setMode(FAKE_SERVERS.bremen, "down");
    const failed = await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    expect(failed).toMatchObject({ status: "unreachable", manifestId: null });
    const down = await refOf(BREMEN_KEY, refId);
    expect(down).toMatchObject({
      availability: "unavailable",
      lastScanStatus: "unreachable",
      latestManifestId: first.manifestId,
    });
    expect(down.lastSeenAt?.toMillis()).toBe(seen?.toMillis());
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("unavailable");
    expect((await endpointOf(ENDPOINTS.bremen)).status).toBe("unreachable");
    // The last listing is untouched and no file was marked missing.
    const manifests = await adminDb.collection(COLLECTIONS.datasetManifests.collectionPath(BREMEN_KEY)).get();
    expect(manifests.size).toBe(1);

    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    const told = (await notificationsOf(world.admin.uid)).filter((item) => item.type === "integrationFailure");
    expect(told).toHaveLength(1);
    expect(told[0]?.payload).toMatchObject({ kind: "storageUnreachable", endpointKey: ENDPOINTS.bremen });

    fake.setMode(FAKE_SERVERS.bremen, "up");
    const recovered = await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    expect(recovered.status).toBe("ok");
    expect((await refOf(BREMEN_KEY, refId)).availability).toBe("available");
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("available");
    expect((await endpointOf(ENDPOINTS.bremen)).status).toBe("active");
  });

  it("marks a copy unavailable when the account is refused, leaving the server active", async () => {
    const { storageRefId } = await register(world.lead);
    fake.setDenied(FAKE_SERVERS.bremen, true);
    const scan = await call(world.lead, scanStorageRefContract, {
      datasetKey: BREMEN_KEY,
      storageRefId: storageRefId ?? "",
    });
    expect(scan.status).toBe("permissionDenied");
    expect((await refOf(BREMEN_KEY, storageRefId ?? "")).lastScanStatus).toBe("permissionDenied");
    expect((await endpointOf(ENDPOINTS.bremen)).status).toBe("active");
  });

  it("gives up on a server that answers too slowly", async () => {
    const { storageRefId } = await register(world.lead);
    fake.setLatency(FAKE_SERVERS.bremen, 3_000);
    const scan = await call(world.lead, scanStorageRefContract, {
      datasetKey: BREMEN_KEY,
      storageRefId: storageRefId ?? "",
    });
    expect(scan.status).toBe("timeout");
    expect((await endpointOf(ENDPOINTS.bremen)).status).toBe("unreachable");
  });

  it("is checked by the daily sweep, which marks a server down and then active again", async () => {
    fake.setMode(FAKE_SERVERS.munich, "down");
    const runtime = fake.runtime();
    expect(await sweepEndpoints(adminDb, new Date(), runtime)).toEqual({ checked: 3, reachable: 2, unreachable: 1 });
    expect((await endpointOf(ENDPOINTS.munich)).status).toBe("unreachable");
    fake.setMode(FAKE_SERVERS.munich, "up");
    await sweepEndpoints(adminDb, new Date(), runtime);
    expect((await endpointOf(ENDPOINTS.munich)).status).toBe("active");
    expect(await auditOf("storageEndpoint.checked", ENDPOINTS.munich)).toHaveLength(2);
  });
});

describe("a check of a server and the copies held there", () => {
  it("makes the copies unavailable while the server is down, the dataset follows, and the next check restores them", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    await expect3Participants(world.lead);
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("available");
    fake.setMode(FAKE_SERVERS.bremen, "down");
    const down = await call(world.admin, checkStorageEndpointContract, { key: ENDPOINTS.bremen });
    expect(down).toMatchObject({ status: "unreachable", reachable: false });
    const unavailable = await refOf(BREMEN_KEY, refId);
    expect(unavailable.availability).toBe("unavailable");
    // The last listing and the time it was last seen stay.
    expect(unavailable.latestManifestId).not.toBeNull();
    expect(unavailable.lastSeenAt).not.toBeNull();
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("unavailable");
    fake.setMode(FAKE_SERVERS.bremen, "up");
    await call(world.admin, checkStorageEndpointContract, { key: ENDPOINTS.bremen });
    expect((await refOf(BREMEN_KEY, refId)).availability).toBe("available");
    expect((await datasetOf(BREMEN_KEY)).availability).toBe("available");
  });

  it("leaves a copy whose account was refused as it is when the server answers again", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    fake.setDenied(FAKE_SERVERS.bremen, false, [`${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}`]);
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: refId });
    expect((await refOf(BREMEN_KEY, refId)).availability).toBe("unavailable");
    await call(world.admin, checkStorageEndpointContract, { key: ENDPOINTS.bremen });
    expect((await refOf(BREMEN_KEY, refId)).availability).toBe("unavailable");
  });
});

describe("received files", () => {
  it("are counted from the primary copy, and a listing of a mirror leaves them alone", async () => {
    const { storageRefId } = await register(world.lead);
    await expect3Participants(world.lead);
    // The primary copy lacks one file.
    fake.removeFile(FAKE_SERVERS.bremen, `${bremenRoot}/sub-03/eeg/sub-03_task-flanker_eeg.eeg`);
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: storageRefId ?? "" });
    expect((await datasetOf(BREMEN_KEY)).receivedFileCount).toBe(11);
    const { storageRefId: mirror } = await call(world.lead, addStorageRefContract, {
      datasetKey: BREMEN_KEY,
      endpointKey: ENDPOINTS.central,
      role: "mirror",
      path: FAKE_DATASET_PATHS.alphaAttention,
      viewerSupport: [],
      note: "",
    });
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: mirror });
    expect((await datasetOf(BREMEN_KEY)).receivedFileCount).toBe(11);
  });
});

describe("a state that claims the checks have passed", () => {
  it("is refused while the record says otherwise, unless the problems are acknowledged, which the history keeps", async () => {
    await register(world.lead);
    await adminDb.doc(COLLECTIONS.datasets.docPath(BREMEN_KEY)).update({
      workflowStatusKey: "accepted",
      bidsStatus: "invalid",
      qcStatus: "flagged",
    });
    const move = (acknowledge: boolean) =>
      call(world.lead, setDatasetStatusContract, {
        datasetKey: BREMEN_KEY,
        fromStatusKey: "accepted",
        toStatusKey: "analysisReady",
        reason: "Synthetic.",
        ...(acknowledge ? { acknowledgeContradictions: true } : {}),
      });
    const refused = await refusal(move(false));
    expect(refused.code).toBe("failed-precondition");
    expect(refused.message).toContain("the BIDS report is invalid");
    expect(refused.message).toContain("quality control flagged it");
    expect((await move(true)).analysisReady).toBe(true);
    const [audit] = await auditOf("dataset.statusChanged", BREMEN_KEY);
    expect(JSON.stringify(audit)).toContain("overriddenContradictions");
    const history = statusHistoryDocSchema.parse(
      await dataOf(COLLECTIONS.statusHistory.docPath((await datasetOf(BREMEN_KEY)).statusHistoryId ?? "")),
    );
    expect(history.reason).toContain("Moved despite");
    // A move to a state that claims nothing needs no acknowledgement.
    await call(world.lead, setDatasetStatusContract, {
      datasetKey: BREMEN_KEY,
      fromStatusKey: "analysisReady",
      toStatusKey: "flagged",
      reason: "Synthetic.",
    });
  });
});

describe("the workflow of a dataset", () => {
  it("moves through the states the workflow allows, with history, and sets analysis readiness", async () => {
    await register(world.lead);
    const path = [
      "received",
      "integrityChecked",
      "bidsValidated",
      "qcPending",
      "qcCompleted",
      "accepted",
      "analysisReady",
    ];
    for (let index = 1; index < path.length; index += 1) {
      await call(world.coordinatorBremen, setDatasetStatusContract, {
        datasetKey: BREMEN_KEY,
        fromStatusKey: path[index - 1] ?? "",
        toStatusKey: path[index] ?? "",
        reason: "Synthetic step.",
      });
    }
    expect(await datasetOf(BREMEN_KEY)).toMatchObject({ workflowStatusKey: "analysisReady", analysisReady: true });
    const history = await adminDb
      .collection(COLLECTIONS.statusHistory.collectionPath())
      .where("entityId", "==", BREMEN_KEY)
      .get();
    expect(history.size).toBe(path.length);
    await call(world.lead, setDatasetStatusContract, {
      datasetKey: BREMEN_KEY,
      fromStatusKey: "analysisReady",
      toStatusKey: "flagged",
      reason: "A synthetic problem.",
    });
    expect((await datasetOf(BREMEN_KEY)).analysisReady).toBe(false);
  });

  it("refuses a jump, a stale state and a caller without the right", async () => {
    await register(world.lead);
    const move = (caller: Caller, fromStatusKey: string, toStatusKey: string) =>
      call(caller, setDatasetStatusContract, {
        datasetKey: BREMEN_KEY,
        fromStatusKey,
        toStatusKey,
        reason: "Synthetic.",
      });
    expect(await codeOf(move(world.lead, "received", "analysisReady"))).toBe("failed-precondition");
    expect(await codeOf(move(world.lead, "qcPending", "qcCompleted"))).toBe("failed-precondition");
    expect(await codeOf(move(world.memberBremen, "received", "integrityChecked"))).toBe("permission-denied");
  });

  it("follows a workflow the replication defines, which may not strand a dataset", async () => {
    await register(world.lead);
    const states = [
      { key: "received", label: "Received", category: "notStarted", analysisReady: false },
      { key: "checked", label: "Checked", category: "active", analysisReady: false },
      { key: "ready", label: "Ready", category: "done", analysisReady: true },
    ] as const;
    await call(world.lead, saveDatasetWorkflowContract, {
      replicationId: STUDY,
      states: [...states],
      transitions: { received: ["checked"], checked: ["ready", "received"], ready: [] },
      initialKey: "received",
    });
    await call(world.lead, setDatasetStatusContract, {
      datasetKey: BREMEN_KEY,
      fromStatusKey: "received",
      toStatusKey: "checked",
      reason: "Synthetic.",
    });
    const stranding = await refusal(
      call(world.lead, saveDatasetWorkflowContract, {
        replicationId: STUDY,
        states: [states[0], states[2]],
        transitions: { received: ["ready"] },
        initialKey: "received",
      }),
    );
    expect(stranding.code).toBe("failed-precondition");
    expect(stranding.message).toContain("checked");
    expect(
      await codeOf(
        call(world.lead, saveDatasetWorkflowContract, {
          replicationId: STUDY,
          states: [...states],
          transitions: { received: ["received"] },
          initialKey: "received",
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(world.coordinatorBremen, saveDatasetWorkflowContract, {
          replicationId: STUDY,
          states: [...states],
          transitions: { received: ["checked"], checked: ["ready"] },
          initialKey: "received",
        }),
      ),
    ).toBe("permission-denied");
  });
});

describe("transfers", () => {
  it("are requested, approved by someone else, recorded as people carry them out and verified against listings", async () => {
    const { storageRefId } = await register(world.lead);
    const from = storageRefId ?? "";
    const { storageRefId: to } = await call(world.lead, addStorageRefContract, {
      datasetKey: BREMEN_KEY,
      endpointKey: ENDPOINTS.central,
      role: "mirror",
      path: FAKE_DATASET_PATHS.alphaAttention,
      viewerSupport: [],
      note: "",
    });
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: from });
    const { transferId } = await call(world.lead, requestTransferContract, {
      datasetKey: BREMEN_KEY,
      fromRefId: from,
      toRefId: to,
      reason: "A synthetic mirror for analysis.",
    });
    const advance = (caller: Caller, action: CallableInput<typeof advanceTransferContract>["action"]) =>
      call(caller, advanceTransferContract, {
        datasetKey: BREMEN_KEY,
        transferId,
        action,
        note: "",
        bytesTransferred: null,
      });
    expect(await codeOf(advance(world.lead, "approve"))).toBe("failed-precondition");
    expect(await codeOf(advance(world.lead, "start"))).toBe("failed-precondition");
    expect(await codeOf(advance(world.memberBremen, "approve"))).toBe("permission-denied");
    await advance(world.coordinatorBremen, "approve");
    await advance(world.lead, "start");
    await advance(world.lead, "complete");
    expect(await codeOf(advance(world.lead, "verify"))).toBe("failed-precondition");
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: to });
    expect(await advance(world.lead, "verify")).toEqual({ status: "verified", approval: "approved" });
    const transfer = datasetTransferDocSchema.parse(
      await dataOf(COLLECTIONS.datasetTransfers.docPath(BREMEN_KEY, transferId)),
    );
    expect(transfer).toMatchObject({
      initiatedBy: world.lead.uid,
      decidedBy: world.coordinatorBremen.uid,
      status: "verified",
    });
    expect(await auditOf("transfer.advanced", BREMEN_KEY)).toHaveLength(4);
    expect(await auditOf("transfer.requested", BREMEN_KEY)).toHaveLength(1);
  });

  it("can be refused, which ends it", async () => {
    const { storageRefId } = await register(world.lead);
    const { storageRefId: to } = await call(world.lead, addStorageRefContract, {
      datasetKey: BREMEN_KEY,
      endpointKey: ENDPOINTS.central,
      role: "backup",
      path: `${STUDY_FOLDER}/elsewhere`,
      viewerSupport: [],
      note: "",
    });
    const { transferId } = await call(world.lead, requestTransferContract, {
      datasetKey: BREMEN_KEY,
      fromRefId: storageRefId ?? "",
      toRefId: to,
      reason: "Synthetic.",
    });
    await call(world.admin, advanceTransferContract, {
      datasetKey: BREMEN_KEY,
      transferId,
      action: "refuse",
      note: "Not approved by the institution.",
      bytesTransferred: null,
    });
    expect(
      await codeOf(
        call(world.lead, advanceTransferContract, {
          datasetKey: BREMEN_KEY,
          transferId,
          action: "start",
          note: "",
          bytesTransferred: null,
        }),
      ),
    ).toBe("failed-precondition");
  });
});

describe("copies of a dataset", () => {
  it("records a relocation as history: the old copy closed and the new one naming it", async () => {
    const { storageRefId } = await register(world.lead);
    const { storageRefId: moved } = await call(world.lead, changeStorageRefContract, {
      action: "relocate",
      datasetKey: BREMEN_KEY,
      storageRefId: storageRefId ?? "",
      endpointKey: ENDPOINTS.munich,
      path: `${STUDY_FOLDER}/relocated/flanker`,
      reason: "The Bremen server is being replaced.",
    });
    expect((await refOf(BREMEN_KEY, storageRefId ?? "")).validTo).not.toBeNull();
    expect(await refOf(BREMEN_KEY, moved)).toMatchObject({
      relocatedFromRefId: storageRefId,
      endpointKey: ENDPOINTS.munich,
    });
    expect(
      await codeOf(
        call(world.lead, changeStorageRefContract, {
          action: "retire",
          datasetKey: BREMEN_KEY,
          storageRefId: storageRefId ?? "",
          reason: "Synthetic.",
        }),
      ),
    ).toBe("failed-precondition");
    const [audit] = await auditOf("storageRef.changed", BREMEN_KEY);
    expect(JSON.stringify(audit)).not.toContain("relocated/flanker");
  });

  it("offers a viewer link only where a copy declares support, and nothing else needs it", async () => {
    const { storageRefId } = await register(world.lead);
    const refId = storageRefId ?? "";
    const link = {
      datasetKey: BREMEN_KEY,
      storageRefId: refId,
      tool: "electroTag",
      url: "https://viewer.example.org/synthetic",
    } as const;
    expect(await codeOf(call(world.lead, saveViewerLinkContract, link))).toBe("failed-precondition");
    await call(world.lead, changeStorageRefContract, {
      action: "update",
      datasetKey: BREMEN_KEY,
      storageRefId: refId,
      role: "primary",
      viewerSupport: ["electroTag"],
      note: "",
    });
    await call(world.lead, saveViewerLinkContract, link);
    expect((await refOf(BREMEN_KEY, refId)).viewerLinkTools).toEqual(["electroTag"]);
    expect(
      await call(world.coordinatorBremen, openViewerLinkContract, {
        datasetKey: BREMEN_KEY,
        storageRefId: refId,
        tool: "electroTag",
      }),
    ).toEqual({
      url: "https://viewer.example.org/synthetic",
    });
    expect(
      await codeOf(
        call(world.memberBremen, openViewerLinkContract, {
          datasetKey: BREMEN_KEY,
          storageRefId: refId,
          tool: "electroTag",
        }),
      ),
    ).toBe("permission-denied");
    const events = await adminDb
      .collection(COLLECTIONS.datasetAccessEvents.collectionPath(BREMEN_KEY))
      .where("action", "==", "requestViewerLink")
      .get();
    expect(events.size).toBe(1);
  });
});

describe("BIDS and quality control", () => {
  it("imports a bids-validator report: counts on the registry document, the report in the restricted detail", async () => {
    await register(world.lead);
    const report = {
      issues: {
        errors: [
          {
            key: "EEG_SAMPLING_FREQUENCY_MISSING",
            reason: "Synthetic.",
            files: [{ file: { relativePath: "/sub-01/eeg/sub-01_task-flanker_eeg.json" } }],
          },
        ],
        warnings: [],
      },
      summary: {
        subjects: ["01", "02", "03"],
        sessions: [],
        tasks: ["flanker"],
        modalities: ["EEG"],
        totalFiles: 12,
        size: 1,
      },
    };
    const result = await call(world.lead, importBidsReportContract, {
      datasetKey: BREMEN_KEY,
      report: JSON.stringify(report),
      validatorVersion: "1.14.0",
    });
    expect(result).toEqual({ bidsStatus: "invalid", errorCount: 1, warningCount: 0, missingMetadataCount: 1 });
    const dataset = await datasetOf(BREMEN_KEY);
    expect(dataset.bidsSummary).toMatchObject({ errorCount: 1, validatorVersion: "1.14.0", missingMetadataCount: 1 });
    expect(JSON.stringify(dataset)).not.toContain("sub-01");
    const detail = datasetDetailDocSchema.parse(await dataOf(COLLECTIONS.datasetDetail.docPath(BREMEN_KEY)));
    expect(detail.bidsMissingMetadata).toEqual([
      "EEG_SAMPLING_FREQUENCY_MISSING: /sub-01/eeg/sub-01_task-flanker_eeg.json",
    ]);
    expect(
      await codeOf(
        call(world.lead, importBidsReportContract, { datasetKey: BREMEN_KEY, report: "{}", validatorVersion: "1" }),
      ),
    ).toBe("invalid-argument");
    await call(world.lead, updateDatasetContract, {
      datasetKey: BREMEN_KEY,
      bidsConversionStatus: "completed",
      bidsVersion: "1.9.0",
      bidsNamingMap: [{ source: "VP01_flanker.vhdr", bids: "sub-01_task-flanker_eeg.vhdr" }],
    });
    expect(await datasetOf(BREMEN_KEY)).toMatchObject({ bidsConversionStatus: "completed", bidsVersion: "1.9.0" });
    const [audit] = await auditOf("dataset.updated", BREMEN_KEY);
    expect(JSON.stringify(audit)).not.toContain("VP01");
  });

  it("records assessments that never change, with exclusions linked to recruitment reasons, and sets the QC status", async () => {
    await register(world.lead);
    const assessment: CallableInput<typeof recordQcAssessmentContract> = {
      datasetKey: BREMEN_KEY,
      level: "recording",
      recordingLabel: "sub-02",
      tool: "Synthetic pipeline",
      toolVersion: "0.1",
      pipelineVersion: "2026.1",
      parameters: { highPassHz: 0.1 },
      metrics: { badChannels: 3 },
      outcome: "fail",
      exclusions: [{ recordingLabel: "sub-02", reasonTermId: REASON }],
      deviationIds: [],
      notes: "",
      supersedesAssessmentId: null,
    };
    await call(world.coordinatorBremen, recordQcAssessmentContract, assessment);
    expect((await datasetOf(BREMEN_KEY)).qcStatus).toBe("notStarted");
    const { qcStatus } = await call(world.lead, recordQcAssessmentContract, {
      ...assessment,
      level: "dataset",
      recordingLabel: null,
      outcome: "pass",
      exclusions: [],
    });
    expect(qcStatus).toBe("passed");
    expect((await datasetOf(BREMEN_KEY)).qcStatus).toBe("passed");
    expect(
      await codeOf(
        call(world.lead, recordQcAssessmentContract, {
          ...assessment,
          exclusions: [{ recordingLabel: "sub-01", reasonTermId: "no-such-reason" }],
        }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(world.lead, recordQcAssessmentContract, { ...assessment, deviationIds: ["no-such-deviation"] }),
      ),
    ).toBe("invalid-argument");
    expect(await codeOf(call(world.memberBremen, recordQcAssessmentContract, assessment))).toBe("permission-denied");
  });
});

describe("the quality-control task", () => {
  it("moves on with the assessments of the dataset as a whole, with an entry in its history", async () => {
    const { storageRefId } = await register(world.lead);
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: storageRefId ?? "" });
    const taskPath = COLLECTIONS.tasks.docPath(datasetQcTaskId(BREMEN_KEY));
    expect(taskDocSchema.parse(await dataOf(taskPath)).statusKey).toBe("toDo");
    const assessment: CallableInput<typeof recordQcAssessmentContract> = {
      datasetKey: BREMEN_KEY,
      level: "dataset",
      recordingLabel: null,
      tool: null,
      toolVersion: null,
      pipelineVersion: null,
      parameters: {},
      metrics: {},
      outcome: "flag",
      exclusions: [],
      deviationIds: [],
      notes: "",
      supersedesAssessmentId: null,
    };
    await call(world.lead, recordQcAssessmentContract, assessment);
    expect(taskDocSchema.parse(await dataOf(taskPath)).statusKey).toBe("inProgress");
    await call(world.lead, recordQcAssessmentContract, { ...assessment, outcome: "pass" });
    const done = taskDocSchema.parse(await dataOf(taskPath));
    expect(done.statusKey).toBe("done");
    expect(done.completedAt).not.toBeNull();
    const entries = await adminDb
      .collection(COLLECTIONS.activity.collectionPath())
      .where("entityId", "==", datasetQcTaskId(BREMEN_KEY))
      .where("action", "==", "qcAssessment.recorded")
      .get();
    expect(entries.size).toBe(2);
  });
});

describe("storage servers", () => {
  it("are registered by administrators, keep their connection where no client reads it, and never record a secret's value", async () => {
    const input: CallableInput<typeof saveStorageEndpointContract> = {
      key: "munich-backup",
      name: "Synthetic Munich backup server",
      institutionId: null,
      ownerPersonId: null,
      protocol: "ftps",
      scanMode: "remote",
      description: "A synthetic backup server.",
      retired: false,
      connection: {
        host: "backup.munich.example.org",
        port: 990,
        basePath: "backup",
        credentialRef: "STORAGE_MUNICH_BACKUP",
      },
    };
    expect(await codeOf(call(world.lead, saveStorageEndpointContract, input))).toBe("permission-denied");
    // The core team does not hold the sensitive capability that names a secret.
    expect(await codeOf(call(world.core, saveStorageEndpointContract, input))).toBe("permission-denied");
    const { connection, ...rest } = input;
    const { credentialRef: _secret, ...withoutSecret } = connection;
    expect(await call(world.core, saveStorageEndpointContract, { ...rest, connection: withoutSecret })).toEqual({
      key: "munich-backup",
      created: true,
    });
    await call(world.admin, saveStorageEndpointContract, input);
    const stored = await endpointOf("munich-backup");
    expect(JSON.stringify(stored)).not.toContain("backup.munich.example.org");
    expect(await call(world.admin, getStorageEndpointConnectionContract, { key: "munich-backup" })).toEqual({
      host: "backup.munich.example.org",
      port: 990,
      basePath: "backup",
      credentialRef: "STORAGE_MUNICH_BACKUP",
      allowedPrefixes: {},
    });
    const audits = await auditOf("storageEndpoint.saved", "munich-backup");
    expect(JSON.stringify(audits)).not.toContain("backup.munich.example.org");
    expect(await auditOf("storageEndpoint.connectionViewed", "munich-backup")).toHaveLength(1);
  });
});

describe("where a copy may be named", () => {
  it("lies in the folder of the caller's laboratory or replication, unless the caller manages datasets for the programme", async () => {
    // The Bremen coordinator's folder on the Bremen server is the attention dataset alone.
    expect(
      await codeOf(
        register(world.coordinatorBremen, {
          storage: { endpointKey: ENDPOINTS.bremen, role: "primary", path: STUDY_FOLDER, viewerSupport: [] },
        }),
      ),
    ).toBe("permission-denied");
    // The Munich server names no folder for the Bremen laboratory.
    expect(
      await codeOf(
        register(world.coordinatorBremen, {
          storage: {
            endpointKey: ENDPOINTS.munich,
            role: "primary",
            path: FAKE_DATASET_PATHS.alphaSignal,
            viewerSupport: [],
          },
        }),
      ),
    ).toBe("permission-denied");
    // A path that only begins with the folder's name is outside it.
    expect(
      await codeOf(
        register(world.lead, {
          storage: {
            endpointKey: ENDPOINTS.bremen,
            role: "primary",
            path: `${STUDY_FOLDER}-other/x`,
            viewerSupport: [],
          },
        }),
      ),
    ).toBe("permission-denied");
    const { storageRefId } = await register(world.coordinatorBremen, {
      storage: {
        endpointKey: ENDPOINTS.bremen,
        role: "primary",
        path: `${FAKE_DATASET_PATHS.alphaAttention}/`,
        viewerSupport: [],
      },
    });
    // The path is stored in normal form.
    const location = await dataOf(COLLECTIONS.datasetStorageRefLocation.docPath(BREMEN_KEY, storageRefId ?? ""));
    expect(location?.uri).toBe(FAKE_DATASET_PATHS.alphaAttention);
    // An administrator names any folder below the base path.
    await call(world.admin, registerDatasetContract, {
      ...registration({ datasetKey: "DataStudy2001-elsewhere" }),
      storage: { endpointKey: ENDPOINTS.bremen, role: "primary", path: "archive/flanker", viewerSupport: [] },
    });
  });

  it("refuses a folder that holds, or lies in, another dataset's copy, and a second copy of one dataset in one folder", async () => {
    await register(world.lead);
    for (const path of [
      STUDY_FOLDER,
      FAKE_DATASET_PATHS.alphaAttention,
      `${FAKE_DATASET_PATHS.alphaAttention}/sub-01`,
    ]) {
      expect(
        await codeOf(
          register(world.admin, {
            datasetKey: MUNICH_KEY,
            storage: { endpointKey: ENDPOINTS.bremen, role: "primary", path, viewerSupport: [] },
          }),
        ),
        path,
      ).toBe("failed-precondition");
    }
    expect(
      await codeOf(
        call(world.lead, addStorageRefContract, {
          datasetKey: BREMEN_KEY,
          endpointKey: ENDPOINTS.bremen,
          role: "mirror",
          path: `${FAKE_DATASET_PATHS.alphaAttention}//`,
          viewerSupport: [],
          note: "",
        }),
      ),
    ).toBe("failed-precondition");
    // A sibling folder is free.
    await register(world.lead, {
      datasetKey: MUNICH_KEY,
      storage: {
        endpointKey: ENDPOINTS.bremen,
        role: "primary",
        path: `${STUDY_FOLDER}/signal-main`,
        viewerSupport: [],
      },
    });
  });

  it("refuses a transfer between two copies in the same folder of the same server", async () => {
    const { storageRefId } = await register(world.lead);
    // A copy recorded before paths were checked, in the same folder as the primary copy.
    const copy = adminDb.collection(COLLECTIONS.datasetStorageRefs.collectionPath(BREMEN_KEY)).doc("legacy-copy");
    const primary = (
      await adminDb.doc(COLLECTIONS.datasetStorageRefs.docPath(BREMEN_KEY, storageRefId ?? "")).get()
    ).data();
    await copy.set({ ...primary, role: "mirror" });
    await adminDb.doc(COLLECTIONS.datasetStorageRefLocation.docPath(BREMEN_KEY, "legacy-copy")).set({
      ...(await dataOf(COLLECTIONS.datasetStorageRefLocation.docPath(BREMEN_KEY, storageRefId ?? ""))),
      uri: `./${FAKE_DATASET_PATHS.alphaAttention}/`,
    });
    expect(
      await codeOf(
        call(world.lead, requestTransferContract, {
          datasetKey: BREMEN_KEY,
          fromRefId: storageRefId ?? "",
          toRefId: "legacy-copy",
          reason: "Synthetic.",
        }),
      ),
    ).toBe("failed-precondition");
  });

  it("refuses a path that a scan would send to the server as more than one command", async () => {
    expect(
      await codeOf(
        register(world.lead, {
          storage: {
            endpointKey: ENDPOINTS.bremen,
            role: "primary",
            path: `${STUDY_FOLDER}\n!true`,
            viewerSupport: [],
          },
        }),
      ),
    ).toBe("invalid-argument");
  });
});

describe("the connection of a server", () => {
  const munich = (connection: CallableInput<typeof saveStorageEndpointContract>["connection"]) => ({
    key: ENDPOINTS.munich,
    name: "Synthetic Munich EEG server",
    institutionId: null,
    ownerPersonId: null,
    protocol: "ftps" as const,
    scanMode: "remote" as const,
    description: "",
    retired: false,
    connection,
  });
  const secret = `STORAGE_${ENDPOINTS.munich.toUpperCase().replace(/-/g, "_")}`;

  it("moves a server that names a secret only for a holder of the sensitive capability", async () => {
    for (const connection of [
      { host: FAKE_SERVERS.munich, credentialRef: secret },
      { host: FAKE_SERVERS.munich, port: 2121, basePath: FAKE_BASE_PATHS.munich, credentialRef: secret },
      { host: FAKE_SERVERS.munich, basePath: "projects", credentialRef: secret },
    ]) {
      expect(await codeOf(call(world.core, saveStorageEndpointContract, munich(connection)))).toBe("permission-denied");
    }
    expect(
      await codeOf(
        call(world.core, saveStorageEndpointContract, {
          ...munich({ host: FAKE_SERVERS.munich, basePath: FAKE_BASE_PATHS.munich, credentialRef: secret }),
          protocol: "sftp",
        }),
      ),
    ).toBe("permission-denied");
    // The core team still changes what does not move the secret: the folders of the units.
    await call(
      world.core,
      saveStorageEndpointContract,
      munich({
        host: FAKE_SERVERS.munich,
        basePath: FAKE_BASE_PATHS.munich,
        credentialRef: secret,
        allowedPrefixes: { [`lab:${LAB_BREMEN}`]: `${STUDY_FOLDER}/bremen` },
      }),
    );
    expect(await call(world.admin, getStorageEndpointConnectionContract, { key: ENDPOINTS.munich })).toMatchObject({
      allowedPrefixes: { [`lab:${LAB_BREMEN}`]: `${STUDY_FOLDER}/bremen` },
    });
    // An administrator moves it.
    await call(
      world.admin,
      saveStorageEndpointContract,
      munich({ host: "ftps2.munich.example.org", basePath: FAKE_BASE_PATHS.munich, credentialRef: secret }),
    );
  });

  it("names only a storage secret, never another setting of the functions", async () => {
    expect(
      await codeOf(
        call(
          world.admin,
          saveStorageEndpointContract,
          munich({ host: FAKE_SERVERS.munich, credentialRef: "GOOGLE_WORKSPACE_SERVICE_ACCOUNT" }),
        ),
      ),
    ).toBe("invalid-argument");
  });
});

describe("links to datasets", () => {
  it("resolve from tasks now that the registry exists: a registered dataset may be linked, an unknown key may not", async () => {
    await register(world.lead);
    const { listId } = await call(world.lead, createTaskListContract, {
      name: "Synthetic data plan",
      kind: "project",
      scopeType: "replication",
      scopeId: STUDY,
    });
    const { taskId } = await call(world.lead, createTaskContract, {
      listId,
      parentId: null,
      fields: { title: "Check the Bremen dataset", links: [{ entityType: "dataset", entityId: BREMEN_KEY }] },
    });
    expect(taskDocSchema.parse(await dataOf(COLLECTIONS.tasks.docPath(taskId))).links).toEqual([
      { entityType: "dataset", entityId: BREMEN_KEY },
    ]);
    expect(
      await codeOf(
        call(world.lead, createTaskContract, {
          listId,
          parentId: null,
          fields: { title: "Check an unknown dataset", links: [{ entityType: "dataset", entityId: MUNICH_KEY }] },
        }),
      ),
    ).toBe("invalid-argument");
  });
});
