// Integration tests of the functions about the records of people, run against the emulators:
// resolveCorrectionRequest, getPersonDemographics, setPersonOrcid, confirmLaboratoryMembership
// and confirmReplicationMembership, and the trigger that derives the units of a person.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain, an ORCID iD
// from the documentation of ORCID, and placeholder terms for the special categories.
import {
  COLLECTIONS,
  confirmLaboratoryMembershipContract,
  confirmReplicationMembershipContract,
  DEMO_IDENTITY_HASH_KEY,
  getPersonDemographicsContract,
  identityKeyId,
  personEvidenceKey,
  publicErrorReason,
  resolveCorrectionRequestContract,
  setPersonOrcidContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  accessOf,
  account,
  administrator,
  auditOf,
  auditOfPath,
  type Caller,
  call,
  callRaw,
  codeOf,
  coreTeamMember,
  dataOf,
  eventually,
  grantCapability,
  grantRole,
  laboratory,
  leaveNoTrace,
  memberEntry,
  memberEntryPath,
  membership,
  membershipPath,
  notificationsOf,
  person,
  refusal,
  replication,
  resetWorld,
  settle,
  standard,
} from "./support";

beforeEach(resetWorld);

afterAll(leaveNoTrace);

/** A member whose account is linked to a person. */
async function linkedMember(uid: string, personId: string, fields: Record<string, unknown> = {}): Promise<Caller> {
  await person(personId, [], { userId: uid, ...fields });
  return account(uid, { personId });
}

describe("resolveCorrectionRequest", () => {
  const resolution = { requestId: "request-1", outcome: "accepted" } as const;

  async function openRequest(id = "request-1"): Promise<void> {
    await adminDb.doc(`correctionRequests/${id}`).set({
      ...standard(),
      createdBy: "uid-requester",
      updatedBy: "uid-requester",
      uid: "uid-requester",
      entityType: "person",
      entityId: "person-1",
      field: "familyName",
      proposedValue: "Corrected",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
  }

  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await openRequest();
    const requester = await account("uid-requester");
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, resolveCorrectionRequestContract, resolution))).toBe("unauthenticated");
    expect(await codeOf(call(requester, resolveCorrectionRequestContract, resolution))).toBe("permission-denied");
    expect(await codeOf(call(coordinator, resolveCorrectionRequestContract, resolution))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, resolveCorrectionRequestContract, resolution))).toBe("failed-precondition");
    expect(await dataOf("correctionRequests/request-1")).toMatchObject({ status: "open", resolvedBy: null });
  });

  it("records the outcome, notifies the requester and is not audited a second time by the trigger", async () => {
    // A request of this test alone, so that no deletion of an earlier test is among its audit entries.
    const resolution = { requestId: "request-audited", outcome: "accepted" } as const;
    await openRequest("request-audited");
    await account("uid-requester");
    const core = await coreTeamMember("uid-core");

    expect(
      await call(core, resolveCorrectionRequestContract, { ...resolution, messageToRequester: "Corrected today." }),
    ).toEqual({
      requestId: "request-audited",
      status: "accepted",
      applied: false,
    });

    const stored = await dataOf("correctionRequests/request-audited");
    expect(stored).toMatchObject({ status: "accepted", resolvedBy: "uid-core", updatedBy: "uid-core" });
    expect(stored?.resolvedAt).toEqual(stored?.updatedAt);
    const [entry] = await auditOf("correction.resolved", "person-1");
    expect(entry).toMatchObject({ actorUid: "uid-core", entityType: "person" });
    expect(stored?.writeContext.auditEventId).toBe(entry?.writeContext.auditEventId);
    expect(await notificationsOf("uid-requester")).toMatchObject([
      {
        type: "statusChange",
        entityType: "person",
        entityId: "person-1",
        payload: {
          kind: "correctionResolved",
          requestId: "request-audited",
          field: "familyName",
          outcome: "accepted",
          applied: false,
          message: "Corrected today.",
        },
      },
    ]);

    // The same outcome again changes nothing, and another outcome comes too late.
    await call(core, resolveCorrectionRequestContract, resolution);
    expect(await auditOf("correction.resolved", "person-1")).toHaveLength(1);
    expect(await codeOf(call(core, resolveCorrectionRequestContract, { ...resolution, outcome: "rejected" }))).toBe(
      "failed-precondition",
    );
    expect(
      await codeOf(call(core, resolveCorrectionRequestContract, { ...resolution, requestId: "request-missing" })),
    ).toBe("not-found");
    expect(await codeOf(callRaw(core, "resolveCorrectionRequest", { ...resolution, outcome: "withdrawn" }))).toBe(
      "invalid-argument",
    );

    // The collection is one that clients write, so the audit trigger sees this write. It finds
    // the entry that the function wrote and adds none of its own: one creation, by the seed.
    await settle();
    expect((await auditOfPath("correctionRequests/request-audited")).map((audit) => audit.action)).toEqual([
      "document.created",
    ]);
  });
});

