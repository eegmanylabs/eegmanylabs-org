// Integration tests of what the governance functions reach beyond their first slice
// (docs/SECURITY.md, sections 2 and 6): the two-person rules against a chain of appointments, the
// sources of access that the access review lists, the trail that demographic aggregates leave,
// the third-party values of a subject access export, and what an erasure does to contributor
// rows, authorship entries, former accounts and the public listing.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain.
import {
  COLLECTIONS,
  capabilityGrantId,
  decideErasureContract,
  exportPersonDataContract,
  getAccessReviewContract,
  getDemographicAggregatesContract,
  PROGRAMME_KEY,
  requestErasureContract,
  roleAssignmentId,
  setCapabilityGrantContract,
  setRoleAssignmentContract,
  setRoleCapabilityOverrideContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminAuth, adminDb } from "../support/admin";
import {
  account,
  administrator,
  call,
  codeOf,
  grantCapability,
  laboratory,
  person,
  resetWorld,
  standard,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const DAY = 86_400_000;

async function appoint(by: { uid: string }, uid: string) {
  return call({ ...by, email: `${by.uid}@example.org`, secondFactor: true }, setRoleAssignmentContract, {
    action: "grant",
    uid,
    role: "programme_admin",
    scopeType: "programme",
    scopeId: PROGRAMME_KEY,
    reason: "Synthetic appointment",
  });
}

const adminPath = (uid: string) =>
  COLLECTIONS.roleAssignments.docPath(roleAssignmentId(uid, "programme_admin", "programme", PROGRAMME_KEY));

describe("the two-person rules against a chain of appointments", () => {
  it("refuse a sensitive grant between an administrator and the one they have just appointed, both ways", async () => {
    const first = await administrator("uid-chain-first");
    await account("uid-chain-second", { mfaEnrolled: true });
    await appoint(first, "uid-chain-second");
    const second = { uid: "uid-chain-second", email: "uid-chain-second@example.org", secondFactor: true };
    const grant = (uid: string) => ({
      action: "grant" as const,
      uid,
      capability: "demographics.read" as const,
      reason: "Synthetic grant",
      expiresAt: new Date(Date.now() + DAY).toISOString(),
    });
    expect(await codeOf(call(second, setCapabilityGrantContract, grant("uid-chain-first")))).toBe("permission-denied");
    expect(await codeOf(call(first, setCapabilityGrantContract, grant("uid-chain-second")))).toBe("permission-denied");
  });

  it("follow the chain through an administrator the first one appointed", async () => {
    const first = await administrator("uid-chain-first");
    await account("uid-chain-second", { mfaEnrolled: true });
    await account("uid-chain-third", { mfaEnrolled: true });
    await appoint(first, "uid-chain-second");
    await appoint({ uid: "uid-chain-second" }, "uid-chain-third");
    await person("person-chain", [], { displayName: "Chain Synthetic" });
    const { requestId } = await call(first, requestErasureContract, { personId: "person-chain", reason: "Synthetic" });
    const third = { uid: "uid-chain-third", email: "uid-chain-third@example.org", secondFactor: true };
    expect(await codeOf(call(third, decideErasureContract, { requestId, decision: "approve", note: null }))).toBe(
      "permission-denied",
    );
  });

  it("let an appointee decide once the cool-off period has passed", async () => {
    const first = await administrator("uid-chain-first");
    await account("uid-chain-second", { mfaEnrolled: true });
    await appoint(first, "uid-chain-second");
    await adminDb.doc(adminPath("uid-chain-second")).update({ grantedAt: Timestamp.fromMillis(Date.now() - 15 * DAY) });
    await person("person-chain", [], { displayName: "Chain Synthetic" });
    const { requestId } = await call(first, requestErasureContract, { personId: "person-chain", reason: "Synthetic" });
    const second = { uid: "uid-chain-second", email: "uid-chain-second@example.org", secondFactor: true };
    expect((await call(second, decideErasureContract, { requestId, decision: "approve", note: null })).status).toBe(
      "applied",
    );
  });
});

describe("the access review", () => {
  it("names who appointed a role, lists the overrides and a confirmed team, and hashes all of them", async () => {
    const admin = await administrator("uid-review-admin");
    await account("uid-review-team");
    await adminDb
      .doc(COLLECTIONS.access.docPath("uid-review-team"))
      .update({ teamReplicationIds: ["ReviewStudy2001"] });
    const before = await call(admin, getAccessReviewContract, {});
    const team = before.accounts.find((entry) => entry.uid === "uid-review-team");
    expect(team?.teamReplicationIds).toEqual(["ReviewStudy2001"]);
    expect(before.accounts.find((entry) => entry.uid === "uid-review-admin")?.roles[0]?.grantedBy).toBe("system:test");
    expect(before.truncated).toBe(false);

    await call(admin, setRoleCapabilityOverrideContract, {
      role: "lab_member",
      capability: "people.contact.read",
      allowed: true,
    });
    const after = await call(admin, getAccessReviewContract, {});
    expect(after.overrides).toEqual([{ role: "lab_member", capability: "people.contact.read", allowed: true }]);
    expect(after.listingSha256).not.toBe(before.listingSha256);
  });

  it("leaves revoked grants out", async () => {
    const admin = await administrator("uid-review-admin");
    await account("uid-review-former");
    await grantCapability("uid-review-former", "demographics.read");
    await adminDb
      .doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId("uid-review-former", "demographics.read")))
      .update({ revokedAt: Timestamp.now(), revokedBy: "system:test" });
    const review = await call(admin, getAccessReviewContract, {});
    expect(review.accounts.map((entry) => entry.uid)).not.toContain("uid-review-former");
  });
});

