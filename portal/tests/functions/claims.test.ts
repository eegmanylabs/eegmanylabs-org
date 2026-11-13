// Integration tests of the account claim flow (decision D-005), run against the emulators:
// claimProfile, requestAccess, listAccountClaims, reviewAccountClaim and unlinkAccountClaim.
// Fixtures are synthetic: fictitious accounts and people, with addresses on the example.org domain.
import {
  accountClaimDocSchema,
  accountClaimReviewDocSchema,
  claimProfileContract,
  listAccountClaimsContract,
  publicErrorReason,
  requestAccessContract,
  reviewAccountClaimContract,
  roleAssignmentDocSchema,
  unlinkAccountClaimContract,
} from "@eegml/shared";
import type { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../support/admin";
import {
  accessOf,
  account,
  administrator,
  auditOf,
  type Caller,
  call,
  callRaw,
  codeOf,
  coreTeamMember,
  dataOf,
  emailIndexPath,
  grantCapability,
  grantRole,
  laboratory,
  memberEntry,
  membership,
  notificationsOf,
  person,
  refusal,
  replication,
  resetWorld,
  withoutTriggers,
} from "./support";

withoutTriggers();
beforeEach(resetWorld);

const claimOf = async (uid: string) => {
  const data = await dataOf(`accountClaims/${uid}`);
  return data === undefined ? null : accountClaimDocSchema.parse(data);
};
const reviewOf = async (uid: string) =>
  accountClaimReviewDocSchema.parse(await dataOf(`accountClaims/${uid}/private/review`));
const assignmentOf = async (id: string) => {
  const data = await dataOf(`roleAssignments/${id}`);
  return data === undefined ? null : roleAssignmentDocSchema.parse(data);
};

/** A person whose record implies every kind of role: a member entry, a coordination, a lead and the core team. */
async function wellConnectedPerson(id: string, email: string): Promise<void> {
  await Promise.all([laboratory("lab-a"), laboratory("lab-b"), laboratory("lab-c"), replication("StudyA2001")]);
  await person(id, [{ email }], {
    isCoreTeam: true,
    laboratoryIds: ["lab-a", "lab-b"],
    replicationIds: ["StudyA2001"],
  });
  await memberEntry("lab-a", id, { status: "confirmed" });
  await memberEntry("lab-b", id, { status: "confirmed", role: "coordinator" });
  // Proposed and never confirmed by the person: it implies nothing.
  await memberEntry("lab-c", id, { role: "pi" });
  await membership("StudyA2001", id, "lead", { reviewStatus: "confirmed" });
}

describe("claimProfile", () => {
  it("refuses a caller who is not signed in", async () => {
    expect(await codeOf(call(null, claimProfileContract, {}))).toBe("unauthenticated");
  });

  it("refuses an unverified address in the same way whether or not a person holds it", async () => {
    await person("person-known", [{ email: "known.member@example.org" }]);
    const known = await account("uid-known", { email: "known.member@example.org", emailVerified: false });
    const unknown = await account("uid-unknown", { email: "nobody.at.all@example.org", emailVerified: false });

    const first = await refusal(call(known, claimProfileContract, {}));
    const second = await refusal(call(unknown, claimProfileContract, {}));

    expect(first.code).toBe("failed-precondition");
    expect(publicErrorReason(first.details)).toBe("emailNotVerified");
    expect({ code: second.code, message: second.message, details: second.details }).toEqual({
      code: first.code,
      message: first.message,
      details: first.details,
    });
    expect(await claimOf("uid-known")).toBeNull();
    expect((await dataOf("persons/person-known"))?.userId).toBeNull();
  });

  it.each([
    ["an address", { email: "known.member@example.org" }],
    ["a person", { personId: "person-known" }],
    ["no data", null],
  ])("refuses a call that carries %s, so nobody can ask about anybody else", async (_label, data) => {
    await person("person-known", [{ email: "known.member@example.org" }]);
    const caller = await account("uid-curious");
    expect(await codeOf(callRaw(caller, "claimProfile", data))).toBe("invalid-argument");
    expect(await claimOf("uid-curious")).toBeNull();
  });

  it("answers noMatch and changes nothing when nobody holds the address", async () => {
    const caller = await account("uid-stranger");
    const before = await adminDb.doc("access/uid-stranger").get();

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "noMatch" });

    expect(await claimOf("uid-stranger")).toBeNull();
    expect((await adminDb.doc("access/uid-stranger").get()).updateTime?.isEqual(before.updateTime as Timestamp)).toBe(
      true,
    );
    expect(await auditOf("claim.sentToReview")).toHaveLength(0);
    expect(await auditOf("claim.approved")).toHaveLength(0);
  });

  it("links the one unclaimed person in one transaction, with member roles active and management roles pending", async () => {
    const reviewer = await administrator("uid-admin");
    await wellConnectedPerson("person-1", "Well.Connected@example.org");
    const caller = await account("uid-claimant", { email: "well.connected@example.org" });

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "linked", personId: "person-1" });

    const linked = await dataOf("persons/person-1");
    expect(linked?.userId).toBe("uid-claimant");
    expect(linked?.claimedAt).not.toBeNull();
    expect((await dataOf("users/uid-claimant"))?.personId).toBe("person-1");
    expect(await claimOf("uid-claimant")).toMatchObject({ status: "approved", personId: "person-1" });
    const review = await reviewOf("uid-claimant");
    expect(review).toMatchObject({ candidatePersonIds: ["person-1"], matchBasis: "primaryEmail", reviewedBy: null });

    const ids = {
      member: "uid-claimant__lab_member__laboratory__lab-a",
      memberB: "uid-claimant__lab_member__laboratory__lab-b",
      coordinator: "uid-claimant__lab_coordinator__laboratory__lab-b",
      lead: "uid-claimant__replication_lead__replication__StudyA2001",
      core: "uid-claimant__core_team__programme__eegmanylabs",
    };
    expect((await assignmentOf(ids.member))?.status).toBe("active");
    expect((await assignmentOf(ids.memberB))?.status).toBe("active");
    for (const id of [ids.coordinator, ids.lead, ids.core]) {
      expect(await assignmentOf(id)).toMatchObject({ status: "pendingApproval", grantedBy: null, grantedAt: null });
    }
    // The unconfirmed entry implies nothing, whatever role it names.
    expect((await adminDb.collection("roleAssignments").where("uid", "==", "uid-claimant").get()).size).toBe(5);
    expect(review.evidence.createdRoleAssignmentIds).toEqual(Object.values(ids).sort());

    // The access document is part of the same transaction: no waiting.
    const access = await accessOf("uid-claimant");
    expect(access).toMatchObject({
      member: true,
      personId: "person-1",
      memberLaboratoryIds: ["lab-a", "lab-b"],
      coordinatorLaboratoryIds: [],
      leadReplicationIds: [],
      programmeRoles: [],
      teamReplicationIds: ["StudyA2001"],
    });
    expect(access.pendingRoles.map((role) => role.role)).toEqual(["core_team", "lab_coordinator", "replication_lead"]);

    const [approved] = await auditOf("claim.approved", "person-1");
    expect(approved).toMatchObject({ actorUid: "uid-claimant", entityType: "person" });
    expect(linked?.writeContext.auditEventId).toBe(approved?.writeContext.auditEventId);
    expect(await auditOf("role.granted", "uid-claimant")).toHaveLength(2);
    expect(await auditOf("role.proposed", "uid-claimant")).toHaveLength(3);

    // Whoever approves roles is told that three of them await approval, and is told no address.
    const [notification] = await notificationsOf(reviewer.uid);
    expect(notification).toMatchObject({
      type: "roleDecision",
      entityType: "user",
      entityId: "uid-claimant",
      payload: { kind: "rolesAwaitApproval", count: 3 },
      readAt: null,
    });
  });

  it("changes nothing on a second call and gives the same answer", async () => {
    await person("person-1", [{ email: "returning.member@example.org" }]);
    const caller = await account("uid-returning", { email: "returning.member@example.org" });
    const first = await call(caller, claimProfileContract, {});
    const snapshot = async () =>
      Promise.all(
        ["persons/person-1", "users/uid-returning", "access/uid-returning", "accountClaims/uid-returning"].map(
          async (path) => (await adminDb.doc(path).get()).updateTime?.toMillis(),
        ),
      );
    const before = await snapshot();
    const audited = (await adminDb.collection("auditEvents").where("action", "==", "claim.approved").get()).size;

    expect(await call(caller, claimProfileContract, {})).toEqual(first);
    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "linked", personId: "person-1" });

    expect(await snapshot()).toEqual(before);
    expect((await adminDb.collection("auditEvents").where("action", "==", "claim.approved").get()).size).toBe(audited);
  });

  it("links through a secondary address and records that basis", async () => {
    await person("person-1", [
      { email: "main.address@example.org" },
      { email: "other.address@example.org", kind: "secondary" },
    ]);
    const caller = await account("uid-secondary", { email: "other.address@example.org" });

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "linked", personId: "person-1" });
    expect((await reviewOf("uid-secondary")).matchBasis).toBe("secondaryEmail");
  });

  it("sends several candidates to review, tells the caller nothing more and changes nothing else", async () => {
    const reviewer = await administrator("uid-admin");
    await person("person-twin-1", [{ email: "shared.address@example.org" }]);
    await person("person-twin-2", [{ email: "shared.address@example.org" }]);
    const caller = await account("uid-twin", { email: "shared.address@example.org" });

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "pendingReview", statementGiven: false });

    expect(await claimOf("uid-twin")).toMatchObject({ status: "pendingReview", personId: null });
    expect(await reviewOf("uid-twin")).toMatchObject({
      candidatePersonIds: ["person-twin-1", "person-twin-2"],
      matchBasis: "primaryEmail",
      evidence: { reason: "severalCandidates" },
    });
    for (const id of ["person-twin-1", "person-twin-2"]) expect((await dataOf(`persons/${id}`))?.userId).toBeNull();
    expect((await dataOf("users/uid-twin"))?.personId).toBeNull();
    expect((await accessOf("uid-twin")).member).toBe(false);
    expect((await adminDb.collection("roleAssignments").where("uid", "==", "uid-twin").get()).size).toBe(0);
    expect(await notificationsOf(reviewer.uid)).toMatchObject([
      { type: "claimDecision", entityId: "uid-twin", payload: { kind: "accountClaimAwaitsReview" } },
    ]);

    // A repeated call opens no second review record and sends no second notification.
    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "pendingReview", statementGiven: false });
    expect(await auditOf("claim.sentToReview", "uid-twin")).toHaveLength(1);
    expect(await notificationsOf(reviewer.uid)).toHaveLength(1);
  });

  it("gives the same answer for a person whom another account has claimed, and leaves that link alone", async () => {
    await person("person-taken", [{ email: "taken.member@example.org" }], { userId: "uid-holder" });
    await person("person-twin-1", [{ email: "shared.address@example.org" }]);
    await person("person-twin-2", [{ email: "shared.address@example.org" }]);
    const late = await account("uid-late", { email: "taken.member@example.org" });
    const twin = await account("uid-twin", { email: "shared.address@example.org" });

    const claimed = await call(late, claimProfileContract, {});
    const ambiguous = await call(twin, claimProfileContract, {});

    expect(claimed).toEqual({ status: "pendingReview", statementGiven: false });
    expect(claimed).toEqual(ambiguous);
    expect((await dataOf("persons/person-taken"))?.userId).toBe("uid-holder");
    expect(await reviewOf("uid-late")).toMatchObject({
      candidatePersonIds: ["person-taken"],
      evidence: { reason: "alreadyClaimed" },
    });
  });

  it.each([
    ["an address that no claim may rest on", { claimEligible: false }, {}, "notClaimEligible"],
    ["an archived person", {}, { archivedAt: new Date() }, "personUnavailable"],
  ] as const)("sends %s to review", async (_label, email, fields, reason) => {
    await person("person-1", [{ email: "doubtful.match@example.org", ...email }], fields);
    const caller = await account("uid-doubtful", { email: "doubtful.match@example.org" });

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "pendingReview", statementGiven: false });
    expect((await reviewOf("uid-doubtful")).evidence).toEqual({ reason });
    expect((await dataOf("persons/person-1"))?.userId).toBeNull();
  });

  it("sends an index entry to review when the contact document of the person does not hold the address", async () => {
    await person("person-1", [{ email: "stale.entry@example.org" }]);
    await adminDb.doc("persons/person-1/private/contact").update({ emails: [] });
    const caller = await account("uid-stale", { email: "stale.entry@example.org" });

    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "pendingReview", statementGiven: false });
    expect((await reviewOf("uid-stale")).evidence).toEqual({ reason: "addressNotOnRecord" });
  });

  it("links exactly one of two accounts that reach for one person at the same moment", async () => {
    await person("person-1", [
      { email: "first.address@example.org" },
      { email: "second.address@example.org", kind: "secondary" },
    ]);
    const one = await account("uid-one", { email: "first.address@example.org" });
    const two = await account("uid-two", { email: "second.address@example.org" });

    const answers = await Promise.all([call(one, claimProfileContract, {}), call(two, claimProfileContract, {})]);

    expect(answers.map((answer) => answer.status).sort()).toEqual(["linked", "pendingReview"]);
    const winner = answers[0]?.status === "linked" ? "uid-one" : "uid-two";
    const loser = winner === "uid-one" ? "uid-two" : "uid-one";
    expect((await dataOf("persons/person-1"))?.userId).toBe(winner);
    expect((await dataOf(`users/${winner}`))?.personId).toBe("person-1");
    expect((await dataOf(`users/${loser}`))?.personId).toBeNull();
    expect((await accessOf(loser)).member).toBe(false);
    expect(await claimOf(loser)).toMatchObject({ status: "pendingReview", personId: null });
    expect((await reviewOf(loser)).evidence).toEqual({ reason: "alreadyClaimed" });
    expect(await auditOf("claim.approved", "person-1")).toHaveLength(1);
  });

  it("refuses an account that has not started the portal", async () => {
    await person("person-1", [{ email: "early.caller@example.org" }]);
    const caller: Caller = { uid: "uid-early", email: "early.caller@example.org" };
    expect(await codeOf(call(caller, claimProfileContract, {}))).toBe("failed-precondition");
    expect((await dataOf("persons/person-1"))?.userId).toBeNull();
  });

  it("leaves the email index as it was", async () => {
    await person("person-1", [{ email: "indexed.member@example.org" }]);
    const before = await adminDb.doc(emailIndexPath("indexed.member@example.org")).get();
    await call(await account("uid-indexed", { email: "indexed.member@example.org" }), claimProfileContract, {});
    const after = await adminDb.doc(emailIndexPath("indexed.member@example.org")).get();
    expect(after.updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);
  });
});