describe("resolveCorrectionRequest with apply", () => {
  async function request(id: string, field: string, proposedValue: string, entityId = "person-1"): Promise<void> {
    await adminDb.doc(`correctionRequests/${id}`).set({
      ...standard(),
      createdBy: "uid-requester",
      updatedBy: "uid-requester",
      uid: "uid-requester",
      entityType: "person",
      entityId,
      field,
      proposedValue,
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    });
  }

  it("sets the proposed value on the person in the same transaction, audited with its before and after", async () => {
    await linkedMember("uid-requester", "person-1", { familyName: "Mistaken" });
    const core = await coreTeamMember("uid-core");
    await request("request-apply", "familyName", " Corrected ");

    expect(
      await call(core, resolveCorrectionRequestContract, {
        requestId: "request-apply",
        outcome: "accepted",
        apply: true,
      }),
    ).toEqual({ requestId: "request-apply", status: "accepted", applied: true });

    const stored = await dataOf("persons/person-1");
    expect(stored).toMatchObject({ familyName: "Corrected", updatedBy: "uid-core" });
    const [entry] = await auditOf("correction.resolved", "person-1");
    expect(entry?.changes).toContainEqual({ field: "familyName", before: "Mistaken", after: "Corrected" });
    expect(stored?.writeContext.auditEventId).toBe(entry?.writeContext.auditEventId);
    expect(await notificationsOf("uid-requester")).toMatchObject([{ payload: { outcome: "accepted", applied: true } }]);
  });

  it("refuses to apply a derived detail, a value that does not fit, and a rejection, and changes nothing", async () => {
    await linkedMember("uid-requester", "person-1", { countryCode: "GB" });
    const core = await coreTeamMember("uid-core");
    await request("request-derived", "affiliationSummary", "Another University");
    await request("request-unfit", "countryCode", "Atlantis");

    const derived = await refusal(
      call(core, resolveCorrectionRequestContract, { requestId: "request-derived", outcome: "accepted", apply: true }),
    );
    expect(derived.code).toBe("failed-precondition");
    expect(derived.message).toContain("comes from other records");
    expect(
      await codeOf(
        call(core, resolveCorrectionRequestContract, { requestId: "request-unfit", outcome: "accepted", apply: true }),
      ),
    ).toBe("invalid-argument");
    expect(
      await codeOf(
        callRaw(core, "resolveCorrectionRequest", { requestId: "request-unfit", outcome: "rejected", apply: true }),
      ),
    ).toBe("invalid-argument");
    expect(await dataOf("persons/person-1")).toMatchObject({ countryCode: "GB" });
    expect(await dataOf("correctionRequests/request-derived")).toMatchObject({ status: "open" });

    // Accepting without applying records the decision and leaves the record to be corrected where it comes from.
    expect(
      await call(core, resolveCorrectionRequestContract, { requestId: "request-derived", outcome: "accepted" }),
    ).toEqual({ requestId: "request-derived", status: "accepted", applied: false });
  });
});

const DEMOGRAPHICS = { genderSource: "synthetic gender term Q", ethnicitySource: "synthetic ethnicity term Z" };