describe("the demographic aggregates", () => {
  it("leave a trail on each person they count, so that reading before and after one person joins is traced", async () => {
    await laboratory("lab-trail");
    const seed = async (id: string, category: string) => {
      await person(id, [], { laboratoryIds: ["lab-trail"] });
      await adminDb
        .doc(COLLECTIONS.personDemographics.docPath(id))
        .set({ ...standard(), genderCategory: category, recordedAt: Timestamp.now() });
    };
    for (let index = 0; index < 5; index += 1) {
      await seed(`person-trail-a-${index}`, "syntheticCategoryA");
      await seed(`person-trail-b-${index}`, "syntheticCategoryB");
    }
    const reader = await administrator("uid-trail-reader");
    await grantCapability(reader.uid, "demographics.read");
    const read = () =>
      call(reader, getDemographicAggregatesContract, {
        field: "genderCategory",
        scopeType: "laboratory",
        scopeId: "lab-trail",
      });
    expect((await read()).cells.length).toBeGreaterThan(0);
    await seed("person-trail-joined", "syntheticCategoryA");
    expect((await read()).overlapWithheld).toBe(false);
    const trail = await adminDb
      .collection(COLLECTIONS.auditEvents.collectionPath())
      .where("entityId", "==", "person-trail-joined")
      .get();
    expect(trail.docs.map((entry) => entry.get("action"))).toEqual(["demographics.aggregateIncluded"]);
    expect(JSON.stringify(trail.docs[0]?.data())).not.toContain("syntheticCategoryA");
  });
});