const REQUEST = {
  statedName: "Synthetic Requester",
  affiliation: "Example University",
  message: "I joined the programme last month.",
};

describe("requestAccess", () => {
  it("refuses a caller who is not signed in, an unverified address and input out of bounds", async () => {
    const unverified = await account("uid-unverified", { emailVerified: false });
    const caller = await account("uid-wordy");
    expect(await codeOf(call(null, requestAccessContract, REQUEST))).toBe("unauthenticated");
    expect(await codeOf(call(unverified, requestAccessContract, REQUEST))).toBe("failed-precondition");
    for (const bad of [
      { ...REQUEST, statedName: "" },
      { ...REQUEST, statedName: "n".repeat(201) },
      { ...REQUEST, affiliation: "a".repeat(301) },
      { ...REQUEST, message: "m".repeat(2_001) },
      { ...REQUEST, personId: "person-1" },
    ]) {
      expect(await codeOf(callRaw(caller, "requestAccess", bad))).toBe("invalid-argument");
    }
    expect(await claimOf("uid-wordy")).toBeNull();
  });

  it("stores a manual request for reviewers, notifies them, and allows one open request per account", async () => {
    const reviewer = await administrator("uid-admin");
    const caller = await account("uid-newcomer");

    expect(await call(caller, requestAccessContract, { ...REQUEST, statedName: "  Synthetic Requester " })).toEqual({
      status: "pendingReview",
    });

    expect(await claimOf("uid-newcomer")).toMatchObject({ status: "pendingReview", personId: null });
    expect(await reviewOf("uid-newcomer")).toMatchObject({
      matchBasis: "manual",
      candidatePersonIds: [],
      evidence: REQUEST,
    });
    expect((await accessOf("uid-newcomer")).member).toBe(false);
    expect(await auditOf("claim.requested", "uid-newcomer")).toHaveLength(1);
    expect(await notificationsOf(reviewer.uid)).toMatchObject([{ payload: { kind: "accessRequestAwaitsReview" } }]);

    const second = await refusal(call(caller, requestAccessContract, REQUEST));
    expect(second.code).toBe("resource-exhausted");
    expect(second.message).toContain("waiting for review already");
    expect(await auditOf("claim.requested", "uid-newcomer")).toHaveLength(1);
  });

  it("refuses an account that is linked already, and accepts a new request after a rejection", async () => {
    const reviewer = await administrator("uid-admin");
    await person("person-1", [{ email: "linked.member@example.org" }]);
    const linked = await account("uid-linked", { email: "linked.member@example.org" });
    await call(linked, claimProfileContract, {});
    expect(await codeOf(call(linked, requestAccessContract, REQUEST))).toBe("failed-precondition");

    const caller = await account("uid-persistent");
    await call(caller, requestAccessContract, REQUEST);
    await call(reviewer, reviewAccountClaimContract, {
      uid: "uid-persistent",
      decision: "reject",
      note: "Not known to us.",
    });
    expect(await call(caller, claimProfileContract, {})).toEqual({ status: "rejected" });

    expect(await call(caller, requestAccessContract, { ...REQUEST, message: "My supervisor can confirm." })).toEqual({
      status: "pendingReview",
    });
    const review = await reviewOf("uid-persistent");
    expect(review.evidence.message).toBe("My supervisor can confirm.");
    // The earlier attempt is kept, with its decision and its note.
    expect(review.history).toMatchObject([
      { status: "rejected", matchBasis: "manual", reviewedBy: "uid-admin", decisionNote: "Not known to us." },
    ]);
    expect(review.reviewedBy).toBeNull();
  });
});