describe("getPersonDemographics", () => {
  async function recorded(personId = "person-1"): Promise<void> {
    await adminDb
      .doc(COLLECTIONS.personDemographics.docPath(personId))
      .set({ ...standard(), ...DEMOGRAPHICS, recordedAt: Timestamp.fromMillis(1_700_000_000_000) });
  }
  const served = { ...DEMOGRAPHICS, recordedAt: new Date(1_700_000_000_000).toISOString() };

  it("serves a person their own record and audits the read without a value", async () => {
    const self = await linkedMember("uid-self", "person-1");
    await recorded();

    expect(await call(self, getPersonDemographicsContract, { personId: "person-1" })).toEqual({
      personId: "person-1",
      demographics: served,
    });

    const [entry] = await auditOf("demographics.read", "person-1");
    expect(entry).toMatchObject({ actorUid: "uid-self", entityType: "person", documentPath: "persons/person-1" });
    expect(entry?.changes).toEqual([
      { field: "ethnicitySource", withheld: true },
      { field: "genderSource", withheld: true },
    ]);
    expect(JSON.stringify(entry)).not.toMatch(/synthetic (gender|ethnicity) term/);
  });

  it("gives an empty result where nothing is recorded, and audits that read as well", async () => {
    const self = await linkedMember("uid-self", "person-1");
    expect(await call(self, getPersonDemographicsContract, { personId: "person-1" })).toEqual({
      personId: "person-1",
      demographics: null,
    });
    expect(await auditOf("demographics.read", "person-1")).toMatchObject([{ actorUid: "uid-self", changes: [] }]);
  });

  it("refuses everybody else who holds no named grant, programme administrators included", async () => {
    await linkedMember("uid-self", "person-1");
    await recorded();
    const other = await linkedMember("uid-other", "person-2");
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const admin = await administrator("uid-admin");
    const core = await coreTeamMember("uid-core");
    const request = { personId: "person-1" };

    expect(await codeOf(call(null, getPersonDemographicsContract, request))).toBe("unauthenticated");
    for (const caller of [other, coordinator, core, admin]) {
      expect(await codeOf(call(caller, getPersonDemographicsContract, request))).toBe("permission-denied");
    }
    // Whether the person exists makes no difference to a caller who may read nobody's record.
    expect(await codeOf(call(other, getPersonDemographicsContract, { personId: "person-missing" }))).toBe(
      "permission-denied",
    );
    expect(await auditOf("demographics.read")).toHaveLength(0);
  });

  it("serves the holder of an unexpired named grant whose second factor is satisfied, and nobody whose grant has lapsed", async () => {
    await person("person-1");
    await recorded();
    const reader = await account("uid-reader", { mfaEnrolled: true, secondFactor: true });
    await grantCapability("uid-reader", "demographics.read");
    const request = { personId: "person-1" };

    expect(await call(reader, getPersonDemographicsContract, request)).toEqual({
      personId: "person-1",
      demographics: served,
    });
    expect(await auditOf("demographics.read", "person-1")).toMatchObject([{ actorUid: "uid-reader" }]);
    expect(await codeOf(call(reader, getPersonDemographicsContract, { personId: "person-missing" }))).toBe("not-found");

    // Without the second factor in the session.
    const refused = await refusal(call({ ...reader, secondFactor: false }, getPersonDemographicsContract, request));
    expect(refused.code).toBe("failed-precondition");
    expect(publicErrorReason(refused.details)).toBe("secondFactorRequired");

    // A grant without an expiry time opens nothing, and neither does one that has run out or been revoked.
    const grant = adminDb.doc("capabilityGrants/uid-reader__demographics.read");
    await grant.update({ expiresAt: null });
    expect(await codeOf(call(reader, getPersonDemographicsContract, request))).toBe("permission-denied");
    await grant.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1_000) });
    expect(await codeOf(call(reader, getPersonDemographicsContract, request))).toBe("permission-denied");
    await grant.update({
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      revokedAt: Timestamp.now(),
      revokedBy: "system:test",
    });
    expect(await codeOf(call(reader, getPersonDemographicsContract, request))).toBe("permission-denied");
    expect(await auditOf("demographics.read", "person-1")).toHaveLength(1);
  });

  it("serves a programme administrator once a named grant exists, and refuses a suspended person their own record", async () => {
    await person("person-1");
    await recorded();
    const admin = await administrator("uid-admin");
    await grantCapability("uid-admin", "demographics.read");
    expect((await call(admin, getPersonDemographicsContract, { personId: "person-1" })).demographics).toEqual(served);

    const self = await linkedMember("uid-self", "person-2");
    await recorded("person-2");
    await adminDb.doc("users/uid-self").update({ status: "suspended" });
    await eventually(async () => (await accessOf("uid-self")).suspended, "the suspension");
    expect(await codeOf(call(self, getPersonDemographicsContract, { personId: "person-2" }))).toBe("permission-denied");
  });
});

