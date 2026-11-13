// Final red-team attacks on the governance functions of phase 10 and on chains of rights that
// span phases, made through the functions emulator: the access review, the subject access
// export, erasure with a second administrator, and the demographic aggregates of the analysis
// views read across two overlapping scopes.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain, and
// invented category labels.
import {
  COLLECTIONS,
  decideErasureContract,
  exportPersonDataContract,
  getAccessReviewContract,
  getDemographicAggregatesContract,
  groupScopeKey,
  PROGRAMME_KEY,
  requestErasureContract,
  roleAssignmentId,
  setRoleAssignmentContract,
  setRoleCapabilityOverrideContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../../support/admin";
import {
  accessOf,
  account,
  administrator,
  call,
  codeOf,
  grantCapability,
  grantRole,
  laboratory,
  person,
  rebuild,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

withoutTriggers();
beforeEach(resetWorld);

const auditEntry = (fields: Record<string, unknown>) => ({
  schemaVersion: 1,
  createdAt: Timestamp.now(),
  createdBy: "system:test",
  writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
  context: {
    origin: "system",
    depth: 0,
    correlationId: null,
    causationId: null,
    requestId: null,
    ipHash: null,
    userAgent: null,
  },
  ...fields,
});

describe("the access review", () => {
  it("lists an account whose access comes from the membership of a group", async () => {
    const admin = await administrator("uid-final-review-admin");
    await account("uid-final-group-member");
    await adminDb.doc(COLLECTIONS.groups.docPath("final-synthetic-group")).set({
      ...standard(),
      groupKey: "final-synthetic-group",
      kind: "workingGroup",
      name: "Synthetic working group",
      replicationId: null,
      laboratoryId: null,
      pageId: null,
      memberUids: ["uid-final-group-member"],
      roles: { "uid-final-group-member": "member" },
      unclaimedPersonIds: [],
    });
    await rebuild("uid-final-group-member");
    // The account now reads whatever is shared with the group.
    expect((await accessOf("uid-final-group-member")).scopeKeys).toContain(groupScopeKey("final-synthetic-group"));

    const review = await call(admin, getAccessReviewContract, {});
    expect(review.accounts.map((entry) => entry.uid)).toContain("uid-final-group-member");
  });

  it("invalidates an attestation when an override widens what every holder of a role may do", async () => {
    const admin = await administrator("uid-final-review-admin");
    await laboratory("lab-final-review");
    await account("uid-final-lab-member");
    await grantRole("uid-final-lab-member", "lab_member", "laboratory", "lab-final-review");
    const before = await call(admin, getAccessReviewContract, {});

    await call(admin, setRoleCapabilityOverrideContract, {
      role: "lab_member",
      capability: "people.contact.read",
      allowed: true,
    });
    await rebuild("uid-final-lab-member");
    const after = await call(admin, getAccessReviewContract, {});
    // Every laboratory member may now read the contact details of the laboratory's people, and
    // an attestation of the earlier listing would still be accepted as current.
    expect(after.listingSha256).not.toBe(before.listingSha256);
  });
});

describe("the four eyes of erasure and of special-category grants", () => {
  it("refuses an erasure approved by an administrator whom the requester has just appointed", async () => {
    const first = await administrator("uid-final-first-admin");
    // A second account of the same person, or of anyone the first administrator chooses.
    await account("uid-final-appointee", { mfaEnrolled: true });
    await call(first, setRoleAssignmentContract, {
      action: "grant",
      uid: "uid-final-appointee",
      role: "programme_admin",
      scopeType: "programme",
      scopeId: PROGRAMME_KEY,
      reason: "Synthetic appointment",
    });
    expect(
      (
        await adminDb
          .doc(
            COLLECTIONS.roleAssignments.docPath(
              roleAssignmentId("uid-final-appointee", "programme_admin", "programme", PROGRAMME_KEY),
            ),
          )
          .get()
      ).get("grantedBy"),
    ).toBe("uid-final-first-admin");
    const appointee = { uid: "uid-final-appointee", email: "uid-final-appointee@example.org", secondFactor: true };
    await person("person-final-erasable", [{ email: "erasable.synthetic@example.org" }], {
      displayName: "Erasable Synthetic",
    });
    const { requestId } = await call(first, requestErasureContract, {
      personId: "person-final-erasable",
      reason: "Synthetic request",
    });
    expect(await codeOf(call(appointee, decideErasureContract, { requestId, decision: "approve", note: null }))).toBe(
      "permission-denied",
    );
  });
});

describe("erasure across the scientific record", () => {
  it("leaves no member-readable record that links the erased person to their former name", async () => {
    const first = await administrator("uid-final-first-admin");
    const second = await administrator("uid-final-second-admin");
    await person("person-final-author", [{ email: "author.synthetic@example.org" }], {
      displayName: "Author Synthetic",
      givenName: "Author",
      familyName: "Synthetic",
    });
    await adminDb.doc(COLLECTIONS.contributors.docPath("contributor-final-author")).set({
      ...standard(),
      firstNameSource: "Author",
      surnameSource: "Synthetic",
      orcid: "0000-0002-1825-0097",
      affiliationSource: "Synthetic University",
      creditRoles: {},
      reviewStatus: "accepted",
      replicationId: null,
      manuscriptId: null,
      contributorTableId: "table-final",
      personId: "person-final-author",
      scopeKeys: ["members"],
    });
    const { requestId } = await call(first, requestErasureContract, {
      personId: "person-final-author",
      reason: "Synthetic request",
    });
    expect((await call(second, decideErasureContract, { requestId, decision: "approve", note: null })).status).toBe(
      "applied",
    );
    const row = (await adminDb.doc(COLLECTIONS.contributors.docPath("contributor-final-author")).get()).data();
    const linked = row?.personId === "person-final-author";
    const named = row?.surnameSource === "Synthetic" || row?.orcid === "0000-0002-1825-0097";
    // "Erased person" is re-identified by following the identifier of the directory entry.
    expect(linked && named).toBe(false);
  });
});

describe("the subject access export", () => {
  it("does not hand the data subject the values of other people taken from the audit trail", async () => {
    const admin = await administrator("uid-final-export-admin");
    await person("person-final-subject", [], { displayName: "Subject Synthetic", userId: "uid-final-subject" });
    await account("uid-final-subject", { personId: "person-final-subject" });
    await person("person-final-third", [], { displayName: "Third Party Synthetic" });
    // The subject, as a coordinator, once corrected the name of another person.
    await adminDb.doc(COLLECTIONS.auditEvents.docPath("event-final-third-renamed")).set(
      auditEntry({
        actorUid: "uid-final-subject",
        actorKind: "user",
        action: "person.updated",
        documentPath: "persons/person-final-third",
        entityType: "person",
        entityId: "person-final-third",
        changes: [{ field: "displayName", before: "Third Party Former Synthetic", after: "Third Party Synthetic" }],
      }),
    );
    const exported = await call(admin, exportPersonDataContract, { personId: "person-final-subject" });
    expect(JSON.stringify(exported.documents)).not.toContain("Third Party Former Synthetic");
  });
});

describe("the demographic aggregates of two overlapping scopes", () => {
  it("do not give away the value of the one person by which a replication differs from a laboratory", async () => {
    const STUDY = "FinalSyntheticStudy2001";
    await replication(STUDY);
    await laboratory("lab-final-large");
    await laboratory("lab-final-lone");
    const seed = async (id: string, laboratoryId: string, category: string) => {
      await person(id, [], { laboratoryIds: [laboratoryId], replicationIds: [STUDY] });
      await adminDb
        .doc(COLLECTIONS.personDemographics.docPath(id))
        .set({ ...standard(), genderCategory: category, recordedAt: Timestamp.now() });
    };
    for (let index = 0; index < 5; index += 1) {
      await seed(`person-final-a-${index}`, "lab-final-large", "syntheticCategoryA");
      await seed(`person-final-b-${index}`, "lab-final-large", "syntheticCategoryB");
    }
    await seed("person-final-lone", "lab-final-lone", "syntheticCategoryA");

    const reader = await administrator("uid-final-demographics-reader");
    await grantCapability(reader.uid, "demographics.read");
    const read = (scopeType: "replication" | "laboratory", scopeId: string) =>
      call(reader, getDemographicAggregatesContract, { field: "genderCategory", scopeType, scopeId });
    const wide = await read("replication", STUDY);
    const narrow = await read("laboratory", "lab-final-large");
    const lone = await read("laboratory", "lab-final-lone");
    // The laboratory of one person releases nothing on its own...
    expect(lone.cells).toEqual([]);
    // ...but the two releases that do pass suppression differ by exactly that person.
    const countOf = (release: typeof wide, category: string) =>
      release.cells.find((cell) => cell.category === category)?.count ?? null;
    const differences = ["syntheticCategoryA", "syntheticCategoryB"].map((category) => {
      const a = countOf(wide, category);
      const b = countOf(narrow, category);
      return a === null || b === null ? null : a - b;
    });
    expect(differences).not.toEqual([1, 0]);
    // The audit trail records two reads of scopes and never names the person.
    const named = await adminDb
      .collection(COLLECTIONS.auditEvents.collectionPath())
      .where("entityId", "==", "person-final-lone")
      .get();
    expect(named.size === 0 && JSON.stringify(differences) === JSON.stringify([1, 0])).toBe(false);
  });
});