describe("requestAccess on a claim that a match sent to review", () => {
  it("adds what the claimant says to the review once, and changes nothing else", async () => {
    const reviewer = await administrator("uid-admin");
    await person("person-twin-1", [{ email: "shared.address@example.org" }]);
    await person("person-twin-2", [{ email: "shared.address@example.org" }]);
    const caller = await account("uid-twin", { email: "shared.address@example.org" });
    await call(caller, claimProfileContract, {});
    const before = await reviewOf("uid-twin");

    expect(await call(caller, requestAccessContract, REQUEST)).toEqual({ status: "pendingReview" });
    const after = await reviewOf("uid-twin");
    expect(after).toMatchObject({
      matchBasis: before.matchBasis,
      candidatePersonIds: before.candidatePersonIds,
      evidence: { reason: "severalCandidates", ...REQUEST },
    });
    const [listed] = (await call(reviewer, listAccountClaimsContract, {})).claims;
    expect(listed).toMatchObject({ reviewReason: "severalCandidates", request: REQUEST });

    // Once said, it is not rewritten.
    expect(await codeOf(call(caller, requestAccessContract, { ...REQUEST, message: "Something else." }))).toBe(
      "resource-exhausted",
    );
    expect((await reviewOf("uid-twin")).evidence.message).toBe(REQUEST.message);
  });
});