const ORCID = "0000-0002-1825-0097";
const OTHER_ORCID = "0000-0001-5109-3700";
const orcidKeyPath = (orcid: string) =>
  COLLECTIONS.identityKeys.docPath(
    identityKeyId("person", "orcid", personEvidenceKey.orcid(orcid), DEMO_IDENTITY_HASH_KEY),
  );

describe("setPersonOrcid", () => {
  it("refuses a caller who is signed out, another member, and a person who has not confirmed the iD as their own", async () => {
    const self = await linkedMember("uid-self", "person-1");
    const other = await linkedMember("uid-other", "person-2");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });
    const change = { personId: "person-1", orcid: ORCID, confirmedOwn: true };

    expect(await codeOf(call(null, setPersonOrcidContract, change))).toBe("unauthenticated");
    expect(await codeOf(call(other, setPersonOrcidContract, change))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, setPersonOrcidContract, change))).toBe("failed-precondition");
    const unconfirmed = await refusal(call(self, setPersonOrcidContract, { ...change, confirmedOwn: false }));
    expect(unconfirmed.code).toBe("failed-precondition");
    expect(unconfirmed.message).toContain("Confirm that this ORCID iD is your own");
    for (const orcid of ["0000-0002-1825-0098", "1825-0097", "https://orcid.org/0000-0002-1825-0097"]) {
      expect(await codeOf(callRaw(self, "setPersonOrcid", { ...change, orcid }))).toBe("invalid-argument");
    }
    expect((await dataOf("persons/person-1"))?.orcid).toBeUndefined();
    expect(await dataOf(orcidKeyPath(ORCID))).toBeUndefined();
  });

  it("lets a person set their own iD and reserves it, so that no other person can hold it", async () => {
    const self = await linkedMember("uid-self", "person-1");
    const other = await linkedMember("uid-other", "person-2");
    const admin = await administrator("uid-admin");

    expect(
      await call(self, setPersonOrcidContract, { personId: "person-1", orcid: ORCID, confirmedOwn: true }),
    ).toEqual({
      personId: "person-1",
      orcid: ORCID,
    });

    expect((await dataOf("persons/person-1"))?.orcid).toBe(ORCID);
    expect(await dataOf(orcidKeyPath(ORCID))).toMatchObject({
      entityType: "person",
      keyKind: "orcid",
      entityIds: ["person-1"],
      status: "active",
    });
    const [entry] = await auditOf("person.orcidChanged", "person-1");
    expect(entry?.changes).toEqual([{ field: "orcid", before: null, after: ORCID }]);

    // Neither the other person nor an administrator can give the same iD to a second record.
    const taken = await refusal(
      call(other, setPersonOrcidContract, { personId: "person-2", orcid: ORCID, confirmedOwn: true }),
    );
    expect(taken.code).toBe("already-exists");
    expect(taken.message).not.toContain("person-1");
    expect(
      await codeOf(call(admin, setPersonOrcidContract, { personId: "person-2", orcid: ORCID, confirmedOwn: false })),
    ).toBe("already-exists");
    expect((await dataOf("persons/person-2"))?.orcid).toBeUndefined();
    expect((await dataOf(orcidKeyPath(ORCID)))?.entityIds).toEqual(["person-1"]);

    // The same iD again changes nothing.
    await call(self, setPersonOrcidContract, { personId: "person-1", orcid: ORCID, confirmedOwn: true });
    expect(await auditOf("person.orcidChanged", "person-1")).toHaveLength(1);
  });

  it("releases the earlier iD when the iD changes or is removed, by the person or by an administrator", async () => {
    const self = await linkedMember("uid-self", "person-1");
    const other = await linkedMember("uid-other", "person-2");
    const core = await coreTeamMember("uid-core");
    await call(self, setPersonOrcidContract, { personId: "person-1", orcid: ORCID, confirmedOwn: true });

    await call(core, setPersonOrcidContract, { personId: "person-1", orcid: OTHER_ORCID, confirmedOwn: false });
    expect((await dataOf("persons/person-1"))?.orcid).toBe(OTHER_ORCID);
    expect(await dataOf(orcidKeyPath(ORCID))).toBeUndefined();
    expect((await dataOf(orcidKeyPath(OTHER_ORCID)))?.entityIds).toEqual(["person-1"]);
    // The released iD is free for the other person.
    await call(other, setPersonOrcidContract, { personId: "person-2", orcid: ORCID, confirmedOwn: true });
    expect((await dataOf(orcidKeyPath(ORCID)))?.entityIds).toEqual(["person-2"]);

    expect(await call(self, setPersonOrcidContract, { personId: "person-1", orcid: null, confirmedOwn: true })).toEqual(
      {
        personId: "person-1",
        orcid: null,
      },
    );
    expect(await dataOf("persons/person-1")).not.toHaveProperty("orcid");
    expect(await dataOf(orcidKeyPath(OTHER_ORCID))).toBeUndefined();
    expect(
      await codeOf(
        call(core, setPersonOrcidContract, { personId: "person-missing", orcid: ORCID, confirmedOwn: false }),
      ),
    ).toBe("not-found");
  });

  it("refuses an iD whose key is the tombstone of an erased record", async () => {
    const self = await linkedMember("uid-self", "person-1");
    await adminDb.doc(orcidKeyPath(ORCID)).set({
      ...standard(),
      entityType: "person",
      keyKind: "orcid",
      entityIds: ["person-erased"],
      status: "erased",
      mergedIntoId: null,
    });
    expect(
      await codeOf(call(self, setPersonOrcidContract, { personId: "person-1", orcid: ORCID, confirmedOwn: true })),
    ).toBe("already-exists");
  });
});

