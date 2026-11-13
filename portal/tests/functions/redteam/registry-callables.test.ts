// Red-team attacks on the callable functions of the registry, the laboratories and the imports
// console, made through the functions emulator as signed-in callers who hold some right and try
// to stretch it: a laboratory coordinator who moves its own laboratory past the readiness that the
// replication decides, a reviewer of the reconciliation queue who decides about their own records
// (their own lead membership, and a merge into the profile they have claimed), a member who
// registers a laboratory that exists already by entering its institution as a new one, an
// administrator who approves their own registration, and a coordinator who decides a
// registration that duplicates its own laboratory.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people, institutions, laboratories and studies on the example.org domain.
import {
  COLLECTIONS,
  createParticipationContract,
  DEMO_IDENTITY_HASH_KEY,
  identityKeyId,
  ONBOARDING_CHECKLIST_TEMPLATE,
  organisationKey,
  type ParticipationStatus,
  participationDocSchema,
  requestLabClaimContract,
  resolveReconciliationItemContract,
  reviewLabClaimContract,
  setParticipationStatusContract,
} from "@eegml/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../../support/admin";
import {
  account,
  type Caller,
  call,
  codeOf,
  coreTeamMember,
  dataOf,
  grantRole,
  institution,
  laboratory,
  membership,
  membershipPath,
  person,
  replication,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

withoutTriggers();
beforeEach(resetWorld);

const STUDY = "SyntheticStudy2001";
const LAB = "lab-synthetic-own";
const PARTICIPATION = `${STUDY}__${LAB}`;

/** A member with a linked person, as a claim makes one. */
async function linkedMember(uid: string, personId: string): Promise<Caller> {
  await person(personId, [{ email: `${uid}@example.org` }], { userId: uid });
  return account(uid, { personId });
}

const keyPath = (entityType: "laboratory" | "institution", kind: string, key: string) =>
  COLLECTIONS.identityKeys.docPath(identityKeyId(entityType, kind, key, DEMO_IDENTITY_HASH_KEY));

async function identityKey(path: string, entityType: "laboratory" | "institution", entityIds: string[]) {
  await adminDb.doc(path).set({
    ...standard(),
    entityType,
    keyKind: "nameAffiliation",
    entityIds,
    status: "active",
    mergedIntoId: null,
  });
}

describe("the status of a participation, as the coordinator of its laboratory", () => {
  async function world() {
    await replication(STUDY);
    await laboratory(LAB);
    await adminDb
      .doc(COLLECTIONS.checklistTemplates.docPath(ONBOARDING_CHECKLIST_TEMPLATE.key))
      .set({ ...standard(), key: ONBOARDING_CHECKLIST_TEMPLATE.key, items: ONBOARDING_CHECKLIST_TEMPLATE.items });
    const lead = await account("uid-lead");
    await grantRole("uid-lead", "replication_lead", "replication", STUDY);
    const coordinator = await account("uid-coordinator");
    await grantRole("uid-coordinator", "lab_coordinator", "laboratory", LAB);
    await call(lead, createParticipationContract, { replicationId: STUDY, laboratoryId: LAB });
    return { lead, coordinator };
  }

  const change = (fromStatus: ParticipationStatus, toStatus: ParticipationStatus) =>
    ({ participationId: PARTICIPATION, fromStatus, toStatus, reason: "Synthetic reason." }) as const;

  const storedStatus = async () =>
    participationDocSchema.parse(await dataOf(COLLECTIONS.participations.docPath(PARTICIPATION))).status;

  it("is not moved into collection past the readiness that the replication decides", async () => {
    const { coordinator } = await world();
    await call(coordinator, setParticipationStatusContract, change("invited", "confirmed"));
    await call(coordinator, setParticipationStatusContract, change("confirmed", "onboarding"));
    // The control: the coordinator cannot say that its own laboratory is ready.
    expect(await codeOf(call(coordinator, setParticipationStatusContract, change("onboarding", "ready")))).toBe(
      "permission-denied",
    );
    // The attack: the coordinator jumps over ready, straight into collection.
    const jumped = await codeOf(call(coordinator, setParticipationStatusContract, change("onboarding", "collecting")));
    expect(["permission-denied", "failed-precondition"]).toContain(jumped);
    expect(await storedStatus()).toBe("onboarding");
  });

  it("is not marked as having completed collection by the coordinator of a laboratory that was never ready", async () => {
    const { coordinator } = await world();
    const jumped = await codeOf(
      call(coordinator, setParticipationStatusContract, change("invited", "collectionComplete")),
    );
    expect(["permission-denied", "failed-precondition"]).toContain(jumped);
    expect(await storedStatus()).toBe("invited");
  });
});

describe("resolveReconciliationItem: deciding leads", () => {
  async function world() {
    await replication(STUDY);
    await person("person-one");
    await person("person-two");
    await membership(STUDY, "person-one", "lead");
    await membership(STUDY, "person-two", "lead");
    await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("lead-conflict")).set({
      ...standard(),
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
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: "run__20260101T000000000Z__aaaaaaaaaaaa",
    });
  }

  it("does not let a reviewer of the queue confirm their own lead membership through an item about other people", async () => {
    await world();
    // A member of the core team holds the reconciliation capability and has a lead membership
    // of their own that awaits the programme's review.
    await person("person-core", [], { userId: "uid-core" });
    const core = await coreTeamMember("uid-core");
    await membership(STUDY, "person-core", "lead", { reviewStatus: "needsReview" });

    const answer = await codeOf(
      call(core, resolveReconciliationItemContract, {
        fingerprint: "lead-conflict",
        action: "decideLeads",
        memberships: [
          { personId: "person-one", role: "lead", outcome: "current" },
          { personId: "person-core", role: "lead", outcome: "current" },
        ],
      }),
    );
    expect(["invalid-argument", "permission-denied"]).toContain(answer);
    expect(await dataOf(membershipPath(STUDY, "person-core", "lead"))).toMatchObject({ reviewStatus: "needsReview" });
    expect((await dataOf(COLLECTIONS.replications.docPath(STUDY)))?.leadPersonIds ?? []).not.toContain("person-core");
  });
});

