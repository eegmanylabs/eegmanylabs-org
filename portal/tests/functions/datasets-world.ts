// The world of the tests of the dataset registry: one replication with two laboratories and their
// participations, storage servers that match the servers of the storage fake, the statuses of
// tasks, one exclusion reason and an account for each kind of caller.
// Fixtures are synthetic: fictitious accounts, laboratories and servers on the example.org domain.
import {
  COLLECTIONS,
  EXCLUSION_REASON_TERM_KIND,
  participationId,
  statusDefinitionId,
  TASK_STATUSES,
  unitScopeKeys,
  vocabularyTermId,
} from "@eegml/shared";
import { resetFakeState } from "../../functions/src/integrations/google/fake/store";
import {
  emulatorStorageFake,
  type StorageFake,
  storageFakeStatePath,
} from "../../functions/src/integrations/storage/fake";
import { FAKE_BASE_PATHS, FAKE_DATASET_PATHS, FAKE_SERVERS } from "../../functions/src/integrations/storage/fixtures";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  type Caller,
  coreTeamMember,
  grantRole,
  laboratory,
  replication,
  standard,
} from "./support";

export const STUDY = "DataStudy2001";
export const OTHER_STUDY = "DataStudy2002";
export const LAB_BREMEN = "lab-data-bremen";
export const LAB_MUNICH = "lab-data-munich";
/** The folder of the replication on every server, which the paths of the storage fake begin with. */
export const STUDY_FOLDER = "DemoAlpha2001";
export const REASON = vocabularyTermId(EXCLUSION_REASON_TERM_KIND, "Excessive artefacts in the EEG recording");

/** The endpoint keys of the world, one for each server of the fake. */
export const ENDPOINTS = {
  bremen: "bremen-sftp",
  munich: "munich-ftps",
  central: "central-objects",
  institutional: "northfield-nas",
} as const;

export interface DatasetWorld {
  readonly lead: Caller;
  readonly otherLead: Caller;
  readonly coordinatorBremen: Caller;
  readonly coordinatorMunich: Caller;
  readonly memberBremen: Caller;
  readonly member: Caller;
  readonly admin: Caller;
  readonly core: Caller;
}

/** The fake of the run, with its servers as the fixtures give them. */
export function freshStorageFake(): StorageFake {
  resetFakeState(storageFakeStatePath());
  return emulatorStorageFake();
}

async function endpoint(
  key: string,
  name: string,
  protocol: string,
  host: string,
  basePath: string,
  allowedPrefixes: Readonly<Record<string, string>>,
  scanMode: "remote" | "uploadedManifest" = "remote",
): Promise<void> {
  await adminDb.doc(COLLECTIONS.storageEndpoints.docPath(key)).set({
    ...standard(),
    key,
    name,
    protocol,
    scanMode,
    status: "active",
    lastCheckedAt: null,
    lastSeenAt: null,
    scopeKeys: [],
  });
  await adminDb.doc(COLLECTIONS.storageEndpointConnection.docPath(key)).set({
    ...standard(),
    host,
    basePath,
    credentialRef: `STORAGE_${key.toUpperCase().replace(/-/g, "_")}`,
    allowedPrefixes,
  });
}

export async function datasetWorld(): Promise<DatasetWorld> {
  await Promise.all([replication(STUDY), replication(OTHER_STUDY), laboratory(LAB_BREMEN), laboratory(LAB_MUNICH)]);
  for (const lab of [LAB_BREMEN, LAB_MUNICH]) {
    await adminDb.doc(COLLECTIONS.participations.docPath(participationId(STUDY, lab))).set({
      ...standard(),
      replicationId: STUDY,
      laboratoryId: lab,
      scopeKeys: unitScopeKeys(STUDY, lab),
      status: "collecting",
      statusHistoryId: null,
      readinessStatus: "approved",
      custom: {},
      dataOrigin: "demo",
    });
  }
  // Each server has a folder for the replication, and the laboratory servers one for their laboratory.
  const replicationFolder = { [`rep:${STUDY}`]: STUDY_FOLDER };
  await endpoint(ENDPOINTS.bremen, "Synthetic Bremen EEG server", "sftp", FAKE_SERVERS.bremen, FAKE_BASE_PATHS.bremen, {
    ...replicationFolder,
    [`lab:${LAB_BREMEN}`]: FAKE_DATASET_PATHS.alphaAttention,
  });
  await endpoint(ENDPOINTS.munich, "Synthetic Munich EEG server", "ftps", FAKE_SERVERS.munich, FAKE_BASE_PATHS.munich, {
    ...replicationFolder,
    [`lab:${LAB_MUNICH}`]: FAKE_DATASET_PATHS.alphaSignal,
  });
  await endpoint(
    ENDPOINTS.central,
    "Synthetic central object store",
    "s3",
    FAKE_SERVERS.central,
    FAKE_BASE_PATHS.central,
    replicationFolder,
  );
  await endpoint(
    ENDPOINTS.institutional,
    "Synthetic institutional file system",
    "filesystem",
    FAKE_SERVERS.institutional,
    FAKE_BASE_PATHS.institutional,
    replicationFolder,
    "uploadedManifest",
  );
  for (const [position, status] of TASK_STATUSES.entries()) {
    await adminDb.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("task", status.key))).set({
      ...standard(),
      entityType: "task",
      key: status.key,
      label: status.label,
      category: status.category,
      position,
      isDefault: position === 0,
    });
  }
  await adminDb.doc(COLLECTIONS.vocabularyTerms.docPath(REASON)).set({
    ...standard(),
    sourceId: "artefacts",
    name: "Excessive artefacts in the EEG recording",
    kind: EXCLUSION_REASON_TERM_KIND,
    sameAsSource: [],
    labelsSource: ["Excessive artefacts in the EEG recording"],
    isDeprecated: false,
  });
  const lead = await account("uid-data-lead");
  await grantRole(lead.uid, "replication_lead", "replication", STUDY);
  const otherLead = await account("uid-data-other-lead");
  await grantRole(otherLead.uid, "replication_lead", "replication", OTHER_STUDY);
  const coordinatorBremen = await account("uid-data-coordinator-bremen");
  await grantRole(coordinatorBremen.uid, "lab_coordinator", "laboratory", LAB_BREMEN);
  const coordinatorMunich = await account("uid-data-coordinator-munich");
  await grantRole(coordinatorMunich.uid, "lab_coordinator", "laboratory", LAB_MUNICH);
  const memberBremen = await account("uid-data-member-bremen");
  await grantRole(memberBremen.uid, "lab_member", "laboratory", LAB_BREMEN);
  const member = await account("uid-data-member");
  await grantRole(member.uid, "lab_member", "laboratory", LAB_MUNICH);
  const admin = await administrator("uid-data-admin");
  const core = await coreTeamMember("uid-data-core");
  return { lead, otherLead, coordinatorBremen, coordinatorMunich, memberBremen, member, admin, core };
}