describe("confirmLaboratoryMembership", () => {
  const confirmation = {
    laboratoryId: "lab-a",
    personId: "person-1",
    role: "coordinator",
    isAuthorisedRepresentative: true,
  } as const;

  async function proposed(): Promise<Caller> {
    await laboratory("lab-a");
    const self = await linkedMember("uid-self", "person-1");
    await memberEntry("lab-a", "person-1", { role: "coordinator", isAuthorisedRepresentative: true });
    return self;
  }

  it("refuses the coordinator who proposed the entry, another member and an administrator without the second factor", async () => {
    await proposed();
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", "lab-a");
    const other = await linkedMember("uid-other", "person-2");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, confirmLaboratoryMembershipContract, confirmation))).toBe("unauthenticated");
    // A coordinator manages the laboratory and still cannot confirm for somebody else.
    expect(await codeOf(call(coordinator, confirmLaboratoryMembershipContract, confirmation))).toBe(
      "permission-denied",
    );
    expect(await codeOf(call(other, confirmLaboratoryMembershipContract, confirmation))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, confirmLaboratoryMembershipContract, confirmation))).toBe(
      "failed-precondition",
    );
    expect((await dataOf(memberEntryPath("lab-a", "person-1")))?.status).toBe("proposed");
    expect((await dataOf("persons/person-1"))?.laboratoryIds).toEqual([]);
  });

  it("lets the person confirm exactly what they saw, and never a role that was changed in between", async () => {
    const self = await proposed();

    // The entry is changed after the person looked at it.
    const stale = await refusal(call(self, confirmLaboratoryMembershipContract, { ...confirmation, role: "member" }));
    expect(stale.code).toBe("failed-precondition");
    expect(stale.message).toContain("has changed since you saw it");
    expect(
      await codeOf(
        call(self, confirmLaboratoryMembershipContract, { ...confirmation, isAuthorisedRepresentative: false }),
      ),
    ).toBe("failed-precondition");
    expect((await dataOf(memberEntryPath("lab-a", "person-1")))?.status).toBe("proposed");

    expect(await call(self, confirmLaboratoryMembershipContract, confirmation)).toEqual({
      laboratoryId: "lab-a",
      personId: "person-1",
      status: "confirmed",
    });

    expect(await dataOf(memberEntryPath("lab-a", "person-1"))).toMatchObject({
      status: "confirmed",
      role: "coordinator",
      updatedBy: "uid-self",
    });
    expect((await dataOf("persons/person-1"))?.laboratoryIds).toEqual(["lab-a"]);
    // Membership of the laboratory holds at once. Its coordination awaits approval.
    const access = await accessOf("uid-self");
    expect(access.memberLaboratoryIds).toEqual(["lab-a"]);
    expect(access.coordinatorLaboratoryIds).toEqual([]);
    expect(access.pendingRoles).toEqual([{ role: "lab_coordinator", scopeType: "laboratory", scopeId: "lab-a" }]);
    expect(await auditOf("laboratoryMember.confirmed", "lab-a")).toMatchObject([{ actorUid: "uid-self" }]);

    // The same confirmation again changes nothing.
    await call(self, confirmLaboratoryMembershipContract, confirmation);
    expect(await auditOf("laboratoryMember.confirmed", "lab-a")).toHaveLength(1);
  });

  it("refuses an archived entry and a missing one, and lets an administrator confirm for a person without an account", async () => {
    await laboratory("lab-a");
    await person("person-1");
    await memberEntry("lab-a", "person-1", {
      role: "coordinator",
      isAuthorisedRepresentative: true,
      archivedAt: Timestamp.now(),
    });
    const admin = await administrator("uid-admin");

    expect(await codeOf(call(admin, confirmLaboratoryMembershipContract, confirmation))).toBe("failed-precondition");
    expect(
      await codeOf(call(admin, confirmLaboratoryMembershipContract, { ...confirmation, laboratoryId: "lab-missing" })),
    ).toBe("not-found");

    await adminDb.doc(memberEntryPath("lab-a", "person-1")).update({ archivedAt: null });
    await call(admin, confirmLaboratoryMembershipContract, confirmation);
    expect((await dataOf(memberEntryPath("lab-a", "person-1")))?.status).toBe("confirmed");
    expect((await dataOf("persons/person-1"))?.laboratoryIds).toEqual(["lab-a"]);
    expect((await adminDb.collection("roleAssignments").where("scopeId", "==", "lab-a").get()).size).toBe(0);
  });
});