describe("listAccountClaims", () => {
  it("refuses everybody but a reviewer whose second factor is satisfied", async () => {
    const member = await account("uid-member");
    await grantRole("uid-member", "lab_member", "laboratory", "lab-a");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, listAccountClaimsContract, {}))).toBe("unauthenticated");
    expect(await codeOf(call(member, listAccountClaimsContract, {}))).toBe("permission-denied");
    const refused = await refusal(call(withoutFactor, listAccountClaimsContract, {}));
    expect(refused.code).toBe("failed-precondition");
    expect(publicErrorReason(refused.details)).toBe("secondFactorRequired");
  });

  it("gives a reviewer the queue, oldest first, with the candidates and what the claimant wrote", async () => {
    const reviewer = await administrator("uid-admin");
    await person("person-twin-1", [{ email: "shared.address@example.org" }], {
      affiliationSummary: "Example University",
    });
    await person("person-twin-2", [{ email: "shared.address@example.org" }], { userId: "uid-someone-else" });
    await call(await account("uid-twin", { email: "shared.address@example.org" }), claimProfileContract, {});
    await call(await account("uid-newcomer"), requestAccessContract, REQUEST);

    const { claims } = await call(reviewer, listAccountClaimsContract, {});

    expect(claims.map((claim) => claim.uid)).toEqual(["uid-twin", "uid-newcomer"]);
    expect(claims[0]).toMatchObject({
      status: "pendingReview",
      matchBasis: "primaryEmail",
      emailLower: "shared.address@example.org",
      personId: null,
      request: null,
      candidates: [
        {
          personId: "person-twin-1",
          displayName: "Synthetic person-twin-1",
          affiliationSummary: "Example University",
          claimed: false,
        },
        { personId: "person-twin-2", displayName: "Synthetic person-twin-2", affiliationSummary: null, claimed: true },
      ],
    });
    expect(claims[0]?.reviewReason).toBe("severalCandidates");
    expect(claims[0]?.candidates[0]).toMatchObject({ addressKind: "primary", laboratoryIds: [], replicationIds: [] });
    expect(claims[1]).toMatchObject({
      matchBasis: "manual",
      reviewReason: "requestedAccess",
      candidates: [],
      request: REQUEST,
    });
    expect((await call(reviewer, listAccountClaimsContract, { status: "approved" })).claims).toEqual([]);
    expect((await call(reviewer, listAccountClaimsContract, { limit: 1 })).claims).toHaveLength(1);
  });
});

