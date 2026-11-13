// Integration tests of the imports console, run against the emulators: resolveReconciliationItem
// (leads in conflict, a value in conflict, a possible duplicate person and its merge),
// rollbackImportBatch and the run of the integrity checker that the scheduled function makes.
// Fixtures are synthetic: fictitious accounts, people, laboratories and studies on the example.org domain.
import {
  type CallableInput,
  COLLECTIONS,
  DEMO_IDENTITY_HASH_KEY,
  identityKeyId,
  integrityReportDocSchema,
  personEvidenceKey,
  resolveReconciliationItemContract,
  rollbackImportBatchContract,
  sequenceId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { runIntegrityCheck } from "../../functions/src/integrity/run";
import { adminDb } from "../support/admin";
import {
  account,
  administrator,
  auditOf,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  emailIndexPath,
  grantRole,
  laboratory,
  memberEntry,
  membership,
  membershipPath,
  notificationsOf,
  person,
  refusal,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const STUDY = "SyntheticStudy2001";
const BATCH = "run__20260101T000000000Z__aaaaaaaaaaaa";

async function item(fingerprint: string, fields: Record<string, unknown>): Promise<void> {
  await adminDb.doc(COLLECTIONS.reconciliationItems.docPath(fingerprint)).set({
    ...standard(),
    candidates: [],
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    batchId: BATCH,
    ...fields,
  });
}

describe("resolveReconciliationItem: leads in conflict", () => {
  async function world() {
    await replication(STUDY);
    await person("person-one");
    await person("person-two");
    await membership(STUDY, "person-one", "lead");
    await membership(STUDY, "person-two", "lead");
    await item("lead-conflict", {
      kind: "conflictingLead",
      entityRefs: [
        { entityType: "replication", entityId: STUDY },
        { entityType: "person", entityId: "person-one" },
        { entityType: "person", entityId: "person-two" },
      ],
      candidates: [
        { key: "a/leads:1", valueSource: "Person One", sourceRecordId: "source-record-1" },
        { key: "b/leads:2", valueSource: "Person Two", sourceRecordId: "source-record-2" },
      ],
    });
  }

  const decision: CallableInput<typeof resolveReconciliationItemContract> = {
    fingerprint: "lead-conflict",
    action: "decideLeads",
    memberships: [
      { personId: "person-one", role: "lead", outcome: "current" },
      { personId: "person-two", role: "lead", outcome: "wrong" },
    ],
    note: "The second source is out of date.",
  };

  it("marks each membership, recomputes the leads and records the decision, once", async () => {
    await world();
    const admin = await administrator("uid-admin");
    const lead = await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", STUDY);
    expect(await codeOf(call(lead, resolveReconciliationItemContract, decision))).toBe("permission-denied");
    expect(await codeOf(call(null, resolveReconciliationItemContract, decision))).toBe("unauthenticated");

    // The two memberships, the replication and the two persons, whose replications follow the decision.
    expect(await call(admin, resolveReconciliationItemContract, decision)).toEqual({
      fingerprint: "lead-conflict",
      status: "resolved",
      changedDocuments: 5,
    });
    expect((await dataOf(COLLECTIONS.persons.docPath("person-one")))?.replicationIds).toEqual([STUDY]);
    expect((await dataOf(COLLECTIONS.persons.docPath("person-two")))?.replicationIds ?? []).not.toContain(STUDY);
    expect(await dataOf(membershipPath(STUDY, "person-one", "lead"))).toMatchObject({
      reviewStatus: "confirmed",
      isCurrent: true,
      archivedAt: null,
    });
    const wrong = await dataOf(membershipPath(STUDY, "person-two", "lead"));
    expect(wrong).toMatchObject({ reviewStatus: "confirmed", isCurrent: false });
    expect(wrong?.archivedAt).not.toBeNull();
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.leadPersonIds).toEqual(["person-one"]);
    expect(await dataOf(COLLECTIONS.reconciliationItems.docPath("lead-conflict"))).toMatchObject({
      status: "resolved",
      resolvedBy: "uid-admin",
      resolution: { action: "decideLeads", note: decision.note },
    });
    expect(await auditOf("reconciliation.resolved", STUDY)).toHaveLength(1);

    // A decided item never reopens.
    const again = await refusal(call(admin, resolveReconciliationItemContract, decision));
    expect(again.code).toBe("failed-precondition");
    expect(
      await codeOf(
        call(admin, resolveReconciliationItemContract, { fingerprint: "lead-conflict", action: "dismiss", note: "x" }),
      ),
    ).toBe("failed-precondition");
  });

  it("gives the account of a confirmed lead the role it implies, awaiting approval, as a confirmation does", async () => {
    await world();
    await adminDb.doc(COLLECTIONS.persons.docPath("person-one")).update({ userId: "uid-person-one" });
    await account("uid-person-one", { personId: "person-one" });
    const admin = await administrator("uid-admin");
    await call(admin, resolveReconciliationItemContract, decision);
    const assignments = await adminDb
      .collection(COLLECTIONS.roleAssignments.collectionPath())
      .where("uid", "==", "uid-person-one")
      .get();
    expect(assignments.docs.map((assignment) => [assignment.get("role"), assignment.get("status")])).toEqual([
      ["replication_lead", "pendingApproval"],
    ]);
    // The role awaits approval, so the account reads the replication as a member of its team meanwhile.
    expect((await dataOf(COLLECTIONS.access.docPath("uid-person-one")))?.teamReplicationIds).toEqual([STUDY]);
  });

  it("refuses a decision that does not fit the kind, and a membership that does not exist", async () => {
    await world();
    const core = await coreTeamMember("uid-core");
    expect(
      await codeOf(
        call(core, resolveReconciliationItemContract, { fingerprint: "lead-conflict", action: "keepCurrent" }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        call(core, resolveReconciliationItemContract, {
          ...decision,
          memberships: [{ personId: "person-three", role: "lead", outcome: "current" }],
        }),
      ),
    ).toBe("invalid-argument");
    expect((await dataOf(COLLECTIONS.reconciliationItems.docPath("lead-conflict")))?.status).toBe("open");
  });
});

describe("resolveReconciliationItem: a value in conflict, and dismissal", () => {
  async function world() {
    await replication(STUDY);
    await item("value-conflict", {
      kind: "valueConflict",
      entityRefs: [{ entityType: "replication", entityId: STUDY }],
      field: "originalTitle",
      candidates: [
        { key: "c/title:1", valueSource: "A synthetic title", sourceRecordId: "source-record-3" },
        { key: "d/title:2", valueSource: "Another synthetic title", sourceRecordId: "source-record-4" },
      ],
    });
    await item("year-conflict", {
      kind: "valueConflict",
      entityRefs: [{ entityType: "replication", entityId: STUDY }],
      field: "originalYear",
      candidates: [{ key: "c/year:1", valueSource: "about 2001", sourceRecordId: "source-record-5" }],
    });
    return administrator("uid-admin");
  }

  it("sets the chosen value with its source record, and refuses one the field cannot hold", async () => {
    const admin = await world();
    await call(admin, resolveReconciliationItemContract, {
      fingerprint: "value-conflict",
      action: "chooseValue",
      candidateKey: "d/title:2",
    });
    expect(await dataOf(COLLECTIONS.replications.docPath(STUDY))).toMatchObject({
      originalTitle: "Another synthetic title",
      fieldSources: { originalTitle: "source-record-4" },
    });
    const unfit = await refusal(
      call(admin, resolveReconciliationItemContract, {
        fingerprint: "year-conflict",
        action: "chooseValue",
        candidateKey: "c/year:1",
      }),
    );
    expect(unfit.code).toBe("failed-precondition");
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.originalYear).toBeUndefined();
    expect(
      await call(admin, resolveReconciliationItemContract, { fingerprint: "year-conflict", action: "keepCurrent" }),
    ).toMatchObject({ status: "resolved", changedDocuments: 0 });
  });

  it("dismisses an item with a note and changes nothing else", async () => {
    const admin = await world();
    expect(
      await call(admin, resolveReconciliationItemContract, {
        fingerprint: "value-conflict",
        action: "dismiss",
        note: "Neither value is right.",
      }),
    ).toEqual({ fingerprint: "value-conflict", status: "dismissed", changedDocuments: 0 });
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.originalTitle).toBeUndefined();
    expect(await auditOf("reconciliation.dismissed", STUDY)).toHaveLength(1);
  });
});