describe("confirmReplicationMembership", () => {
  const confirmation = { replicationId: "StudyA2001", personId: "person-1", role: "analyst", isCurrent: true } as const;

  async function proposed(role = "analyst"): Promise<Caller> {
    await replication("StudyA2001");
    const self = await linkedMember("uid-self", "person-1");
    await membership("StudyA2001", "person-1", role);
    return self;
  }

  it("refuses the lead who proposed the membership, another member and an administrator without the second factor", async () => {
    await proposed();
    const lead = await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", "StudyA2001");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, confirmReplicationMembershipContract, confirmation))).toBe("unauthenticated");
    expect(await codeOf(call(lead, confirmReplicationMembershipContract, confirmation))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, confirmReplicationMembershipContract, confirmation))).toBe(
      "failed-precondition",
    );
    expect((await dataOf(membershipPath("StudyA2001", "person-1", "analyst")))?.reviewStatus).toBe("needsReview");
  });

  it("lets the person confirm their own membership, which puts the replication on the person and on their team", async () => {
    const self = await proposed();

    expect(await codeOf(call(self, confirmReplicationMembershipContract, { ...confirmation, isCurrent: false }))).toBe(
      "failed-precondition",
    );
    expect(await call(self, confirmReplicationMembershipContract, confirmation)).toEqual({
      replicationId: "StudyA2001",
      personId: "person-1",
      role: "analyst",
      reviewStatus: "confirmed",
    });

    expect((await dataOf(membershipPath("StudyA2001", "person-1", "analyst")))?.reviewStatus).toBe("confirmed");
    expect((await dataOf("persons/person-1"))?.replicationIds).toEqual(["StudyA2001"]);
    const access = await accessOf("uid-self");
    expect(access.teamReplicationIds).toEqual(["StudyA2001"]);
    expect(access.leadReplicationIds).toEqual([]);
    expect(await auditOf("replicationMembership.confirmed", "StudyA2001")).toMatchObject([{ actorUid: "uid-self" }]);
    await call(self, confirmReplicationMembershipContract, confirmation);
    expect(await auditOf("replicationMembership.confirmed", "StudyA2001")).toHaveLength(1);
  });

  it("never lets a person confirm that they lead a replication, and makes a confirmed lead a role that awaits approval", async () => {
    const self = await proposed("lead");
    const lead = { ...confirmation, role: "lead" } as const;
    const core = await coreTeamMember("uid-core");
    const admin = await administrator("uid-admin");

    expect(await codeOf(call(self, confirmReplicationMembershipContract, lead))).toBe("permission-denied");
    expect((await dataOf(membershipPath("StudyA2001", "person-1", "lead")))?.reviewStatus).toBe("needsReview");

    await call(core, confirmReplicationMembershipContract, lead);

    expect((await dataOf(membershipPath("StudyA2001", "person-1", "lead")))?.reviewStatus).toBe("confirmed");
    const access = await accessOf("uid-self");
    expect(access.leadReplicationIds).toEqual([]);
    expect(access.pendingRoles).toEqual([
      { role: "replication_lead", scopeType: "replication", scopeId: "StudyA2001" },
    ]);
    expect(access.teamReplicationIds).toEqual(["StudyA2001"]);
    // The person is told, and so is whoever approves roles.
    expect(await notificationsOf("uid-self")).toMatchObject([{ payload: { kind: "replicationMembershipConfirmed" } }]);
    expect(await notificationsOf(admin.uid)).toMatchObject([
      { type: "roleDecision", payload: { kind: "rolesAwaitApproval", count: 1 } },
    ]);
  });
});

