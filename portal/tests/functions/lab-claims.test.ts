// Integration tests of laboratory claiming, run against the emulators: requestLabClaim and
// reviewLabClaim.
// Fixtures are synthetic: fictitious accounts, people and laboratories on the example.org domain.
import {
  can,
  labClaimDocSchema,
  labClaimReviewDocSchema,
  laboratoryMemberDocSchema,
  publicErrorReason,
  requestLabClaimContract,
  reviewLabClaimContract,
  roleAssignmentDocSchema,
  withdrawLabClaimContract,
} from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addressInDomains } from "../../functions/src/callables/requestLabClaim";
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
  eventually,
  grantRole,
  institution,
  laboratory,
  leaveNoTrace,
  memberEntry,
  memberEntryPath,
  notificationsOf,
  person,
  refusal,
  resetWorld,
} from "./support";

beforeEach(resetWorld);

afterAll(leaveNoTrace);

const CLAIM = "uid-member__lab-a";
const claimOf = async (id = CLAIM) => labClaimDocSchema.parse(await dataOf(`labClaims/${id}`));
const reviewOf = async (id = CLAIM) => labClaimReviewDocSchema.parse(await dataOf(`labClaims/${id}/private/review`));

/** A member with a linked person, and a laboratory at an institution with an email domain. */
async function member(emailDomains: readonly string[] = ["example.org"]): Promise<Caller> {
  const email = "member@example.org";
  await institution("inst-a", emailDomains);
  await laboratory("lab-a", { institutionId: "inst-a" });
  await person("person-1", [{ email }], { userId: "uid-member" });
  return account("uid-member", { email, personId: "person-1" });
}

/** A coordinator of a laboratory, as an approved role assignment makes one. */
async function coordinatorOf(laboratoryId: string, uid: string): Promise<Caller> {
  const caller = await account(uid);
  await grantRole(uid, "lab_coordinator", "laboratory", laboratoryId);
  return caller;
}

describe("the email domains of an institution", () => {
  it("match an address in the domain or in a subdomain of it, and nothing that merely ends alike", () => {
    const at = (domain: string) => `somebody@${domain}`;
    expect(addressInDomains(at("uni.example.org"), ["uni.example.org"])).toBe(true);
    expect(addressInDomains(at("psy.uni.example.org"), ["UNI.example.org"])).toBe(true);
    expect(addressInDomains(at("notuni.example.org"), ["uni.example.org"])).toBe(false);
    expect(addressInDomains(at("uni.example.org.attacker.example"), ["uni.example.org"])).toBe(false);
    expect(addressInDomains(at("uni.example.org"), [])).toBe(false);
    expect(addressInDomains(at("uni.example.org"), ["", 7, null])).toBe(false);
  });
});