describe("resolveReconciliationItem: a possible duplicate person", () => {
  const keyPath = (key: string) =>
    COLLECTIONS.identityKeys.docPath(identityKeyId("person", "email", key, DEMO_IDENTITY_HASH_KEY));
  const ONLY_MERGED = personEvidenceKey.email("merge.only@example.org");
  const SHARED = personEvidenceKey.email("shared.key@example.org");

  async function world(mergedUserId: string | null = null) {
    await replication(STUDY);
    await laboratory("lab-one", { piPersonId: "person-merge" });
    await person("person-keep", [{ email: "keep@example.org" }], { sourceRecordIds: ["source-record-keep"] });
    await person("person-merge", [{ email: "merge.only@example.org" }], {
      sourceRecordIds: ["source-record-merge"],
      fieldSources: { displayName: "source-record-merge" },
      userId: mergedUserId,
    });
    await person("person-other");
    await memberEntry("lab-one", "person-merge", { status: "confirmed", sourceRecordIds: ["source-record-merge"] });
    await membership(STUDY, "person-merge", "member", { reviewStatus: "confirmed" });
    const key = (id: string, entityIds: string[]) =>
      adminDb.doc(id).set({
        ...standard(),
        entityType: "person",
        keyKind: "email",
        entityIds,
        status: "active",
        mergedIntoId: null,
      });
    await key(keyPath(ONLY_MERGED), ["person-merge"]);
    await key(keyPath(SHARED), ["person-merge", "person-other"]);
    await item("duplicate", {
      kind: "duplicatePerson",
      entityRefs: [
        { entityType: "person", entityId: "person-keep" },
        { entityType: "person", entityId: "person-merge" },
      ],
    });
    return administrator("uid-admin");
  }

  const merge = {
    fingerprint: "duplicate",
    action: "mergePersons",
    keepPersonId: "person-keep",
    mergePersonId: "person-merge",
  } as const;

  it("moves every reference to the kept record, through the identity keys, and loses no source link", async () => {
    const admin = await world();
    const answer = await call(admin, resolveReconciliationItemContract, merge);
    expect(answer.status).toBe("resolved");
    expect(answer.changedDocuments).toBeGreaterThan(5);

    const kept = await dataOf(COLLECTIONS.persons.docPath("person-keep"));
    expect(kept?.sourceRecordIds).toEqual(["source-record-keep", "source-record-merge"]);
    expect(kept?.fieldSources).toEqual({ displayName: "source-record-merge" });
    expect((await dataOf(COLLECTIONS.persons.docPath("person-merge")))?.archivedAt).not.toBeNull();
    expect(await dataOf(keyPath(ONLY_MERGED))).toMatchObject({
      status: "merged",
      mergedIntoId: "person-keep",
      entityIds: ["person-merge"],
    });
    expect((await dataOf(keyPath(SHARED)))?.entityIds).toEqual(["person-keep", "person-other"]);
    expect((await dataOf(emailIndexPath("merge.only@example.org")))?.personIds).toEqual(["person-keep"]);
    const contact = await dataOf(COLLECTIONS.personContact.docPath("person-keep"));
    const emails = (contact?.emails ?? []) as { email: string; kind: string }[];
    expect(emails.map((email) => [email.email, email.kind])).toEqual([
      ["keep@example.org", "primary"],
      ["merge.only@example.org", "secondary"],
    ]);
    expect(await dataOf(COLLECTIONS.laboratoryMembers.docPath("lab-one", "person-keep"))).toMatchObject({
      personId: "person-keep",
      status: "confirmed",
      sourceRecordIds: ["source-record-merge"],
    });
    expect((await dataOf(COLLECTIONS.laboratoryMembers.docPath("lab-one", "person-merge")))?.archivedAt).not.toBeNull();
    expect(await dataOf(membershipPath(STUDY, "person-keep", "member"))).toMatchObject({ personId: "person-keep" });
    expect((await dataOf(COLLECTIONS.laboratories.docPath("lab-one")))?.piPersonId).toBe("person-keep");
    expect(await auditOf("person.merged", "person-keep")).toHaveLength(1);
  });

  it("leaves a merge into a claimed record to programme administrators, and asks for the copied entries to be confirmed again", async () => {
    const admin = await world();
    await adminDb.doc(COLLECTIONS.persons.docPath("person-keep")).update({ userId: "uid-keeper" });
    await adminDb
      .doc(COLLECTIONS.persons.docPath("person-merge"))
      .update({ laboratoryIds: ["lab-one"], replicationIds: [STUDY] });
    await account("uid-keeper", { personId: "person-keep" });
    const core = await coreTeamMember("uid-core");
    expect(await codeOf(call(core, resolveReconciliationItemContract, merge))).toBe("permission-denied");
    expect((await dataOf(COLLECTIONS.reconciliationItems.docPath("duplicate")))?.status).toBe("open");

    await call(admin, resolveReconciliationItemContract, merge);
    expect((await dataOf(COLLECTIONS.laboratoryMembers.docPath("lab-one", "person-keep")))?.status).toBe("proposed");
    expect((await dataOf(membershipPath(STUDY, "person-keep", "member")))?.reviewStatus).toBe("needsReview");
    // The units of the merged record, which give scope, wait for that confirmation too.
    const kept = await dataOf(COLLECTIONS.persons.docPath("person-keep"));
    expect(kept?.laboratoryIds ?? []).not.toContain("lab-one");
    expect(kept?.replicationIds ?? []).not.toContain(STUDY);
    expect((await notificationsOf("uid-keeper")).map((notification) => notification.payload.kind)).toContain(
      "personMerged",
    );
    const [audit] = await auditOf("person.merged", "person-keep");
    const changes = JSON.stringify(audit?.changes);
    expect(changes).toContain("personEmailIndex");
    expect(changes).not.toContain("@example.org");
  });

  it("refuses to merge away a record that an account has claimed, and changes nothing", async () => {
    const admin = await world("uid-claimant");
    const refused = await refusal(call(admin, resolveReconciliationItemContract, merge));
    expect(refused.code).toBe("failed-precondition");
    expect((await dataOf(COLLECTIONS.persons.docPath("person-merge")))?.archivedAt).toBeNull();
    expect((await dataOf(COLLECTIONS.reconciliationItems.docPath("duplicate")))?.status).toBe("open");
  });

  it("refuses records that are not the item's, and a record merged into itself", async () => {
    const admin = await world();
    expect(
      await codeOf(call(admin, resolveReconciliationItemContract, { ...merge, mergePersonId: "person-other" })),
    ).toBe("invalid-argument");
    expect(
      await codeOf(call(admin, resolveReconciliationItemContract, { ...merge, mergePersonId: "person-keep" })),
    ).toBe("invalid-argument");
    expect(
      await call(admin, resolveReconciliationItemContract, { fingerprint: "duplicate", action: "distinctPersons" }),
    ).toMatchObject({ status: "resolved", changedDocuments: 0 });
  });
});