describe("the units on the directory document of a person", () => {
  const unitsOf = async (personId: string) => {
    const stored = await dataOf(`persons/${personId}`);
    return { laboratoryIds: stored?.laboratoryIds, replicationIds: stored?.replicationIds };
  };

  it("hold a laboratory only while the member entry there is confirmed and not archived", async () => {
    await laboratory("lab-a");
    await person("person-1");
    const entry = adminDb.doc(memberEntryPath("lab-a", "person-1"));

    // A coordinator adds the person to their laboratory. Nothing reaches the person.
    await memberEntry("lab-a", "person-1");
    await settle();
    expect(await unitsOf("person-1")).toEqual({ laboratoryIds: [], replicationIds: [] });

    await entry.update({ status: "confirmed" });
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).includes("lab-a"),
      "the confirmed laboratory",
    );
    expect((await dataOf("persons/person-1"))?.updatedBy).toBe("system:personUnits");

    // An archived entry gives no sight of contact details, even while it still says confirmed.
    await entry.update({ archivedAt: Timestamp.now() });
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).length === 0,
      "no laboratory after archiving",
    );

    await entry.update({ archivedAt: null });
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).includes("lab-a"),
      "the restored laboratory",
    );
    await entry.update({ status: "ended" });
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).length === 0,
      "no laboratory after the end",
    );
    await entry.update({ status: "confirmed" });
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).includes("lab-a"),
      "the laboratory again",
    );
    await entry.delete();
    await eventually(
      async () => ((await unitsOf("person-1")).laboratoryIds as string[]).length === 0,
      "no laboratory after the deletion",
    );
  });

  it("hold a replication only while a membership there is confirmed, current and not archived", async () => {
    await replication("StudyA2001");
    await person("person-1");
    const analyst = adminDb.doc(membershipPath("StudyA2001", "person-1", "analyst"));
    const listed = async () => ((await unitsOf("person-1")).replicationIds as string[]).includes("StudyA2001");

    await membership("StudyA2001", "person-1", "analyst");
    await settle();
    expect(await listed()).toBe(false);

    await analyst.update({ reviewStatus: "confirmed" });
    await eventually(listed, "the confirmed replication");
    await analyst.update({ isCurrent: false });
    await eventually(async () => !(await listed()), "no replication for a membership that is not current");

    // A second membership of the same person keeps the replication there when the first is archived.
    await analyst.update({ isCurrent: true });
    await membership("StudyA2001", "person-1", "member", { reviewStatus: "confirmed" });
    await eventually(listed, "the replication of two memberships");
    await analyst.update({ archivedAt: Timestamp.now() });
    await settle();
    expect(await listed()).toBe(true);
    await adminDb.doc(membershipPath("StudyA2001", "person-1", "member")).update({ archivedAt: Timestamp.now() });
    await eventually(async () => !(await listed()), "no replication once every membership is archived");
  });

  it("reach the access document of the person's account, so the team of a replication follows its memberships", async () => {
    await replication("StudyA2001");
    await linkedMember("uid-self", "person-1");
    await membership("StudyA2001", "person-1", "member", { reviewStatus: "confirmed" });

    await eventually(
      async () => (await accessOf("uid-self")).teamReplicationIds.includes("StudyA2001"),
      "the team in the access document",
    );
    await adminDb.doc(membershipPath("StudyA2001", "person-1", "member")).update({ archivedAt: Timestamp.now() });
    await eventually(
      async () => (await accessOf("uid-self")).teamReplicationIds.length === 0,
      "no team after archiving",
    );
  });
});