describe("the subject access export", () => {
  it("keeps the values of the subject's actions on their own record", async () => {
    const admin = await administrator("uid-export-admin");
    await person("person-export-subject", [], { displayName: "Subject Synthetic", userId: "uid-export-subject" });
    await account("uid-export-subject", { personId: "person-export-subject" });
    await adminDb.doc(COLLECTIONS.auditEvents.docPath("event-export-own")).set({
      schemaVersion: 1,
      createdAt: Timestamp.now(),
      createdBy: "uid-export-subject",
      writeContext: { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      actorUid: "uid-export-subject",
      actorKind: "user",
      action: "person.updated",
      documentPath: "persons/person-export-subject",
      entityType: "person",
      entityId: "person-export-subject",
      changes: [{ field: "displayName", before: "Subject Former Synthetic", after: "Subject Synthetic" }],
      context: {
        origin: "user",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
    });
    const exported = await call(admin, exportPersonDataContract, { personId: "person-export-subject" });
    expect(JSON.stringify(exported.documents)).toContain("Subject Former Synthetic");
  });
});

describe("an erasure", () => {
  async function erase(personId: string) {
    const first = await administrator("uid-erase-first");
    const second = await administrator("uid-erase-second");
    const { requestId } = await call(first, requestErasureContract, { personId, reason: "Synthetic request" });
    return call(second, decideErasureContract, { requestId, decision: "approve", note: null });
  }

  it("anonymises authorship entries and keeps the names of a published author list without the link", async () => {
    await person("person-erase-author", [], { displayName: "Author Synthetic", publicListing: "listed" });
    await adminDb.doc(COLLECTIONS.manuscripts.docPath("manuscript-erase-published")).set({
      ...standard(),
      status: "published",
    });
    await adminDb.doc(COLLECTIONS.contributors.docPath("contributor-erase-published")).set({
      ...standard(),
      surnameSource: "Synthetic",
      creditRoles: {},
      reviewStatus: "accepted",
      replicationId: null,
      manuscriptId: "manuscript-erase-published",
      contributorTableId: "table-erase",
      personId: "person-erase-author",
      scopeKeys: ["members"],
    });
    await adminDb.doc(COLLECTIONS.authorshipEntries.docPath("manuscript-erase-draft", "person-erase-author")).set({
      ...standard(),
      manuscriptId: "manuscript-erase-draft",
      personId: "person-erase-author",
      contributorId: null,
      kind: "author",
      position: 1,
      displayName: "Author Synthetic",
      affiliations: ["Institute of Invented Studies"],
      orcid: "0000-0002-1825-0097",
      creditRoles: [],
      contributionRoles: [],
      isCorresponding: false,
      entryRevision: 1,
      confirmation: { status: "pending", revision: 0, respondedAt: null },
      replicationId: null,
      laboratoryId: null,
      scopeKeys: ["members"],
    });
    const decided = await erase("person-erase-author");
    expect(decided.appliedCounts).toMatchObject({
      contributorRowsUnlinked: 1,
      authorshipEntriesAnonymised: 1,
      publicListingRemoved: 1,
    });
    const row = (await adminDb.doc(COLLECTIONS.contributors.docPath("contributor-erase-published")).get()).data();
    expect(row).toMatchObject({ personId: null, surnameSource: "Synthetic" });
    const entry = (
      await adminDb.doc(COLLECTIONS.authorshipEntries.docPath("manuscript-erase-draft", "person-erase-author")).get()
    ).data();
    expect(entry).toMatchObject({ displayName: "Erased person", affiliations: [] });
    expect(entry?.orcid).toBeUndefined();
  });

  it("deletes an account that was once linked to the person, with its profile and notifications", async () => {
    await person("person-erase-former", [], { displayName: "Former Synthetic" });
    await adminAuth.createUser({ uid: "uid-erase-former", email: "former.synthetic@example.org" });
    await account("uid-erase-former", { email: "former.synthetic@example.org" });
    await adminDb.doc(COLLECTIONS.userNotifications.docPath("uid-erase-former", "notification-1")).set(standard());
    await adminDb.doc(COLLECTIONS.auditEvents.docPath("event-erase-unlinked")).set({
      schemaVersion: 1,
      createdAt: Timestamp.now(),
      createdBy: "system:test",
      writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
      actorUid: null,
      actorKind: "system",
      action: "claim.unlinked",
      documentPath: "persons/person-erase-former",
      entityType: "person",
      entityId: "person-erase-former",
      changes: [{ field: "userId", before: "uid-erase-former", after: null }],
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
    const decided = await erase("person-erase-former");
    expect(decided.appliedCounts).toMatchObject({ accountsDeleted: 1 });
    expect((await adminDb.doc(COLLECTIONS.users.docPath("uid-erase-former")).get()).exists).toBe(false);
    expect(
      (await adminDb.doc(COLLECTIONS.userNotifications.docPath("uid-erase-former", "notification-1")).get()).exists,
    ).toBe(false);
    expect(
      await adminAuth.getUserByEmail("former.synthetic@example.org").then(
        () => "found",
        () => "gone",
      ),
    ).toBe("gone");
  });

  it("keeps a former account that now belongs to another person", async () => {
    await person("person-erase-kept", [], { displayName: "Kept Synthetic" });
    await person("person-erase-other", [], { displayName: "Other Synthetic", userId: "uid-erase-kept" });
    await account("uid-erase-kept", { personId: "person-erase-other" });
    await adminDb.doc(COLLECTIONS.accountClaims.docPath("uid-erase-kept")).set({
      ...standard(),
      uid: "uid-erase-kept",
      status: "approved",
      personId: "person-erase-kept",
      submittedAt: Timestamp.now(),
    });
    const decided = await erase("person-erase-kept");
    expect(decided.appliedCounts).toMatchObject({ accountsKept: 1 });
    expect((await adminDb.doc(COLLECTIONS.users.docPath("uid-erase-kept")).get()).exists).toBe(true);
  });
});