describe("reviewAccountClaim", () => {
  const approval = { uid: "uid-twin", decision: "approve", personId: "person-twin-1" } as const;

  async function pendingClaim(): Promise<Caller> {
    await Promise.all([laboratory("lab-a"), replication("StudyA2001")]);
    await person("person-twin-1", [{ email: "shared.address@example.org" }]);
    await person("person-twin-2", [{ email: "shared.address@example.org" }]);
    await memberEntry("lab-a", "person-twin-1", { status: "confirmed", role: "pi" });
    const caller = await account("uid-twin", { email: "shared.address@example.org" });
    await call(caller, claimProfileContract, {});
    return caller;
  }

  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await pendingClaim();
    const member = await account("uid-member");
    await grantRole("uid-member", "lab_coordinator", "laboratory", "lab-a");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, reviewAccountClaimContract, approval))).toBe("unauthenticated");
    expect(await codeOf(call(member, reviewAccountClaimContract, approval))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, reviewAccountClaimContract, approval))).toBe("failed-precondition");
    // A claimant cannot approve their own claim either.
    expect(
      await codeOf(
        call({ uid: "uid-twin", email: "shared.address@example.org" }, reviewAccountClaimContract, approval),
      ),
    ).toBe("permission-denied");
    expect(await claimOf("uid-twin")).toMatchObject({ status: "pendingReview" });
    expect((await dataOf("persons/person-twin-1"))?.userId).toBeNull();
  });

  it("approves a claim against the chosen person with the linking of a match", async () => {
    const claimant = await pendingClaim();
    const reviewer = await administrator("uid-admin");

    expect(await call(reviewer, reviewAccountClaimContract, { ...approval, note: "Confirmed by telephone." })).toEqual({
      status: "approved",
      personId: "person-twin-1",
    });

    expect((await dataOf("persons/person-twin-1"))?.userId).toBe("uid-twin");
    expect((await dataOf("persons/person-twin-2"))?.userId).toBeNull();
    expect(await claimOf("uid-twin")).toMatchObject({ status: "approved", personId: "person-twin-1" });
    expect(await reviewOf("uid-twin")).toMatchObject({
      reviewedBy: "uid-admin",
      decisionNote: "Confirmed by telephone.",
    });
    expect((await assignmentOf("uid-twin__lab_member__laboratory__lab-a"))?.status).toBe("active");
    // The coordination that a principal investigator's entry implies still awaits approval.
    expect((await assignmentOf("uid-twin__lab_coordinator__laboratory__lab-a"))?.status).toBe("pendingApproval");
    const access = await accessOf("uid-twin");
    expect(access).toMatchObject({ member: true, personId: "person-twin-1", memberLaboratoryIds: ["lab-a"] });
    expect(access.coordinatorLaboratoryIds).toEqual([]);

    const [entry] = await auditOf("claim.approved", "person-twin-1");
    expect(entry?.actorUid).toBe("uid-admin");
    // The claimant learns the decision and never the note.
    const notifications = await notificationsOf(claimant.uid);
    expect(notifications).toMatchObject([{ type: "claimDecision", payload: { kind: "accountClaimApproved" } }]);
    expect(JSON.stringify(notifications)).not.toContain("telephone");

    // The same decision again changes nothing. Another decision is refused.
    expect(await call(reviewer, reviewAccountClaimContract, approval)).toEqual({
      status: "approved",
      personId: "person-twin-1",
    });
    expect(await auditOf("claim.approved", "person-twin-1")).toHaveLength(1);
    expect(await codeOf(call(reviewer, reviewAccountClaimContract, { ...approval, personId: "person-twin-2" }))).toBe(
      "failed-precondition",
    );
  });

  it("refuses to link a person whom another account has claimed, a missing one and an archived one", async () => {
    await pendingClaim();
    const reviewer = await administrator("uid-admin");
    await adminDb.doc("persons/person-twin-1").update({ userId: "uid-someone-else" });
    await person("person-archived", [], { archivedAt: new Date() });

    const claimed = await refusal(call(reviewer, reviewAccountClaimContract, approval));
    expect(claimed.code).toBe("failed-precondition");
    expect(claimed.message).toContain("Another account has claimed this person already");
    expect(await codeOf(call(reviewer, reviewAccountClaimContract, { ...approval, personId: "person-missing" }))).toBe(
      "not-found",
    );
    expect(await codeOf(call(reviewer, reviewAccountClaimContract, { ...approval, personId: "person-archived" }))).toBe(
      "failed-precondition",
    );
    expect((await dataOf("persons/person-twin-1"))?.userId).toBe("uid-someone-else");
    expect(await claimOf("uid-twin")).toMatchObject({ status: "pendingReview", personId: null });
    expect((await accessOf("uid-twin")).member).toBe(false);
  });

  it("leaves a link on no evidence to an administrator, and no reviewer decides their own claim", async () => {
    await pendingClaim();
    const core = await coreTeamMember("uid-core");
    await person("person-unrelated", [{ email: "unrelated@example.org" }]);

    // The core team reviews claims by default, among the candidates that the address found.
    const unrelated = await refusal(
      call(core, reviewAccountClaimContract, { ...approval, personId: "person-unrelated" }),
    );
    expect(unrelated.code).toBe("permission-denied");
    expect(unrelated.message).toContain("only a programme administrator can link them");
    expect((await dataOf("persons/person-unrelated"))?.userId).toBeNull();
    expect(await call(core, reviewAccountClaimContract, approval)).toEqual({
      status: "approved",
      personId: "person-twin-1",
    });
    expect((await reviewOf("uid-twin")).evidence).toMatchObject({ automatic: false, candidate: true });

    // An administrator may link a request that matched nobody, and the review records that it rested on no address.
    const admin = await administrator("uid-admin");
    await call(await account("uid-newcomer"), requestAccessContract, REQUEST);
    await call(admin, reviewAccountClaimContract, {
      uid: "uid-newcomer",
      decision: "approve",
      personId: "person-unrelated",
    });
    expect(await reviewOf("uid-newcomer")).toMatchObject({
      candidatePersonIds: ["person-unrelated"],
      evidence: { automatic: false, candidate: false },
    });

    // A reviewer's own claim waits for somebody else.
    await call(core, requestAccessContract, REQUEST);
    const own = await refusal(
      call(core, reviewAccountClaimContract, { uid: "uid-core", decision: "reject", note: "Mine." }),
    );
    expect(own.code).toBe("permission-denied");
    expect(own.message).toContain("your own account");
    expect(await claimOf("uid-core")).toMatchObject({ status: "pendingReview" });
  });

  it("rejects a claim with a note, which the claimant never sees", async () => {
    const claimant = await pendingClaim();
    const reviewer = await administrator("uid-admin");

    expect(await codeOf(callRaw(reviewer, "reviewAccountClaim", { uid: "uid-twin", decision: "reject" }))).toBe(
      "invalid-argument",
    );
    expect(
      await call(reviewer, reviewAccountClaimContract, {
        uid: "uid-twin",
        decision: "reject",
        note: "Neither record fits.",
      }),
    ).toEqual({
      status: "rejected",
      personId: null,
    });

    expect(await claimOf("uid-twin")).toMatchObject({ status: "rejected", personId: null });
    expect(await reviewOf("uid-twin")).toMatchObject({ reviewedBy: "uid-admin", decisionNote: "Neither record fits." });
    expect(await auditOf("claim.rejected", "uid-twin")).toHaveLength(1);
    const notifications = await notificationsOf(claimant.uid);
    expect(notifications).toMatchObject([{ payload: { kind: "accountClaimRejected" } }]);
    expect(JSON.stringify(notifications)).not.toContain("Neither");
    expect(notifications[0]?.readAt).toBeNull();
    // The claim page shows the outcome, so the claim function marks its notification as read:
    // an account that is not linked may not write even its own documents.
    expect(await call(claimant, claimProfileContract, {})).toEqual({ status: "rejected" });
    expect((await notificationsOf(claimant.uid))[0]?.readAt).not.toBeNull();
    expect(
      await codeOf(call(reviewer, reviewAccountClaimContract, { uid: "uid-nobody", decision: "reject", note: "No." })),
    ).toBe("not-found");
  });
});

