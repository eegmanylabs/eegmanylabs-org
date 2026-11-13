// Integration tests of what applies the programme's answers of 13 November 2026
// (docs/MIGRATION_PLAN.md, section 11), run against the emulators: the decided status of a
// study, applied to its open status question with the decision as provenance (question 1); the
// sealed capability, which no named grant confers (questions 7 and 14); and the retention of the
// raw material of the migration, which deletes nothing before the migration is marked verified
// and three years have passed, under a fake clock, and keeps any contact that may belong to a
// member (questions 20 and 21).
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTIONS,
  DEMO_IDENTITY_HASH_KEY,
  getRetentionContract,
  markMigrationVerifiedContract,
  outreachContactDocSchema,
  registerDatasetContract,
  resolveReconciliationItemContract,
  setCapabilityGrantContract,
  statusDefinitionId,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  emailIndexResolver,
  RETAINED_NO_LONGER_MARKER,
  sweepRetention,
} from "../../functions/src/governance/retention";
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
  laboratory,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const BATCH = "run__20260101T000000000Z__aaaaaaaaaaaa";
const DAY = 86_400_000;

async function statusDefinition(key: string, category: string, position: number): Promise<void> {
  await adminDb.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("replication", key))).set({
    ...standard(),
    entityType: "replication",
    key,
    label: key,
    category,
    position,
    isDefault: false,
  });
}

/** An open status question about a study, with the statuses that two sources state as its candidates. */
async function statusQuestion(fingerprint: string, studyKey: string): Promise<void> {
  await adminDb.doc(COLLECTIONS.reconciliationItems.docPath(fingerprint)).set({
    ...standard(),
    kind: "statusQuestion",
    entityRefs: [{ entityType: "replication", entityId: studyKey }],
    sourceKey: "d",
    field: "status",
    candidates: [
      { key: "d/list/absentFromWebsite:aaaa", sourceRecordId: "record-d" },
      { key: "d/list/stage:bbbb", valueSource: "Currently put on hold", sourceRecordId: "record-d" },
      { key: "f/counts/strike/study:cccc", sourceRecordId: "record-f" },
    ],
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    batchId: BATCH,
  });
}

