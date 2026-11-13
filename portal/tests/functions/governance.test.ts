// Integration tests of the governance functions (docs/SECURITY.md, section 6): the subject
// access export, erasure with a second administrator, the access review with its attestations
// and the retention sweeps. Fixtures are synthetic: fictitious people on the example.org domain.
import {
  attestAccessReviewContract,
  COLLECTIONS,
  decideErasureContract,
  exportPersonDataContract,
  getAccessReviewContract,
  getRetentionContract,
  listErasureRequestsContract,
  requestErasureContract,
  runRetentionSweepContract,
  setRetentionPeriodContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminAuth, adminDb } from "../support/admin";
import { recordConsent } from "../support/consent";
import {
  account,
  administrator,
  auditOf,
  call,
  codeOf,
  coreTeamMember,
  emailIndexPath,
  grantCapability,
  grantRole,
  person,
  refusal,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const DAY = 86_400_000;

async function settings(retention: Record<string, number> = {}): Promise<void> {
  await adminDb
    .doc(COLLECTIONS.systemSettings.docPath())
    .set({ ...standard(), featureFlags: {}, maintenanceMode: false, listLimit: 200, retention });
}

async function demographics(personId: string): Promise<void> {
  await adminDb.doc(COLLECTIONS.personDemographics.docPath(personId)).set({
    ...standard(),
    genderSource: "Synthetic gender term",
    ethnicitySource: "Synthetic ethnicity term",
    recordedAt: Timestamp.now(),
  });
}

describe("exportPersonData", () => {
  it("gives a programme administrator everything about a person and audits the export without a value", async () => {
    const admin = await administrator("uid-admin");
    await person("person-ada", [{ email: "ada.synthetic@example.org" }], { displayName: "Ada Synthetic" });
    await adminAuth.createUser({ uid: "uid-ada", email: "ada.synthetic@example.org", emailVerified: true });
    await account("uid-ada", { email: "ada.synthetic@example.org", personId: "person-ada" });
    await demographics("person-ada");

    const exported = await call(admin, exportPersonDataContract, { personId: "person-ada" });
    const paths = exported.documents.map((document) => document.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "persons/person-ada",
        "persons/person-ada/private/contact",
        "users/uid-ada",
        "access/uid-ada",
      ]),
    );
    expect(exported.specialCategoryIncluded).toBe(false);
    expect(paths).not.toContain("persons/person-ada/special/demographics");
    expect(exported.accounts).toEqual([
      expect.objectContaining({ uid: "uid-ada", email: "ada.synthetic@example.org" }),
    ]);

    const [entry] = await auditOf("person.dataExported", "person-ada");
    expect(entry?.actorUid).toBe("uid-admin");
    expect(JSON.stringify(entry)).not.toContain("example.org");
    expect(entry?.changes).toContainEqual({ field: "specialCategoryIncluded", after: false });
  });

  it("includes special-category data only under the caller's own named grant, and only while consent is in force", async () => {
    const admin = await administrator("uid-admin");
    await person("person-ada");
    await demographics("person-ada");
    await grantCapability("uid-admin", "demographics.read");
    // Values that a race left behind without consent are never handed out, whatever the grant.
    const withoutConsent = await call(admin, exportPersonDataContract, { personId: "person-ada" });
    expect(withoutConsent.documents.map((document) => document.path)).not.toContain(
      "persons/person-ada/special/demographics",
    );
    await recordConsent("person-ada");
    const exported = await call(admin, exportPersonDataContract, { personId: "person-ada" });
    expect(exported.specialCategoryIncluded).toBe(true);
    expect(exported.documents.map((document) => document.path)).toContain("persons/person-ada/special/demographics");
  });

  it("refuses the core team, an administrator without the second factor and an ordinary member", async () => {
    await person("person-ada");
    const core = await coreTeamMember("uid-core");
    const noFactor = await administrator("uid-admin", { secondFactor: false });
    const member = await account("uid-member");
    for (const caller of [core, noFactor, member]) {
      expect(await codeOf(call(caller, exportPersonDataContract, { personId: "person-ada" }))).toMatch(
        /permission-denied|failed-precondition/,
      );
    }
    expect(await auditOf("person.dataExported")).toEqual([]);
  });
});

