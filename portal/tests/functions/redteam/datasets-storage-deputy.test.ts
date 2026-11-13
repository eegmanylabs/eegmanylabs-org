// Red team, dataset registry: the scanning account of a storage server as a confused deputy, and
// a transfer recorded as verified when nothing moved. The account of a server reads every path
// below the server's base path, and the path of a copy is whatever its registrant types. Each
// test states the secure behaviour and is written as the attack a laboratory coordinator or a
// lead could make through the callable functions.
// Fixtures are synthetic: fictitious accounts, laboratories, servers and files on the example.org domain.
import {
  addStorageRefContract,
  advanceTransferContract,
  type CallableInput,
  COLLECTIONS,
  datasetManifestFileChunkDocSchema,
  registerDatasetContract,
  requestTransferContract,
  saveStorageEndpointContract,
  scanStorageRefContract,
} from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { FAKE_BASE_PATHS, FAKE_DATASET_PATHS } from "../../../functions/src/integrations/storage/fixtures";
import { remotePath } from "../../../functions/src/integrations/storage/real/credentials";
import { adminDb } from "../../support/admin";
import {
  type DatasetWorld,
  datasetWorld,
  ENDPOINTS,
  freshStorageFake,
  LAB_BREMEN,
  LAB_MUNICH,
  STUDY,
} from "../datasets-world";
import { type Caller, call, codeOf, resetWorld, withoutTriggers } from "../support";

const BREMEN_KEY = "DataStudy2001-redteam-bremen";
const MUNICH_KEY = "DataStudy2001-redteam-munich";

let world: DatasetWorld;

withoutTriggers();
beforeEach(async () => {
  await resetWorld();
  freshStorageFake();
  world = await datasetWorld();
});

type Registration = CallableInput<typeof registerDatasetContract>;

function registration(key: string, laboratoryId: string, endpointKey: string, path: string): Registration {
  return {
    datasetKey: key,
    replicationId: STUDY,
    laboratoryId,
    title: "Synthetic red-team dataset",
    modality: "main",
    groupingLabel: "Session 1",
    sourceInstitutionId: null,
    storageOwnerPersonId: null,
    protocolId: null,
    expectedFileCount: null,
    expectedParticipants: 3,
    metadata: {},
    storage: { endpointKey, role: "primary", path, viewerSupport: [] },
  };
}

/** Every relative path that the stored listings of a laboratory's datasets name. */
async function listedPathsOf(laboratoryId: string): Promise<string[]> {
  const chunks = await adminDb.collectionGroup("fileChunks").where("laboratoryId", "==", laboratoryId).get();
  return chunks.docs.flatMap((document) => {
    const parsed = datasetManifestFileChunkDocSchema.safeParse(document.data());
    return parsed.success ? parsed.data.files.map((file) => file.relativePath) : [];
  });
}

async function attemptScan(caller: Caller, datasetKey: string, storageRefId: string | null): Promise<void> {
  if (storageRefId === null) return;
  await call(caller, scanStorageRefContract, { datasetKey, storageRefId }).catch(() => null);
}