describe("resolveReconciliationItem: a status that the programme decided (question 1)", () => {
  beforeEach(async () => {
    await statusDefinition("archived", "cancelled", 0);
    await statusDefinition("paused", "paused", 1);
    await statusDefinition("ongoing", "active", 2);
  });

  it.each([
    ["Carretie2004", "archived", "cancelled"],
    ["Frank2005", "archived", "cancelled"],
    ["DonkersvanBoxtel2004", "paused", "paused"],
    ["Hajcak2006", "ongoing", "ongoing"],
  ])(
    "sets the status of %s to %s, names the decision, and keeps the source statuses on the item",
    async (study, key, decided) => {
      const admin = await administrator("uid-admin");
      await replication(study);
      await statusQuestion("status-question", study);
      const answer = await call(admin, resolveReconciliationItemContract, {
        fingerprint: "status-question",
        action: "applyProgrammeDecision",
      });
      expect(answer).toMatchObject({ status: "resolved", changedDocuments: 2 });
      const stored = await dataOf(COLLECTIONS.replications.docPath(study));
      expect(stored?.statusKey).toBe(key);
      const history = await dataOf(COLLECTIONS.statusHistory.docPath(String(stored?.statusHistoryId)));
      const decision = {
        decidedBy: "programmeLead",
        decidedOn: "2026-11-13",
        reference: "docs/MIGRATION_PLAN.md, section 11, question 1",
      };
      expect(history).toMatchObject({
        entityType: "replication",
        entityId: study,
        fromStatusKey: null,
        toStatusKey: key,
        source: "programmeDecision",
        decision,
        changedBy: "uid-admin",
      });
      const effectiveAt = history?.effectiveAt;
      expect(effectiveAt).toBeInstanceOf(Timestamp);
      expect((effectiveAt as Timestamp).toDate().toISOString()).toBe("2026-11-13T00:00:00.000Z");
      const item = await dataOf(COLLECTIONS.reconciliationItems.docPath("status-question"));
      expect(item).toMatchObject({
        status: "resolved",
        resolvedBy: "uid-admin",
        resolution: { action: "applyProgrammeDecision", decision, decidedStatus: decided, statusKey: key },
      });
      // The statuses that the sources stated stay beside the decision, as its provenance.
      expect((item?.candidates ?? []) as unknown[]).toHaveLength(3);
      expect(await auditOf("reconciliation.resolved", study)).toHaveLength(1);
    },
  );

  it("closes a second question about the same study without a second history entry", async () => {
    const admin = await administrator("uid-admin");
    await replication("Frank2005");
    await statusQuestion("first", "Frank2005");
    await statusQuestion("second", "Frank2005");
    await call(admin, resolveReconciliationItemContract, { fingerprint: "first", action: "applyProgrammeDecision" });
    const second = await call(admin, resolveReconciliationItemContract, {
      fingerprint: "second",
      action: "applyProgrammeDecision",
    });
    expect(second).toMatchObject({ status: "resolved", changedDocuments: 0 });
    const entries = await adminDb.collection(COLLECTIONS.statusHistory.collectionPath()).get();
    expect(entries.size).toBe(1);
  });

  it("refuses a study without a decision, a status changed since in the portal, and anyone but an administrator", async () => {
    const admin = await administrator("uid-admin");
    await replication("SyntheticStudy2001");
    await statusQuestion("undecided", "SyntheticStudy2001");
    expect(
      await codeOf(
        call(admin, resolveReconciliationItemContract, { fingerprint: "undecided", action: "applyProgrammeDecision" }),
      ),
    ).toBe("failed-precondition");
    await replication("Hajcak2006");
    await adminDb.doc(COLLECTIONS.replications.docPath("Hajcak2006")).update({ statusKey: "paused" });
    await statusQuestion("moved", "Hajcak2006");
    expect(
      await codeOf(
        call(admin, resolveReconciliationItemContract, { fingerprint: "moved", action: "applyProgrammeDecision" }),
      ),
    ).toBe("failed-precondition");
    await replication("Carretie2004");
    await statusQuestion("core", "Carretie2004");
    const core = await coreTeamMember("uid-core");
    expect(
      await codeOf(
        call(core, resolveReconciliationItemContract, { fingerprint: "core", action: "applyProgrammeDecision" }),
      ),
    ).toBe("permission-denied");
    expect((await dataOf(COLLECTIONS.replications.docPath("Carretie2004")))?.statusKey).toBeNull();
    expect((await dataOf(COLLECTIONS.reconciliationItems.docPath("core")))?.status).toBe("open");
  });
});

describe("setCapabilityGrant and the sealed values (questions 7 and 14)", () => {
  it("refuses to grant sealed.read to anyone by name", async () => {
    const admin = await administrator("uid-admin");
    await account("uid-core-target");
    expect(
      await codeOf(
        call(admin, setCapabilityGrantContract, {
          uid: "uid-core-target",
          capability: "sealed.read",
          action: "grant",
          reason: "A synthetic attempt to widen the seal.",
        }),
      ),
    ).toBe("invalid-argument");
    expect((await adminDb.collection(COLLECTIONS.capabilityGrants.collectionPath()).get()).size).toBe(0);
  });
});