describe("reviewAccountClaim: someone whom no record names", () => {
  const admission = {
    uid: "uid-newcomer",
    decision: "approveAsNewMember",
    displayName: "Synthetic Requester",
    affiliation: "Example University",
  } as const;

  it("admits the person as a new, live member and links the account, in one transaction with its audit entries", async () => {
    const admin = await administrator("uid-admin");
    const newcomer = await account("uid-newcomer", { email: "synthetic.newcomer@example.org" });
    await call(newcomer, requestAccessContract, REQUEST);

    const answer = await call(admin, reviewAccountClaimContract, admission);
    expect(answer.status).toBe("approved");
    const personId = answer.personId ?? "";
    expect(await dataOf(`persons/${personId}`)).toMatchObject({
      displayName: "Synthetic Requester",
      affiliationSummary: "Example University",
      userId: "uid-newcomer",
      dataOrigin: "live",
      replicationIds: [],
    });
    expect((await dataOf(`persons/${personId}/private/contact`))?.emails).toMatchObject([
      { email: "synthetic.newcomer@example.org", kind: "primary", claimEligible: true },
    ]);
    expect((await dataOf(emailIndexPath("synthetic.newcomer@example.org")))?.personIds).toEqual([personId]);
    expect(await claimOf("uid-newcomer")).toMatchObject({ status: "approved", personId });
    expect((await accessOf("uid-newcomer")).member).toBe(true);
    expect(await auditOf("person.created", personId)).toHaveLength(1);
    expect(await auditOf("claim.approved", personId)).toHaveLength(1);
    expect(JSON.stringify(await auditOf("person.created", personId))).not.toContain("synthetic.newcomer@example.org");
  });

  it("is refused without the capability to create persons, for one's own account, and without a statement", async () => {
    const newcomer = await account("uid-newcomer", { email: "synthetic.newcomer@example.org" });
    const reviewer = await account("uid-reviewer", { mfaEnrolled: true, secondFactor: true });
    await grantCapability("uid-reviewer", "claims.review");
    const admin = await administrator("uid-admin");
    // A match that found nobody leaves no claim, and nothing is known to make a profile from.
    await call(newcomer, claimProfileContract, {});
    expect(await codeOf(call(admin, reviewAccountClaimContract, admission))).toBe("not-found");
    await call(newcomer, requestAccessContract, REQUEST);
    expect(await codeOf(call(reviewer, reviewAccountClaimContract, admission))).toBe("permission-denied");
    expect(await codeOf(call(newcomer, reviewAccountClaimContract, admission))).toBe("permission-denied");
    expect(await codeOf(call(null, reviewAccountClaimContract, admission))).toBe("unauthenticated");
    expect(await claimOf("uid-newcomer")).toMatchObject({ status: "pendingReview", personId: null });
    expect(await auditOf("person.created")).toHaveLength(0);
  });
});