describe("storage paths", () => {
  it("never let a coordinator of one laboratory list another laboratory's copy through a path of their own", async () => {
    // The Munich coordinator holds datasets.manage and datasets.paths.read for Munich alone, and
    // types the path where Bremen keeps its recordings on the shared Bremen server.
    const registered = await call(
      world.coordinatorMunich,
      registerDatasetContract,
      registration(MUNICH_KEY, LAB_MUNICH, ENDPOINTS.bremen, FAKE_DATASET_PATHS.alphaAttention),
    ).catch(() => null);
    await attemptScan(world.coordinatorMunich, MUNICH_KEY, registered?.storageRefId ?? null);
    const leaked = (await listedPathsOf(LAB_MUNICH)).filter((path) => path.startsWith("sub-"));
    expect(leaked).toEqual([]);
  });

  it("never let a coordinator list the whole server below its base path", async () => {
    const registered = await call(
      world.coordinatorMunich,
      registerDatasetContract,
      registration(MUNICH_KEY, LAB_MUNICH, ENDPOINTS.bremen, "."),
    ).catch(() => null);
    await attemptScan(world.coordinatorMunich, MUNICH_KEY, registered?.storageRefId ?? null);
    expect(await listedPathsOf(LAB_MUNICH)).toEqual([]);
  });

  it("refuse a path that carries a line break, which the SFTP adapter would send as a second batch command", () => {
    const input = registration(MUNICH_KEY, LAB_MUNICH, ENDPOINTS.bremen, "DemoAlpha2001\n!true");
    const accepted = registerDatasetContract.input.safeParse(input).success;
    // The path reaches `sftp -b -` as `ls -ln "<path>"`, and quoting escapes quotes and
    // backslashes only: a line break starts a new command, and `!` runs a local shell command.
    // The adapter may refuse the path outright, which sends no command at all.
    const line = (() => {
      try {
        return remotePath({
          protocol: "sftp",
          host: "sftp.bremen.example.org",
          port: null,
          basePath: "eeg",
          path: input.storage?.path ?? "",
          credentialRef: null,
        });
      } catch {
        return "(refused by the adapter)";
      }
    })();
    expect({ accepted, lineBreakInCommand: line.includes("\n") }).toEqual({
      accepted: false,
      lineBreakInCommand: false,
    });
  });
});

describe("transfers", () => {
  it("never record a transfer as verified when its destination is the source itself", async () => {
    const { storageRefId: from } = await call(
      world.lead,
      registerDatasetContract,
      registration(BREMEN_KEY, LAB_BREMEN, ENDPOINTS.bremen, FAKE_DATASET_PATHS.alphaAttention),
    );
    // A second copy that names the same server and the same path: no data can have moved.
    // The portal may refuse at any step; what it must never do is record the transfer as verified.
    const added = await call(world.lead, addStorageRefContract, {
      datasetKey: BREMEN_KEY,
      endpointKey: ENDPOINTS.bremen,
      role: "mirror",
      path: `${FAKE_DATASET_PATHS.alphaAttention}/`,
      viewerSupport: [],
      note: "",
    }).catch(() => null);
    const to = added?.storageRefId ?? null;
    await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: from ?? "" });
    const requested =
      to === null
        ? null
        : await call(world.lead, requestTransferContract, {
            datasetKey: BREMEN_KEY,
            fromRefId: from ?? "",
            toRefId: to,
            reason: "A synthetic mirror.",
          }).catch(() => null);
    if (to !== null && requested !== null) {
      const advance = (caller: Caller, action: CallableInput<typeof advanceTransferContract>["action"]) =>
        call(caller, advanceTransferContract, {
          datasetKey: BREMEN_KEY,
          transferId: requested.transferId,
          action,
          note: "",
          bytesTransferred: null,
        }).catch(() => null);
      await advance(world.coordinatorBremen, "approve");
      await advance(world.lead, "start");
      await advance(world.lead, "complete");
      await call(world.lead, scanStorageRefContract, { datasetKey: BREMEN_KEY, storageRefId: to });
      const verified = await advance(world.lead, "verify");
      expect(verified?.status ?? "refused").not.toBe("verified");
    }
    const transfers = await adminDb.collection(COLLECTIONS.datasetTransfers.collectionPath(BREMEN_KEY)).get();
    expect(transfers.docs.map((transfer) => transfer.get("status"))).not.toContain("verified");
  });
});

describe("storage servers", () => {
  it("never let a holder of datasets.manage without integrations.credentials send a server's secret to another host", async () => {
    // The core team holds datasets.manage for the programme and not the sensitive capability
    // that names a secret. Keeping the name of the Munich secret while moving the host would
    // make the next scan or the nightly sweep log in to a host the caller chose, with the
    // Munich account's user name and password (FTPS sends both in USER and PASS).
    const moved = await codeOf(
      call(world.core, saveStorageEndpointContract, {
        key: ENDPOINTS.munich,
        name: "Synthetic Munich EEG server",
        institutionId: null,
        ownerPersonId: null,
        protocol: "ftps",
        scanMode: "remote",
        description: "",
        retired: false,
        connection: {
          host: "collector.example.org",
          basePath: FAKE_BASE_PATHS.munich,
          credentialRef: "STORAGE_MUNICH_FTPS",
        },
      }),
    );
    expect(moved).toBe("permission-denied");
  });
});