describe("requestLabClaim", () => {
  const request = { laboratoryId: "lab-a", requestedRole: "coordinator" } as const;

  it("refuses a caller who is signed out, unverified or has no linked person", async () => {
    await member();
    const unlinked = await account("uid-unlinked");
    const unverified: Caller = { uid: "uid-member", email: "member@example.org", emailVerified: false };

    expect(await codeOf(call(null, requestLabClaimContract, request))).toBe("unauthenticated");
    expect(await codeOf(call(unverified, requestLabClaimContract, request))).toBe("failed-precondition");
    const refused = await refusal(call(unlinked, requestLabClaimContract, request));
    expect(refused.code).toBe("failed-precondition");
    expect(publicErrorReason(refused.details)).toBe("notLinked");
    expect(await dataOf("labClaims/uid-unlinked__lab-a")).toBeUndefined();
  });

  it("stores the request with evidence that the server computed, and notifies whoever decides it", async () => {
    const caller = await member();
    const admin = await administrator("uid-admin");
    const coordinator = await coordinatorOf("lab-a", "uid-coordinator");
    const elsewhere = await coordinatorOf("lab-b", "uid-elsewhere");
    await memberEntry("lab-a", "person-1", { status: "confirmed" });
    // The trigger puts the laboratory of the confirmed entry on the person.
    await eventually(
      async () => (((await dataOf("persons/person-1"))?.laboratoryIds ?? []) as string[]).includes("lab-a"),
      "the laboratory on the person",
    );

    expect(
      await call(caller, requestLabClaimContract, { ...request, message: "I run the laboratory since March." }),
    ).toEqual({
      claimId: CLAIM,
      laboratoryId: "lab-a",
      status: "pendingReview",
      duplicate: false,
    });

    expect(await claimOf()).toMatchObject({
      laboratoryId: "lab-a",
      uid: "uid-member",
      requestedRole: "coordinator",
      status: "pendingReview",
    });
    const review = await reviewOf();
    expect(review.evidence).toEqual({
      personListsLaboratory: true,
      memberEntry: { status: "confirmed", role: "member", archived: false },
      emailDomainMatchesInstitution: true,
      message: "I run the laboratory since March.",
    });
    // The address itself is no part of the evidence.
    expect(JSON.stringify(review)).not.toContain("example.org");
    expect(await auditOf("labClaim.requested", "lab-a")).toHaveLength(1);
    for (const reviewer of [admin, coordinator]) {
      expect(await notificationsOf(reviewer.uid)).toMatchObject([
        {
          type: "claimDecision",
          entityType: "laboratory",
          entityId: "lab-a",
          payload: { kind: "labClaimAwaitsReview" },
        },
      ]);
    }
    expect(await notificationsOf(elsewhere.uid)).toEqual([]);
    // Nothing is granted by asking.
    expect((await accessOf("uid-member")).coordinatorLaboratoryIds).toEqual([]);
  });

  it("computes the evidence from the records, whatever the caller says", async () => {
    // The institution of the laboratory lists a domain that the caller's address does not lie in.
    const caller = await member(["another-university.example"]);
    await laboratory("lab-free");

    await call(caller, requestLabClaimContract, request);
    expect((await reviewOf()).evidence).toEqual({
      personListsLaboratory: false,
      memberEntry: null,
      emailDomainMatchesInstitution: false,
    });
    // A laboratory that names no institution gives no answer about the domain.
    await call(caller, requestLabClaimContract, { laboratoryId: "lab-free", requestedRole: "representative" });
    expect((await reviewOf("uid-member__lab-free")).evidence.emailDomainMatchesInstitution).toBeNull();
    // The caller cannot supply evidence of their own.
    expect(
      await codeOf(
        callRaw(caller, "requestLabClaim", { ...request, evidence: { emailDomainMatchesInstitution: true } }),
      ),
    ).toBe("invalid-argument");
    expect(await codeOf(callRaw(caller, "requestLabClaim", { ...request, requestedRole: "pi" }))).toBe(
      "invalid-argument",
    );
  });

  it("allows one open request per account and laboratory, and refuses a laboratory that does not exist", async () => {
    const caller = await member();
    await laboratory("lab-b");
    await call(caller, requestLabClaimContract, request);

    const second = await refusal(
      call(caller, requestLabClaimContract, { ...request, requestedRole: "representative" }),
    );
    expect(second.code).toBe("resource-exhausted");
    expect((await claimOf()).requestedRole).toBe("coordinator");
    expect(await auditOf("labClaim.requested", "lab-a")).toHaveLength(1);
    // Another laboratory is another request.
    expect((await call(caller, requestLabClaimContract, { ...request, laboratoryId: "lab-b" })).claimId).toBe(
      "uid-member__lab-b",
    );
    expect(await codeOf(call(caller, requestLabClaimContract, { ...request, laboratoryId: "lab-missing" }))).toBe(
      "not-found",
    );
  });
});