describe("registerDataset and the two Amodio replications (questions 2 and 3)", () => {
  const registration = (datasetKey: string, replicationId: string) => ({
    datasetKey,
    replicationId,
    laboratoryId: null,
    title: "A synthetic dataset",
    modality: "main" as const,
    groupingLabel: null,
    sourceInstitutionId: null,
    storageOwnerPersonId: null,
    protocolId: null,
    expectedFileCount: null,
    expectedParticipants: null,
    metadata: {},
    storage: null,
  });

  it("makes one record that both replications share, naming the decision, and shares nothing else", async () => {
    const admin = await administrator("uid-admin");
    await replication("AmodioJost2007");
    await replication("AmodioMaster2008");
    await replication("SyntheticStudy2001");
    await call(admin, registerDatasetContract, registration("amodio-combined", "AmodioJost2007"));
    const shared = await dataOf(COLLECTIONS.datasets.docPath("amodio-combined"));
    expect(shared).toMatchObject({
      replicationId: "AmodioJost2007",
      sharedReplicationIds: ["AmodioMaster2008"],
      sharingDecision: {
        decidedBy: "programmeLead",
        decidedOn: "2026-11-13",
        reference: "docs/MIGRATION_PLAN.md, section 11, question 3",
      },
    });
    // The team of either replication reads the record as its own.
    expect(shared?.scopeKeys).toEqual(["rep:AmodioJost2007", "rep:AmodioMaster2008"]);
    await call(admin, registerDatasetContract, registration("synthetic-alone", "SyntheticStudy2001"));
    const alone = await dataOf(COLLECTIONS.datasets.docPath("synthetic-alone"));
    expect(alone).not.toHaveProperty("sharedReplicationIds");
    expect(alone?.scopeKeys).toEqual(["rep:SyntheticStudy2001"]);
  });

  it("keeps the shared record one: a second one for either replication is refused, and a laboratory's own stays its own", async () => {
    const admin = await administrator("uid-admin");
    await replication("AmodioJost2007");
    await replication("AmodioMaster2008");
    await laboratory("lab-synthetic-amodio");
    await call(admin, registerDatasetContract, registration("amodio-combined", "AmodioJost2007"));
    expect(await codeOf(call(admin, registerDatasetContract, registration("amodio-second", "AmodioMaster2008")))).toBe(
      "already-exists",
    );
    expect(await dataOf(COLLECTIONS.datasets.docPath("amodio-second"))).toBeUndefined();
    await call(admin, registerDatasetContract, {
      ...registration("amodio-lab-own", "AmodioMaster2008"),
      laboratoryId: "lab-synthetic-amodio",
    });
    const own = await dataOf(COLLECTIONS.datasets.docPath("amodio-lab-own"));
    expect(own).not.toHaveProperty("sharedReplicationIds");
    expect(own?.scopeKeys).not.toContain("rep:AmodioJost2007");
  });
});