describe("rollbackImportBatch", () => {
  const CREATED = COLLECTIONS.persons.docPath("person-created");
  const UPDATED = COLLECTIONS.persons.docPath("person-updated");

  async function batch(mode: "apply" | "preview" = "apply") {
    const at = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
    const base = {
      schemaVersion: 1,
      createdAt: at,
      updatedAt: at,
      createdBy: "system:import",
      updatedBy: "system:import",
      archivedAt: null,
      writeContext: { origin: "import", depth: 0, correlationId: null, causationId: null, auditEventId: null },
    };
    const personOf = (displayName: string) => ({
      ...base,
      slug: displayName.toLowerCase().replaceAll(" ", "-"),
      displayName,
      laboratoryIds: [],
      replicationIds: [],
      isCoreTeam: false,
      publicListing: "none",
      coreRoles: [],
      userId: null,
      claimedAt: null,
      custom: {},
      dataOrigin: "importedHistorical",
    });
    const created = personOf("Created Person");
    const before = personOf("Old Name");
    const after = { ...personOf("New Name"), slug: before.slug };
    await adminDb.doc(CREATED).set(created);
    await adminDb.doc(UPDATED).set(after);
    await adminDb.doc(COLLECTIONS.importBatches.docPath(BATCH)).set({
      ...base,
      sourceKey: "z",
      mode,
      status: mode === "apply" ? "applied" : "previewed",
      contentHash: "a".repeat(64),
      startedBy: "system:import",
      startedAt: at,
      finishedAt: at,
      stats: {},
    });
    const change = (n: number, documentPath: string, was: unknown, now: unknown) =>
      adminDb.doc(COLLECTIONS.importBatchChanges.docPath(BATCH, sequenceId(n))).set({
        schemaVersion: 1,
        createdAt: at,
        createdBy: "system:import",
        writeContext: base.writeContext,
        batchId: BATCH,
        documentPath,
        operation: was === null ? "create" : "update",
        relation: was === null ? "created" : "updated",
        sourceRecordIds: ["source-record-1"],
        before: was,
        after: now,
      });
    await change(1, CREATED, null, created);
    await change(2, UPDATED, before, after);
  }

  it("is for holders of the rollback capability, and shows what would change before it changes anything", async () => {
    await batch();
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");
    expect(await codeOf(call(core, rollbackImportBatchContract, { batchId: BATCH, confirm: false }))).toBe(
      "permission-denied",
    );
    const planned = await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: false });
    expect(planned).toEqual({
      status: "planned",
      counts: { restored: 1, removed: 1, itemsWithdrawn: 0, itemsLeft: 0, discarded: 0 },
      documents: [
        { path: UPDATED, action: "restore" },
        { path: CREATED, action: "remove" },
      ],
      truncated: false,
    });
    expect((await adminDb.doc(CREATED).get()).exists).toBe(true);

    expect(await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: true })).toEqual({
      status: "rolledBack",
      counts: { restored: 1, removed: 1, itemsWithdrawn: 0, itemsLeft: 0, discarded: 0 },
    });
    expect((await adminDb.doc(CREATED).get()).exists).toBe(false);
    expect((await dataOf(UPDATED))?.displayName).toBe("Old Name");
    expect((await dataOf(COLLECTIONS.importBatches.docPath(BATCH)))?.status).toBe("rolledBack");
    expect(await auditOf("importBatch.rolledBack", BATCH)).toHaveLength(1);
    expect(await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: true })).toMatchObject({
      status: "nothingToReverse",
    });
  });

  it("refuses as a whole when a document was edited in the portal since, and reverses nothing", async () => {
    await batch();
    const admin = await administrator("uid-admin");
    await adminDb.doc(UPDATED).update({ displayName: "Edited in the portal" });
    expect(await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: true })).toEqual({
      status: "refused",
      changedDocuments: [UPDATED],
    });
    expect((await adminDb.doc(CREATED).get()).exists).toBe(true);
  });

  it("has nothing to reverse for a preview", async () => {
    await batch("preview");
    const admin = await administrator("uid-admin");
    expect(await call(admin, rollbackImportBatchContract, { batchId: BATCH, confirm: false })).toMatchObject({
      status: "nothingToReverse",
    });
  });
});

describe("the integrity checker of the scheduled function", () => {
  it("writes a report with its findings and the counts of every check", async () => {
    await laboratory("lab-dangling", { piPersonId: "person-missing" });
    const { runId, findings } = await runIntegrityCheck(adminDb, new Date("2026-02-03T04:05:06.007Z"));
    expect(runId).toBe("scheduled-20260203T040506007Z");
    expect(findings).toBeGreaterThanOrEqual(1);
    const report = integrityReportDocSchema.parse(await dataOf(COLLECTIONS.integrityReports.docPath(runId)));
    expect(report.status).toBe("completed");
    expect(report.counts.danglingReference).toBeGreaterThanOrEqual(1);
    const stored = await adminDb.collection(COLLECTIONS.integrityReportFindings.collectionPath(runId)).get();
    expect(stored.docs.map((document) => document.data())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: "danglingReference",
          documentPath: "laboratories/lab-dangling",
          field: "piPersonId",
        }),
      ]),
    );
  });
});