describe("registering a laboratory that exists already", () => {
  const NAME = "Synthetic Imported University";

  async function world() {
    // An institution and a laboratory that an import created under identifiers of its own, with
    // the name keys that an import reserves.
    await institution("inst-imported", []);
    await adminDb.doc(COLLECTIONS.institutions.docPath("inst-imported")).update({ name: NAME, countryCode: "GB" });
    await identityKey(
      keyPath("institution", "nameAffiliation", organisationKey.institution(NAME, "GB") ?? ""),
      "institution",
      ["inst-imported"],
    );
    await laboratory("lab__imported", { name: "Imported Laboratory", institutionId: "inst-imported" });
    await identityKey(
      keyPath(
        "laboratory",
        "nameAffiliation",
        organisationKey.laboratory("inst-imported", "Imported Laboratory") ?? "",
      ),
      "laboratory",
      ["lab__imported"],
    );
    const coordinator = await account("uid-imported-coordinator");
    await grantRole("uid-imported-coordinator", "lab_coordinator", "laboratory", "lab__imported");
    return { coordinator };
  }

  it("is found as a duplicate when its institution is entered as a new one under the same name", async () => {
    await world();
    const ada = await linkedMember("uid-ada", "person-ada");
    const outcome = await call(ada, requestLabClaimContract, {
      proposal: {
        name: "Imported Laboratory",
        institution: { kind: "new", name: NAME, countryCode: "GB", city: "Exampleton" },
      },
      requestedRole: "coordinator",
    }).then(
      (answer) => ({ duplicate: answer.duplicate }),
      () => ({ duplicate: true }),
    );
    // Secure: the request is refused, or it is marked as a duplicate for the reviewer to see.
    expect(outcome.duplicate).toBe(true);
  });

  it("is not decided by the coordinator of the laboratory it duplicates", async () => {
    const { coordinator } = await world();
    const ada = await linkedMember("uid-ada", "person-ada");
    const { claimId, duplicate } = await call(ada, requestLabClaimContract, {
      proposal: { name: "imported laboratory", institution: { kind: "existing", institutionId: "inst-imported" } },
      requestedRole: "coordinator",
    });
    expect(duplicate).toBe(true);
    expect(await codeOf(call(coordinator, reviewLabClaimContract, { claimId, decision: "approve" }))).toBe(
      "permission-denied",
    );
    expect((await dataOf(COLLECTIONS.labClaims.docPath(claimId)))?.status).toBe("pendingReview");
  });
});

describe("deciding about oneself", () => {
  it("does not let a programme administrator approve the registration of a laboratory that they proposed", async () => {
    await person("person-admin", [{ email: "uid-admin@example.org" }], { userId: "uid-admin" });
    const admin = await account("uid-admin", { personId: "person-admin", mfaEnrolled: true, secondFactor: true });
    await grantRole("uid-admin", "programme_admin");
    const { claimId } = await call(admin, requestLabClaimContract, {
      proposal: {
        name: "Synthetic Self Laboratory",
        institution: { kind: "new", name: "Synthetic Self University", countryCode: "GB", city: "Exampleton" },
      },
      requestedRole: "coordinator",
    });
    expect(await codeOf(call(admin, reviewLabClaimContract, { claimId, decision: "approve" }))).toBe(
      "permission-denied",
    );
    expect((await dataOf(COLLECTIONS.labClaims.docPath(claimId)))?.status).toBe("pendingReview");
  });

  it("does not let a reviewer of the queue merge another record into the record they have claimed", async () => {
    await replication(STUDY);
    await laboratory(LAB);
    await person("person-core", [{ email: "uid-core@example.org" }], { userId: "uid-core" });
    const core = await coreTeamMember("uid-core");
    // A record of someone else, with a confirmed coordinator entry and a confirmed lead membership.
    await person("person-other", [{ email: "other.person@example.org" }]);
    await adminDb.doc(COLLECTIONS.laboratoryMembers.docPath(LAB, "person-other")).set({
      ...standard(),
      laboratoryId: LAB,
      personId: "person-other",
      role: "coordinator",
      isAuthorisedRepresentative: true,
      earlierPeriods: [],
      status: "confirmed",
    });
    await membership(STUDY, "person-other", "lead", { reviewStatus: "confirmed" });
    await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("duplicate")).set({
      ...standard(),
      kind: "duplicatePerson",
      entityRefs: [
        { entityType: "person", entityId: "person-core" },
        { entityType: "person", entityId: "person-other" },
      ],
      candidates: [],
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: "run__20260101T000000000Z__aaaaaaaaaaaa",
    });
    const answer = await codeOf(
      call(core, resolveReconciliationItemContract, {
        fingerprint: "duplicate",
        action: "mergePersons",
        keepPersonId: "person-core",
        mergePersonId: "person-other",
      }),
    );
    expect(answer).toBe("permission-denied");
    expect((await dataOf(COLLECTIONS.laboratoryMembers.docPath(LAB, "person-core"))) ?? null).toBeNull();
    expect((await dataOf(COLLECTIONS.personContact.docPath("person-core")))?.emails).toHaveLength(1);
  });
});