describe("the retention of the raw material of the migration (questions 20 and 21)", () => {
  async function settings(fields: Record<string, unknown> = {}): Promise<void> {
    await adminDb
      .doc(COLLECTIONS.systemSettings.docPath())
      .set({ ...standard(), featureFlags: {}, maintenanceMode: false, listLimit: 200, retention: {}, ...fields });
  }

  /**
   * An outreach contact of source F with its raw row, its earlier revision and an entry of the
   * change log, stored as the recruitment importer writes it: an unmatched contact has no
   * `personId` at all.
   */
  async function outreach(
    id: string,
    personId: string | null,
    sourceKey = "f",
    contactEmail: string | null = null,
  ): Promise<void> {
    const recordId = `record-${id}`;
    const earlier = `record-${id}-earlier`;
    for (const record of [recordId, earlier]) {
      await adminDb.doc(COLLECTIONS.sourceRecords.docPath(record)).set({
        schemaVersion: 1,
        createdAt: Timestamp.now(),
        createdBy: "system:import",
        writeContext: { origin: "import", depth: 0, correlationId: null, causationId: null, auditEventId: null },
        sourceKey,
        tabKey: "synthetictab",
        rowKey: `contact__${id}`,
        rowNumber: 4,
        raw: { A: "Synthetic Contact", B: "synthetic.contact@example.org" },
        rawHash: "aaaaaaaaaaaa",
        observedOn: "2026-11-09",
        firstSeenBatchId: BATCH,
        lastSeenBatchId: BATCH,
        supersededById: record === earlier ? recordId : null,
      });
    }
    const contact = {
      ...standard(),
      replicationId: "SyntheticStudy2001",
      ...(personId === null ? {} : { personId }),
      contactNameSource: "Synthetic Contact",
      ...(contactEmail === null ? {} : { contactEmail }),
      sourceRecordId: recordId,
      scopeKeys: ["rep:SyntheticStudy2001"],
    };
    expect(outreachContactDocSchema.safeParse(contact).success).toBe(true);
    await adminDb.doc(COLLECTIONS.outreachContacts.docPath(id)).set(contact);
    await adminDb.doc(`importBatches/${BATCH}/changes/${id}`).set({
      schemaVersion: 1,
      createdAt: Timestamp.now(),
      createdBy: "system:import",
      writeContext: { origin: "import", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      batchId: BATCH,
      documentPath: COLLECTIONS.outreachContacts.docPath(id),
      operation: "create",
      relation: "created",
      sourceRecordIds: [recordId],
      before: null,
      after: { contactNameSource: "Synthetic Contact" },
    });
  }

  const exists = async (path: string) => (await adminDb.doc(path).get()).exists;
  const outcomeOf = (outcomes: Awaited<ReturnType<typeof sweepRetention>>) =>
    outcomes.find((outcome) => outcome.target === "outreachNeverJoined");

  it("deletes nothing before the migration is marked verified, nor in the three years after", async () => {
    await outreach("contact-outsider", null);
    const now = new Date("2035-01-01T00:00:00Z");
    const unverified = await sweepRetention(adminDb, { retention: {}, migrationVerifiedAt: null }, now, false);
    expect(outcomeOf(unverified)).toMatchObject({
      eligible: 0,
      deleted: 0,
      decision: { reference: "docs/MIGRATION_PLAN.md, section 11, question 21" },
    });
    expect(outcomeOf(unverified)?.note).toMatch(/not marked verified/);
    const verifiedAt = new Date("2027-03-01T00:00:00Z");
    // One year after the mark, the period that question 20 named before question 21 extended it, nothing goes. Nor
    // does it 1,095 days after: three years from 1 March 2027 run over 29 February 2028, so they last 1,096 days.
    for (const within of [366 * DAY, 2 * 366 * DAY, 1_095 * DAY, 1_096 * DAY - 1]) {
      const kept = await sweepRetention(
        adminDb,
        { retention: {}, migrationVerifiedAt: verifiedAt },
        new Date(verifiedAt.getTime() + within),
        false,
      );
      expect(outcomeOf(kept)).toMatchObject({ eligible: 0, deleted: 0 });
      expect(outcomeOf(kept)?.note).toContain("Kept for three years after the migration was marked verified");
      expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-outsider"))).toBe(true);
      expect(await exists(COLLECTIONS.sourceRecords.docPath("record-contact-outsider"))).toBe(true);
    }
    // At 1,096 days the three calendar years have passed, and the contact goes.
    const swept = await sweepRetention(
      adminDb,
      { retention: {}, migrationVerifiedAt: verifiedAt },
      new Date(verifiedAt.getTime() + 1_096 * DAY),
      false,
    );
    expect(outcomeOf(swept)).toMatchObject({ eligible: 1, deleted: 1 });
    expect(outcomeOf(swept)?.note).toContain("three years after the migration was marked verified");
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-outsider"))).toBe(false);
  });

  it("then deletes the outreach records of people who never joined, keeps everything else, and never the audit trail", async () => {
    await outreach("contact-outsider", null);
    await outreach("contact-member", "person-joined");
    await outreach("contact-of-a", null, "a");
    // A raw row of source F that is no outreach contact is other raw material, which question 21 keeps.
    await adminDb.doc(COLLECTIONS.sourceRecords.docPath("record-f-summary")).set({
      ...standard(),
      sourceKey: "f",
      tabKey: "numberoflabsperreplication",
      rowKey: "row__2",
      rowNumber: 2,
      raw: { A: "SyntheticStudy2001", B: "3" },
      rawHash: "bbbbbbbbbbbb",
      observedOn: "2026-11-09",
      supersededById: null,
    });
    const audit = await adminDb.collection(COLLECTIONS.auditEvents.collectionPath()).add({ marker: "synthetic" });
    const verifiedAt = new Date("2027-03-01T00:00:00Z");
    const later = new Date(verifiedAt.getTime() + 1_097 * DAY);
    const dry = await sweepRetention(adminDb, { retention: {}, migrationVerifiedAt: verifiedAt }, later, true);
    expect(outcomeOf(dry)).toMatchObject({ eligible: 1, deleted: 0 });
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-outsider"))).toBe(true);

    const swept = await sweepRetention(adminDb, { retention: {}, migrationVerifiedAt: verifiedAt }, later, false);
    expect(outcomeOf(swept)).toMatchObject({ eligible: 1, deleted: 1 });
    // The contact of a person who never joined goes, with every revision of its raw row.
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-outsider"))).toBe(false);
    expect(await exists(COLLECTIONS.sourceRecords.docPath("record-contact-outsider"))).toBe(false);
    expect(await exists(COLLECTIONS.sourceRecords.docPath("record-contact-outsider-earlier"))).toBe(false);
    // The change log keeps its entry, with a marker in place of each value.
    const change = await dataOf(`importBatches/${BATCH}/changes/contact-outsider`);
    expect(change?.after).toEqual({ contactNameSource: RETAINED_NO_LONGER_MARKER });
    expect(JSON.stringify(change)).not.toContain("Synthetic Contact");
    // A person who joined, and an outreach row of another source, are kept.
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-member"))).toBe(true);
    expect(await exists(COLLECTIONS.sourceRecords.docPath("record-contact-member"))).toBe(true);
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-of-a"))).toBe(true);
    expect(await exists(COLLECTIONS.sourceRecords.docPath("record-contact-of-a"))).toBe(true);
    expect(await exists(COLLECTIONS.sourceRecords.docPath("record-f-summary"))).toBe(true);
    expect((await dataOf(`importBatches/${BATCH}/changes/contact-member`))?.after).toEqual({
      contactNameSource: "Synthetic Contact",
    });
    // The audit trail is never swept.
    expect((await audit.get()).exists).toBe(true);
  });

  it("keeps a contact whose address now resolves to a person, or whose row a review item names", async () => {
    await outreach("contact-joined-later", null, "f", "synthetic.joined@example.org");
    await outreach("contact-in-review", null);
    await outreach("contact-outsider", null, "f", "synthetic.outsider@example.org");
    // The person joined after the last import: the email index names them now.
    await adminDb
      .doc(emailIndexPath("synthetic.joined@example.org"))
      .set({ ...standard(), personIds: ["person-joined-later"], claimEligiblePersonIds: [] });
    // A match by name for the second contact waits in the queue.
    await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("item-in-review")).set({
      ...standard(),
      kind: "duplicatePerson",
      entityRefs: [],
      sourceKey: "f",
      candidates: [{ key: "f/synthetictab:0123456789ab", sourceRecordId: "record-contact-in-review" }],
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: BATCH,
      sealed: false,
    });
    const verifiedAt = new Date("2027-03-01T00:00:00Z");
    const swept = await sweepRetention(
      adminDb,
      { retention: {}, migrationVerifiedAt: verifiedAt },
      new Date(verifiedAt.getTime() + 1_200 * DAY),
      false,
      emailIndexResolver(adminDb, () => DEMO_IDENTITY_HASH_KEY),
    );
    expect(outcomeOf(swept)).toMatchObject({ eligible: 1, deleted: 1 });
    expect(outcomeOf(swept)?.note).toContain("2 contacts were kept");
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-joined-later"))).toBe(true);
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-in-review"))).toBe(true);
    expect(await exists(COLLECTIONS.outreachContacts.docPath("contact-outsider"))).toBe(false);
  });

  it("is started by an administrator with the second factor, with an audit entry, and moves only later", async () => {
    await settings();
    const core = await coreTeamMember("uid-core");
    expect(await codeOf(call(core, markMigrationVerifiedContract, { note: "A synthetic verification." }))).toBe(
      "permission-denied",
    );
    const withoutFactor = await administrator("uid-admin-no-factor", { secondFactor: false });
    expect(
      await codeOf(call(withoutFactor, markMigrationVerifiedContract, { note: "A synthetic verification." })),
    ).toBe("failed-precondition");
    const admin = await administrator("uid-admin");
    const before = await call(admin, getRetentionContract, {});
    expect(before.migration).toMatchObject({ verifiedAt: null, verifiedBy: null, deletableFrom: null });
    const marked = await call(admin, markMigrationVerifiedContract, { note: "A synthetic verification." });
    expect(marked.verifiedAt).not.toBeNull();
    expect(marked.verifiedBy).toBe("uid-admin");
    const deletable = new Date(marked.deletableFrom ?? "");
    const verified = new Date(marked.verifiedAt ?? "");
    expect(deletable.getUTCFullYear() - verified.getUTCFullYear()).toBe(3);
    expect(deletable.toISOString().slice(4)).toBe(verified.toISOString().slice(4));
    const stored = await dataOf(COLLECTIONS.systemSettings.docPath());
    expect(stored?.migrationVerifiedBy).toBe("uid-admin");
    const [entry] = await auditOf("migration.verified");
    expect(JSON.stringify(entry)).toContain("docs/MIGRATION_PLAN.md, section 11, question 21");
    expect((await call(admin, getRetentionContract, {})).migration).toEqual(marked);
    // A second mark moves the start of the three years later, never earlier, with an audit entry of its own.
    const moved = await call(admin, markMigrationVerifiedContract, { note: "The first mark was premature." });
    expect(new Date(moved.verifiedAt ?? "").getTime()).toBeGreaterThan(verified.getTime());
    expect(await auditOf("migration.verified")).toHaveLength(2);
  });
});