describe("reviewLabClaim", () => {
  const approve = { claimId: CLAIM, decision: "approve" } as const;

  async function openClaim(requestedRole: "coordinator" | "representative" = "coordinator"): Promise<Caller> {
    const caller = await member();
    await call(caller, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole });
    return caller;
  }

  it("refuses whoever may not decide for that laboratory, and the claimant themselves", async () => {
    const claimant = await openClaim();
    const elsewhere = await coordinatorOf("lab-b", "uid-elsewhere");
    const ordinary = await account("uid-ordinary");
    await grantRole("uid-ordinary", "lab_member", "laboratory", "lab-a");
    const withoutFactor = await administrator("uid-admin", { secondFactor: false });

    expect(await codeOf(call(null, reviewLabClaimContract, approve))).toBe("unauthenticated");
    // A coordinator of another laboratory is out of scope, and so is a member of this one.
    expect(await codeOf(call(elsewhere, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect(await codeOf(call(ordinary, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect(await codeOf(call(claimant, reviewLabClaimContract, approve))).toBe("permission-denied");
    expect(await codeOf(call(withoutFactor, reviewLabClaimContract, approve))).toBe("failed-precondition");
    expect(await codeOf(call(elsewhere, reviewLabClaimContract, { ...approve, claimId: "uid-x__lab-b" }))).toBe(
      "permission-denied",
    );
    expect((await claimOf()).status).toBe("pendingReview");
    expect((await accessOf("uid-member")).coordinatorLaboratoryIds).toEqual([]);
  });

  it("lets an existing coordinator of the laboratory approve: the role, the member entry and the person follow", async () => {
    const claimant = await openClaim();
    const coordinator = await coordinatorOf("lab-a", "uid-coordinator");

    expect(await call(coordinator, reviewLabClaimContract, { ...approve, note: "Known to the laboratory." })).toEqual({
      claimId: CLAIM,
      status: "approved",
    });

    expect((await claimOf()).status).toBe("approved");
    expect(await reviewOf()).toMatchObject({ reviewedBy: "uid-coordinator", decisionNote: "Known to the laboratory." });
    const assignment = roleAssignmentDocSchema.parse(
      await dataOf("roleAssignments/uid-member__lab_coordinator__laboratory__lab-a"),
    );
    expect(assignment).toMatchObject({ status: "active", grantedBy: "uid-coordinator" });
    const entry = laboratoryMemberDocSchema.parse(await dataOf(memberEntryPath("lab-a", "person-1")));
    expect(entry).toMatchObject({
      role: "coordinator",
      isAuthorisedRepresentative: true,
      status: "confirmed",
      earlierPeriods: [],
    });
    expect((await dataOf("persons/person-1"))?.laboratoryIds).toEqual(["lab-a"]);
    const access = await accessOf("uid-member");
    expect(access.coordinatorLaboratoryIds).toEqual(["lab-a"]);
    expect(can(access, "labs.manage", { laboratoryId: "lab-a" })).toBe(true);

    expect(await auditOf("labClaim.approved", "lab-a")).toMatchObject([{ actorUid: "uid-coordinator" }]);
    expect(await auditOf("role.granted", "uid-member")).toHaveLength(1);
    const notifications = await notificationsOf(claimant.uid);
    expect(notifications).toMatchObject([{ payload: { kind: "labClaimApproved", requestedRole: "coordinator" } }]);
    expect(JSON.stringify(notifications)).not.toContain("Known to");
    // The same decision again changes nothing, and the other decision comes too late.
    await call(coordinator, reviewLabClaimContract, approve);
    expect(await auditOf("labClaim.approved", "lab-a")).toHaveLength(1);
    expect(
      await codeOf(call(coordinator, reviewLabClaimContract, { claimId: CLAIM, decision: "reject", note: "No." })),
    ).toBe("failed-precondition");
  });

  it("gives a laboratory a second authorised representative, as a member, on the approval of the core team", async () => {
    await openClaim("representative");
    const core = await coreTeamMember("uid-core");
    await person("person-pi", [], { userId: "uid-pi" });
    await memberEntry("lab-a", "person-pi", { role: "pi", isAuthorisedRepresentative: true, status: "confirmed" });

    await call(core, reviewLabClaimContract, approve);

    expect(
      roleAssignmentDocSchema.parse(await dataOf("roleAssignments/uid-member__lab_member__laboratory__lab-a")).status,
    ).toBe("active");
    expect(await dataOf("roleAssignments/uid-member__lab_coordinator__laboratory__lab-a")).toBeUndefined();
    expect(await dataOf(memberEntryPath("lab-a", "person-1"))).toMatchObject({
      role: "representative",
      isAuthorisedRepresentative: true,
    });
    // The laboratory now has two authorised representatives.
    expect(await dataOf(memberEntryPath("lab-a", "person-pi"))).toMatchObject({
      role: "pi",
      isAuthorisedRepresentative: true,
    });
    const access = await accessOf("uid-member");
    expect(access.memberLaboratoryIds).toEqual(["lab-a"]);
    expect(can(access, "labs.manage", { laboratoryId: "lab-a" })).toBe(false);
  });

  it("keeps the role of a principal investigator on an entry that exists already", async () => {
    const claimant = await member();
    await memberEntry("lab-a", "person-1", { role: "pi", startDate: "2020-01-01" });
    await call(claimant, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "coordinator" });
    const admin = await administrator("uid-admin");

    await call(admin, reviewLabClaimContract, approve);

    expect(await dataOf(memberEntryPath("lab-a", "person-1"))).toMatchObject({
      role: "pi",
      isAuthorisedRepresentative: true,
      status: "confirmed",
      startDate: "2020-01-01",
    });
  });

  it("rejects with a note, grants nothing, and lets the member ask again", async () => {
    const claimant = await openClaim();
    const admin = await administrator("uid-admin");

    expect(await codeOf(callRaw(admin, "reviewLabClaim", { claimId: CLAIM, decision: "reject" }))).toBe(
      "invalid-argument",
    );
    expect(
      await call(admin, reviewLabClaimContract, {
        claimId: CLAIM,
        decision: "reject",
        note: "The laboratory has a coordinator.",
      }),
    ).toEqual({
      claimId: CLAIM,
      status: "rejected",
    });

    expect((await claimOf()).status).toBe("rejected");
    expect((await accessOf("uid-member")).coordinatorLaboratoryIds).toEqual([]);
    expect(await dataOf(memberEntryPath("lab-a", "person-1"))).toBeUndefined();
    expect(await auditOf("labClaim.rejected", "lab-a")).toHaveLength(1);
    expect(await notificationsOf(claimant.uid)).toMatchObject([{ payload: { kind: "labClaimRejected" } }]);

    await call(claimant, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "representative" });
    expect(await claimOf()).toMatchObject({ status: "pendingReview", requestedRole: "representative" });
    expect((await reviewOf()).history).toMatchObject([
      {
        status: "rejected",
        requestedRole: "coordinator",
        reviewedBy: "uid-admin",
        decisionNote: "The laboratory has a coordinator.",
      },
    ]);
  });
});

describe("withdrawLabClaim", () => {
  it("lets the member withdraw their own request while it waits, and nobody else, with an audit entry", async () => {
    const caller = await member();
    await call(caller, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "coordinator" });
    const coordinator = await coordinatorOf("lab-a", "uid-coordinator");
    const admin = await administrator("uid-admin");
    expect(await codeOf(call(coordinator, withdrawLabClaimContract, { claimId: CLAIM }))).toBe("permission-denied");
    expect(await codeOf(call(admin, withdrawLabClaimContract, { claimId: CLAIM }))).toBe("permission-denied");
    expect(await codeOf(call(null, withdrawLabClaimContract, { claimId: CLAIM }))).toBe("unauthenticated");
    // A request that does not exist is answered as one that is not the caller's.
    expect(await codeOf(call(caller, withdrawLabClaimContract, { claimId: "uid-member__lab-missing" }))).toBe(
      "permission-denied",
    );
    expect((await claimOf()).status).toBe("pendingReview");

    expect(await call(caller, withdrawLabClaimContract, { claimId: CLAIM })).toEqual({
      claimId: CLAIM,
      status: "withdrawn",
    });
    expect((await claimOf()).status).toBe("withdrawn");
    expect(await auditOf("labClaim.withdrawn", "lab-a")).toHaveLength(1);
    // A reviewer can no longer decide it, and the member may ask again.
    expect(await codeOf(call(admin, reviewLabClaimContract, { claimId: CLAIM, decision: "approve" }))).toBe(
      "failed-precondition",
    );
    await call(caller, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "coordinator" });
    expect((await claimOf()).status).toBe("pendingReview");
  });

  it("leaves a decided request as it was decided", async () => {
    const caller = await member();
    await call(caller, requestLabClaimContract, { laboratoryId: "lab-a", requestedRole: "coordinator" });
    const admin = await administrator("uid-admin");
    await call(admin, reviewLabClaimContract, { claimId: CLAIM, decision: "reject", note: "Synthetic note." });
    expect(await codeOf(call(caller, withdrawLabClaimContract, { claimId: CLAIM }))).toBe("failed-precondition");
    expect((await claimOf()).status).toBe("rejected");
  });
});
