// Shared ground of the red-team tests on integrity and audit: the five attackers, the records
// they attack and the requests a malicious browser client can make with its own session.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { laboratoryScopeKey, replicationScopeKey, unitScopeKeys } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, type Firestore, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { assertGeneratedIdentifier } from "../requests";
import { seedWorld, storedDocument, trusted } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  actingUid,
  CALLERS,
  type CallerKind,
  createdBy,
  firestoreOf,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  STORED_AT,
  stored,
  uidOfCaller,
  updatedBy,
} from "../world";

/**
 * The attackers. Each is an approved member with a session of its own.
 *
 * | Attacker         | Standing                                   |
 * |------------------|--------------------------------------------|
 * | `member`         | An ordinary member with no role            |
 * | `ownLabMember`   | A member of laboratory A                   |
 * | `ownCoordinator` | A coordinator of laboratory A              |
 * | `ownLead`        | A lead of replication X                    |
 * | `coreTeam`       | The core team, signed in with a second factor |
 */
export const ATTACKERS = ["member", "ownLabMember", "ownCoordinator", "ownLead", "coreTeam"] as const;
export type Attacker = (typeof ATTACKERS)[number];

export const LEAD_UID = uidOfCaller("ownLead");
export const COORDINATOR_UID = uidOfCaller("ownCoordinator");
export const ADMIN_UID = uidOfCaller("admin");

export const REPLICATION = `replications/${OWN_REPLICATION}`;
export const LABORATORY = `laboratories/${OWN_LABORATORY}`;
export const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;

/** Records beside those of the world, which the attacks below need. */
export const REVIEWED_HYPOTHESIS = `${REPLICATION}/hypotheses/h03`;
export const APPROVED_VERSION = `${REPLICATION}/protocolVersions/version-approved`;
export const SECOND_PROTOCOL = `${REPLICATION}/protocols/protocol-2`;
export const SECOND_PROTOCOL_VERSION = `${REPLICATION}/protocolVersions/version-of-protocol-2`;
export const COMPLETED_ITEM = `${PARTICIPATION}/checklist/training`;
export const LEAD_DEVIATION = `${PARTICIPATION}/deviations/deviation-by-lead`;
export const OTHER_TABLE = "contributorTables/table-of-other-replication";
export const OTHER_MANUSCRIPT = "manuscripts/manuscript-of-other-replication";
export const IMPORTED_LABORATORY = "laboratories/lab-synthetic-imported";

const UNIT = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
};

const signedBy = (uid: string): Record<string, unknown> => ({ ...stored(), createdBy: uid, updatedBy: uid });

/** What trusted code stored before the attacker arrived. */
export const RED_TEAM_DOCUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  // A hypothesis whose result a programme administrator reviewed and signed.
  [REVIEWED_HYPOTHESIS]: {
    ...signedBy(ADMIN_UID),
    replicationId: OWN_REPLICATION,
    hypothesisNumber: "3",
    text: "A third synthetic effect is present.",
    scientificReviewStatus: "verified",
    analysisStatus: "completed",
    resultSummary: "The synthetic effect did not replicate.",
    resultReviewedBy: ADMIN_UID,
    resultReviewedAt: STORED_AT,
  },
  // A protocol version that a programme administrator approved.
  [APPROVED_VERSION]: {
    ...signedBy(ADMIN_UID),
    replicationId: OWN_REPLICATION,
    protocolId: "protocol-1",
    versionLabel: "2.0",
    status: "approved",
    documentLinkId: "link-1",
    approvedBy: ADMIN_UID,
    approvedAt: STORED_AT,
  },
  [SECOND_PROTOCOL]: {
    ...stored(),
    replicationId: OWN_REPLICATION,
    title: "Second synthetic protocol",
    currentVersionId: "version-of-protocol-2",
  },
  [SECOND_PROTOCOL_VERSION]: {
    ...stored(),
    replicationId: OWN_REPLICATION,
    protocolId: "protocol-2",
    versionLabel: "1.0",
    status: "draft",
    approvedBy: null,
    approvedAt: null,
  },
  // A checklist item that the coordinator completed, with the evidence the coordinator gave.
  [COMPLETED_ITEM]: {
    ...signedBy(COORDINATOR_UID),
    participationId: OWN_PARTICIPATION,
    templateKey: "onboarding",
    templateItemKey: "training",
    label: "Training",
    status: "done",
    completedBy: COORDINATOR_UID,
    completedAt: STORED_AT,
    evidenceUrl: "https://example.org/training-certificate",
    position: 6,
    ...UNIT,
  },
  // A deviation that the lead of the replication reported against the laboratory.
  [LEAD_DEVIATION]: {
    ...signedBy(LEAD_UID),
    participationId: OWN_PARTICIPATION,
    description: "Twelve sessions were recorded with the wrong reference electrode.",
    severity: "critical",
    occurredAt: STORED_AT,
    reportedBy: LEAD_UID,
    status: "open",
    ...UNIT,
  },
  [OTHER_TABLE]: {
    ...stored(),
    replicationId: OTHER_REPLICATION,
    sourceKey: "F",
    scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
  },
  [OTHER_MANUSCRIPT]: {
    ...stored(),
    replicationId: OTHER_REPLICATION,
    title: "A synthetic report of the other replication",
    kind: "stage2Rr",
    status: "planned",
    statusHistoryId: null,
    custom: {},
    scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
  },
  // A laboratory that an importer created, with its provenance.
  [IMPORTED_LABORATORY]: {
    ...stored(),
    slug: "synthetic-imported-laboratory",
    name: "Synthetic Imported Laboratory",
    status: "active",
    custom: {},
    dataOrigin: "importedHistorical",
    sourceRecordIds: ["source-record-1"],
    fieldSources: { name: "source-record-1" },
    importedValues: { name: "Synthetic Imported Laboratory" },
  },
};