describe("unlinkAccountClaim", () => {
  const unlinking = { uid: "uid-claimant", reason: "The wrong person of two with one name." };

  async function linkedAccount(): Promise<Caller> {
    await wellConnectedPerson("person-1", "well.connected@example.org");
    const caller = await account("uid-claimant", { email: "well.connected@example.org" });
    await call(caller, claimProfileContract, {});
    return caller;
  }

  it("refuses a caller who is signed out, has no capability or lacks the second factor", async () => {
    await linkedAccount();
    const core = await account("uid-core", { mfaEnrolled: true, secondFactor: true });
    await grantRole("uid-core", "core_team");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, unlinkAccountClaimContract, unlinking))).toBe("unauthenticated");
    // The core team reviews claims and does not hold the sensitive capability by default.
    expect(await codeOf(call(core, unlinkAccountClaimContract, unlinking))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, unlinkAccountClaimContract, unlinking))).toBe("failed-precondition");
    expect((await dataOf("persons/person-1"))?.userId).toBe("uid-claimant");
  });

  it("reverses the link and revokes the roles that the claim created, and no other", async () => {
    const claimant = await linkedAccount();
    const admin = await administrator("uid-admin");
    // A role that an administrator granted apart from the claim.
    await laboratory("lab-z");
    await grantRole("uid-claimant", "lab_member", "laboratory", "lab-z");

    expect(await call(admin, unlinkAccountClaimContract, unlinking)).toEqual({
      personId: "person-1",
      revokedRoleAssignments: 5,
    });

    expect(await dataOf("persons/person-1")).toMatchObject({ userId: null, claimedAt: null });
    expect((await dataOf("users/uid-claimant"))?.personId).toBeNull();
    for (const id of [
      "uid-claimant__lab_member__laboratory__lab-a",
      "uid-claimant__lab_coordinator__laboratory__lab-b",
      "uid-claimant__replication_lead__replication__StudyA2001",
      "uid-claimant__core_team__programme__eegmanylabs",
    ]) {
      expect(await assignmentOf(id)).toMatchObject({
        status: "revoked",
        revokedBy: "uid-admin",
        reason: unlinking.reason,
      });
    }
    expect((await assignmentOf("uid-claimant__lab_member__laboratory__lab-z"))?.status).toBe("active");
    const access = await accessOf("uid-claimant");
    expect(access).toMatchObject({
      personId: null,
      memberLaboratoryIds: ["lab-z"],
      pendingRoles: [],
      teamReplicationIds: [],
    });

    expect(await claimOf("uid-claimant")).toMatchObject({ status: "rejected", personId: null });
    const review = await reviewOf("uid-claimant");
    expect(review).toMatchObject({ reviewedBy: "uid-admin", decisionNote: unlinking.reason });
    expect(review.history).toMatchObject([{ status: "approved", matchBasis: "primaryEmail", reviewedBy: null }]);
    expect(await auditOf("claim.unlinked", "person-1")).toHaveLength(1);
    expect(await auditOf("role.revoked", "uid-claimant")).toHaveLength(5);
    expect(await notificationsOf(claimant.uid)).toMatchObject([{ payload: { kind: "accountUnlinked" } }]);

    // The next sign-in does not link the account to the same person again.
    expect(await call(claimant, claimProfileContract, {})).toEqual({ status: "rejected" });
    expect((await dataOf("persons/person-1"))?.userId).toBeNull();
    // There is nothing left to unlink.
    expect(await codeOf(call(admin, unlinkAccountClaimContract, unlinking))).toBe("failed-precondition");
    expect(await codeOf(callRaw(admin, "unlinkAccountClaim", { uid: "uid-claimant" }))).toBe("invalid-argument");
  });
});