describe("erasure", () => {
  async function erasable() {
    await person("person-eve", [{ email: "eve.synthetic@example.org" }], {
      displayName: "Eve Synthetic",
      givenName: "Eve",
      familyName: "Synthetic",
      sourceRecordIds: ["record-eve"],
    });
    await adminDb
      .doc(COLLECTIONS.personAddress.docPath("person-eve"))
      .set({ ...standard(), postalAddress: "1 Synthetic Street" });
    await demographics("person-eve");
    await adminDb.doc(COLLECTIONS.sourceRecords.docPath("record-eve")).set({
      ...standard(),
      sourceKey: "g",
      tabKey: "members",
      rowKey: "row-eve",
      raw: { Name: "Eve Synthetic", Email: "eve.synthetic@example.org" },
      rawHash: "0123456789abcdef",
      observedOn: "2026-11-01",
      firstSeenBatchId: "batch-1",
      lastSeenBatchId: "batch-1",
      supersededById: null,
    });
    await adminDb.doc(COLLECTIONS.auditEvents.docPath("event-about-eve")).set({
      schemaVersion: 1,
      createdAt: Timestamp.now(),
      createdBy: "system:test",
      writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      actorUid: null,
      actorKind: "system",
      action: "person.created",
      documentPath: "persons/person-eve",
      entityType: "person",
      entityId: "person-eve",
      changes: [{ field: "displayName", after: "Eve Synthetic" }],
      context: {
        origin: "system",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
    });
  }

  it("is approved by a second administrator, erases what is personal and keeps the audit trail", async () => {
    const first = await administrator("uid-first");
    const second = await administrator("uid-second");
    await erasable();
    const { requestId } = await call(first, requestErasureContract, {
      personId: "person-eve",
      reason: "Synthetic request",
    });
    expect(await codeOf(call(first, decideErasureContract, { requestId, decision: "approve", note: null }))).toBe(
      "permission-denied",
    );
    const decided = await call(second, decideErasureContract, { requestId, decision: "approve", note: null });
    expect(decided.status).toBe("applied");
    expect(decided.appliedCounts).toMatchObject({ person: 1, restrictedDocuments: 3, sourceRecordsMarked: 1 });

    const directory = (await adminDb.doc(COLLECTIONS.persons.docPath("person-eve")).get()).data();
    expect(directory).toMatchObject({ displayName: "Erased person", publicListing: "none" });
    expect(directory?.givenName).toBeUndefined();
    expect(directory?.archivedAt).not.toBeNull();
    for (const path of [
      COLLECTIONS.personContact.docPath("person-eve"),
      COLLECTIONS.personAddress.docPath("person-eve"),
      COLLECTIONS.personDemographics.docPath("person-eve"),
      emailIndexPath("eve.synthetic@example.org"),
    ]) {
      expect((await adminDb.doc(path).get()).exists, path).toBe(false);
    }
    const record = (await adminDb.doc(COLLECTIONS.sourceRecords.docPath("record-eve")).get()).data();
    expect(record?.raw).toEqual({ Name: "[erased]", Email: "[erased]" });

    // Every entry stays, readable, with the values about the person withheld.
    const kept = (await adminDb.doc(COLLECTIONS.auditEvents.docPath("event-about-eve")).get()).data();
    expect(kept?.changes).toEqual([{ field: "displayName", withheld: true }]);
    expect(await auditOf("erasure.requested", "person-eve")).toHaveLength(1);
    expect(await auditOf("erasure.approved", "person-eve")).toHaveLength(1);
    expect(JSON.stringify(await auditOf("erasure.requested", "person-eve"))).not.toContain("Synthetic request");

    const listed = await call(first, listErasureRequestsContract, {});
    expect(listed.requests).toEqual([
      expect.objectContaining({ requestId, status: "applied", decidedBy: "uid-second" }),
    ]);
  });

  it("is refused for a person linked to an account, twice over, and by the core team", async () => {
    const admin = await administrator("uid-admin");
    const core = await coreTeamMember("uid-core");
    await person("person-lin", [], { userId: "uid-lin" });
    expect(
      (await refusal(call(admin, requestErasureContract, { personId: "person-lin", reason: "Synthetic" }))).message,
    ).toMatch(/linked to an account/);
    await person("person-two");
    await call(admin, requestErasureContract, { personId: "person-two", reason: "Synthetic" });
    expect(await codeOf(call(admin, requestErasureContract, { personId: "person-two", reason: "Synthetic" }))).toBe(
      "already-exists",
    );
    expect(await codeOf(call(core, requestErasureContract, { personId: "person-two", reason: "Synthetic" }))).toBe(
      "permission-denied",
    );
  });

  it("changes nothing when rejected", async () => {
    const first = await administrator("uid-first");
    const second = await administrator("uid-second");
    await erasable();
    const { requestId } = await call(first, requestErasureContract, { personId: "person-eve", reason: "Synthetic" });
    expect(await call(second, decideErasureContract, { requestId, decision: "reject", note: "Kept" })).toEqual({
      status: "rejected",
      appliedCounts: {},
    });
    expect((await adminDb.doc(COLLECTIONS.persons.docPath("person-eve")).get()).get("displayName")).toBe(
      "Eve Synthetic",
    );
    expect((await adminDb.doc(COLLECTIONS.personAddress.docPath("person-eve")).get()).exists).toBe(true);
  });
});

describe("the access review", () => {
  it("lists roles, grants, sign-ins and expiring grants, and records an attestation bound to the listing", async () => {
    const admin = await administrator("uid-admin");
    await adminAuth.createUser({ uid: "uid-admin", email: "admin.synthetic@example.org" });
    await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", "SyntheticStudy2001");
    await grantCapability("uid-lead", "demographics.read", new Date(Date.now() + 5 * DAY));

    const review = await call(admin, getAccessReviewContract, {});
    expect(review.period).toMatch(/^\d{4}-Q[1-4]$/);
    const lead = review.accounts.find((entry) => entry.uid === "uid-lead");
    expect(lead?.roles).toEqual([expect.objectContaining({ role: "replication_lead", scopeId: "SyntheticStudy2001" })]);
    expect(lead?.grants).toEqual([
      expect.objectContaining({ kind: "capability", name: "demographics.read", expiringSoon: true }),
    ]);
    expect(review.attestations).toEqual([]);

    const attested = await call(admin, attestAccessReviewContract, {
      period: review.period,
      listingSha256: review.listingSha256,
      note: "Checked the synthetic listing.",
    });
    expect(attested.period).toBe(review.period);
    const again = await call(admin, getAccessReviewContract, {});
    expect(again.attestations).toEqual([
      expect.objectContaining({ reviewerUid: "uid-admin", matchesCurrentListing: true }),
    ]);
    expect(await auditOf("accessReview.attested")).toHaveLength(1);

    // A right that changes after the review was opened makes an attestation of the old listing fail.
    await grantRole("uid-lead", "lab_coordinator", "laboratory", "lab-synthetic");
    expect(
      (
        await refusal(
          call(admin, attestAccessReviewContract, {
            period: review.period,
            listingSha256: review.listingSha256,
            note: null,
          }),
        )
      ).message,
    ).toMatch(/changed since the review was opened/);
  });

  it("is refused to the core team and to an ordinary member", async () => {
    for (const caller of [await coreTeamMember("uid-core"), await account("uid-member")]) {
      expect(await codeOf(call(caller, getAccessReviewContract, {}))).toBe("permission-denied");
    }
  });
});

describe("retention sweeps", () => {
  async function oldMail(id: string, status: "sent" | "queued", ageDays: number): Promise<void> {
    const at = Timestamp.fromMillis(Date.now() - ageDays * DAY);
    await adminDb.doc(COLLECTIONS.mail.docPath(id)).set({
      ...standard(at),
      toAddress: "someone@example.org",
      subject: "Synthetic message",
      textBody: "A synthetic body.",
      templateKey: "claimDecision",
      status,
      attempts: 1,
      sentAt: status === "sent" ? at : null,
    });
  }

  it("deletes nothing without a configured period, and says so", async () => {
    const admin = await administrator("uid-admin");
    await settings();
    await oldMail("mail-old", "sent", 400);
    const run = await call(admin, runRetentionSweepContract, { dryRun: false });
    // The configurable targets have no period. The raw material of the migration follows the programme's decision,
    // which deletes nothing while the migration is not marked verified.
    const configurable = run.outcomes.filter((outcome) => outcome.target !== "outreachNeverJoined");
    expect(configurable.every((outcome) => outcome.deleted === 0 && outcome.periodDays === null)).toBe(true);
    expect(run.outcomes[0]?.note).toMatch(/No period is configured/);
    expect(run.outcomes.find((outcome) => outcome.target === "outreachNeverJoined")).toMatchObject({
      decision: { reference: "docs/MIGRATION_PLAN.md, section 11, question 21" },
      deleted: 0,
    });
    expect((await adminDb.doc(COLLECTIONS.mail.docPath("mail-old")).get()).exists).toBe(true);
    expect(await auditOf("retention.swept")).toHaveLength(1);
  });

  it("deletes finished documents older than a configured period, after a dry run that deletes nothing", async () => {
    const admin = await administrator("uid-admin");
    await settings();
    await oldMail("mail-old", "sent", 40);
    await oldMail("mail-waiting", "queued", 40);
    await oldMail("mail-new", "sent", 2);
    const set = await call(admin, setRetentionPeriodContract, { target: "mail", days: 30 });
    expect(set.periods.mail).toBe(30);
    expect(set.periods.activity).toBeNull();

    const dry = await call(admin, runRetentionSweepContract, { dryRun: true });
    expect(dry.outcomes.find((outcome) => outcome.target === "mail")).toMatchObject({ eligible: 1, deleted: 0 });
    expect((await adminDb.doc(COLLECTIONS.mail.docPath("mail-old")).get()).exists).toBe(true);

    const run = await call(admin, runRetentionSweepContract, { dryRun: false });
    expect(run.outcomes.find((outcome) => outcome.target === "mail")).toMatchObject({ periodDays: 30, deleted: 1 });
    expect((await adminDb.doc(COLLECTIONS.mail.docPath("mail-old")).get()).exists).toBe(false);
    expect((await adminDb.doc(COLLECTIONS.mail.docPath("mail-waiting")).get()).exists).toBe(true);
    expect((await adminDb.doc(COLLECTIONS.mail.docPath("mail-new")).get()).exists).toBe(true);

    const overview = await call(admin, getRetentionContract, {});
    expect(overview.runs.map((entry) => entry.dryRun)).toEqual([false, true]);
    expect(await auditOf("retention.settingsChanged")).toHaveLength(1);
  });

  it("refuses a period shorter than a week and a caller who is no administrator", async () => {
    const admin = await administrator("uid-admin");
    await settings();
    expect(await codeOf(call(admin, setRetentionPeriodContract, { target: "mail", days: 1 }))).toBe("invalid-argument");
    expect(await codeOf(call(await coreTeamMember("uid-core"), runRetentionSweepContract, { dryRun: true }))).toBe(
      "permission-denied",
    );
  });
});