export { laboratoryScopeKey, OTHER_LABORATORY, OTHER_REPLICATION, replicationScopeKey };

export interface Arena {
  environment(): RulesTestEnvironment;
  /** Firestore as a caller of the world sees it, with the rules applied. */
  db(caller: CallerKind): Firestore;
  uid(caller: CallerKind): string;
  /**
   * Creates a document with the standard fields that an honest client sets, under an identifier
   * that Firestore could have generated wherever the rules accept no other.
   */
  create(caller: CallerKind, path: string, data: Record<string, unknown>, appendOnly?: boolean): Promise<void>;
  /** Changes a document, with the standard fields that an honest client sets. */
  update(caller: CallerKind, path: string, patch: Record<string, unknown>): Promise<void>;
  remove(caller: CallerKind, path: string): Promise<void>;
  /** A document as it is stored, read with the rules switched off. */
  stored(path: string): Promise<Record<string, unknown> | null>;
  /** Writes documents with the rules switched off, as trusted code would. */
  plant(documents: Readonly<Record<string, Record<string, unknown>>>): Promise<void>;
}

/**
 * Sets up a project of its own for a test file, and writes the world and the red-team records
 * afresh before every test, so that an attack that succeeds cannot help or hide the next one.
 */
export function arena(name: string): Arena {
  let environment: RulesTestEnvironment;

  const plant = (documents: Readonly<Record<string, Record<string, unknown>>>) =>
    trusted(environment, async (db) => {
      await Promise.all(Object.entries(documents).map(([path, data]) => setDoc(doc(db, path), data)));
    });

  beforeAll(async () => {
    environment = await createRulesEnvironment(`demo-eegml-redteam-${name}`);
  });

  beforeEach(async () => {
    await seedWorld(environment);
    await plant(RED_TEAM_DOCUMENTS);
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  const db = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);
  const uid = (caller: CallerKind) => actingUid(CALLERS[caller]);

  return {
    environment: () => environment,
    db,
    uid,
    create: (caller, path, data, appendOnly = false) => {
      assertGeneratedIdentifier(path);
      return setDoc(doc(db(caller), path), { ...data, ...createdBy(uid(caller), appendOnly) });
    },
    update: (caller, path, patch) => updateDoc(doc(db(caller), path), { ...patch, ...updatedBy(uid(caller)) }),
    remove: (caller, path) => deleteDoc(doc(db(caller), path)),
    stored: (path) => storedDocument(environment, path),
    plant,
  };
}

/** A string of a given length. */
export const text = (length: number) => "x".repeat(length);

/** A map nested to a given depth, which no schema of the portal accepts. */
export function nested(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let level = 0; level < depth; level += 1) value = { inner: value };
  return value;
}
