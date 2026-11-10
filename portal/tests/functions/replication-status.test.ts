// Integration tests of setReplicationStatus, run against the emulators: who may change the
// status of a replication, what the function refuses, and that the status, its history entry
// and the audit entry are written together (decision D-019).
// Fixtures are synthetic: fictitious accounts and studies on the example.org domain.
import {
  COLLECTIONS,
  MEMBERS_SCOPE_KEY,
  publicErrorReason,
  replicationScopeKey,
  setReplicationStatusContract,
  statusDefinitionId,
  statusHistoryDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  grantRole,
  leaveNoTrace,
  refusal,
  replication,
  resetWorld,
  standard,
} from "./support";

const STUDY = "StatusStudy2001";
const OTHER_STUDY = "StatusStudy2002";

beforeEach(async () => {
  await resetWorld();
  await Promise.all([replication(STUDY), replication(OTHER_STUDY)]);
  await Promise.all(
    (
      [
        ["planning", "Planning", null],
        ["collecting", "Collecting", null],
        ["retired", "Retired", Timestamp.now()],
      ] as const
    ).map(([key, label, archivedAt], position) =>
      adminDb.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("replication", key))).set({
        ...standard(),
        archivedAt,
        entityType: "replication",
        key,
        label,
        category: "active",
        position,
        isDefault: false,
      }),
    ),
  );
});

afterAll(leaveNoTrace);

const change = (fromStatusKey: string | null, toStatusKey: string, replicationId = STUDY) => ({
  replicationId,
  fromStatusKey,
  toStatusKey,
  reason: "A synthetic reason for a test.",
});

async function lead(uid: string, studyKey = STUDY) {
  const caller = await account(uid);
  await grantRole(uid, "replication_lead", "replication", studyKey);
  return caller;
}

describe("setReplicationStatus", () => {
  it("lets a lead of the replication change its status, with the history entry and the audit entry in one transaction", async () => {
    const caller = await lead("uid-lead");
    const answer = await call(caller, setReplicationStatusContract, change(null, "planning"));

    const stored = await dataOf(COLLECTIONS.replications.docPath(STUDY));
    expect(stored).toMatchObject({
      statusKey: "planning",
      statusHistoryId: answer.statusHistoryId,
      updatedBy: "uid-lead",
    });

    const entry = statusHistoryDocSchema.parse(await dataOf(COLLECTIONS.statusHistory.docPath(answer.statusHistoryId)));
    expect(entry).toMatchObject({
      entityType: "replication",
      entityId: STUDY,
      fromStatusKey: null,
      toStatusKey: "planning",
      changedBy: "uid-lead",
      reason: "A synthetic reason for a test.",
      source: "manual",
      replicationId: STUDY,
      laboratoryId: null,
      scopeKeys: [replicationScopeKey(STUDY), MEMBERS_SCOPE_KEY],
    });
    expect(entry.effectiveAt.toMillis()).toBe(entry.recordedAt.toMillis());

    const [audit] = await auditOf("replication.statusChanged", STUDY);
    expect(audit).toMatchObject({ actorUid: "uid-lead", entityType: "replication", entityId: STUDY });
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        { field: "statusKey", before: null, after: "planning" },
        { field: "reason", after: "A synthetic reason for a test." },
      ]),
    );
    // The documents name the audit entry, so the audit trigger does not record the change twice.
    const [auditId] = (
      await adminDb.collection("auditEvents").where("action", "==", "replication.statusChanged").get()
    ).docs.map((document) => document.id);
    expect(auditId).toBeDefined();
    expect(stored?.writeContext?.auditEventId).toBe(auditId);
    expect(entry.writeContext.auditEventId).toBe(auditId);

    // A second change follows the first and keeps both entries.
    const next = await call(caller, setReplicationStatusContract, change("planning", "collecting"));
    expect(next.statusHistoryId).not.toBe(answer.statusHistoryId);
    const history = await adminDb.collection("statusHistory").where("entityId", "==", STUDY).get();
    expect(history.size).toBe(2);
  });

  it("lets the core team and programme administrators change any replication's status", async () => {
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");
    await call(core, setReplicationStatusContract, change(null, "planning"));
    await call(admin, setReplicationStatusContract, change("planning", "collecting"));
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.statusKey).toBe("collecting");
  });

  it("refuses a caller who is signed out, holds no right to the replication, or leads another one", async () => {
    const member = await account("uid-member");
    const otherLead = await lead("uid-other-lead", OTHER_STUDY);
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");

    expect(await codeOf(call(null, setReplicationStatusContract, change(null, "planning")))).toBe("unauthenticated");
    for (const caller of [member, otherLead, coordinator]) {
      expect(await codeOf(call(caller, setReplicationStatusContract, change(null, "planning"))), caller.uid).toBe(
        "permission-denied",
      );
    }
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.statusKey).toBeNull();
    expect((await adminDb.collection("statusHistory").get()).size).toBe(0);
    expect(await auditOf("replication.statusChanged")).toEqual([]);
  });

  it("refuses an administrator who has not presented the second factor, and says why", async () => {
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });
    const failure = await refusal(call(withoutFactor, setReplicationStatusContract, change(null, "planning")));
    expect(failure.code).toBe("failed-precondition");
    expect(publicErrorReason(failure.details)).toBe("secondFactorRequired");
  });

  it("refuses a change made on a status that has changed since, and a change to the same status", async () => {
    const caller = await lead("uid-lead");
    await call(caller, setReplicationStatusContract, change(null, "planning"));

    const stale = await refusal(call(caller, setReplicationStatusContract, change(null, "collecting")));
    expect(stale.code).toBe("failed-precondition");
    expect(stale.message).toContain("has changed since you saw it");

    const same = await refusal(call(caller, setReplicationStatusContract, change("planning", "planning")));
    expect(same.code).toBe("failed-precondition");
    expect((await adminDb.collection("statusHistory").get()).size).toBe(1);
  });

  it("refuses a status that does not exist or is archived, a missing reason, an unknown or archived replication", async () => {
    const admin = await administrator("uid-admin");
    expect(await codeOf(call(admin, setReplicationStatusContract, change(null, "unheardOf")))).toBe("invalid-argument");
    expect(await codeOf(call(admin, setReplicationStatusContract, change(null, "retired")))).toBe("invalid-argument");
    expect(
      await codeOf(call(admin, setReplicationStatusContract, { ...change(null, "planning"), reason: "   " })),
    ).toBe("invalid-argument");
    expect(await codeOf(call(admin, setReplicationStatusContract, change(null, "planning", "NoSuchStudy2001")))).toBe(
      "not-found",
    );

    await adminDb.doc(COLLECTIONS.replications.docPath(OTHER_STUDY)).update({ archivedAt: Timestamp.now() });
    expect(await codeOf(call(admin, setReplicationStatusContract, change(null, "planning", OTHER_STUDY)))).toBe(
      "failed-precondition",
    );
    expect((await adminDb.collection("statusHistory").get()).size).toBe(0);
  });
});
