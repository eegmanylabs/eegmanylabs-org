// Red-team attempts to gain rights that nobody gave: writing the documents from which access is
// resolved, linking a login to the profile of another person, confirming one's own entry in a
// unit, naming oneself a lead, changing a status and deleting records.
// Each test states the secure behaviour, so a test that fails has found a hole. Beside the
// refusals, each table holds a request that is accepted, so that a refusal is about the attack
// and not about a malformed document.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { capabilityGrantId, labClaimId, recordGrantId, replicationMembershipId, roleAssignmentId } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { arrayUnion, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { type Actor, expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  autoId,
  CALLERS,
  type CallerKind,
  firestoreOf,
  firestoreWithToken,
  MEMBER_PERSON,
  MEMBER_UID,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  STORED_AT,
  stored,
  tokenOf,
  uidOfCaller,
} from "../world";
import { EVERYONE, forEach, newRecord, seed, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { create, update, remove } = requestsOf(() => environment);
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);
type SignedIn = (typeof EVERYONE)[number];

const UNCLAIMED_PERSON = "persons/person-synthetic-unclaimed";
const PROPOSED_MEMBER = `laboratories/${OWN_LABORATORY}/members/${MEMBER_PERSON}`;
const MEMBERSHIPS = `replications/${OWN_REPLICATION}/memberships`;
const UNCONFIRMED_MEMBERSHIP = `${MEMBERSHIPS}/${replicationMembershipId(MEMBER_PERSON, "advisor")}`;
const LEAD_MEMBERSHIP = `${MEMBERSHIPS}/${replicationMembershipId("person-synthetic-own-lead", "lead")}`;

const membership = (personId: string, role: string, reviewStatus: string) => ({
  replicationId: OWN_REPLICATION,
  personId,
  role,
  isCurrent: true,
  earlierPeriods: [],
  reviewStatus,
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-self-grant");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await seed(environment, {
    [UNCLAIMED_PERSON]: {
      ...stored(),
      slug: "synthetic-unclaimed",
      displayName: "Synthetic Unclaimed",
      laboratoryIds: [OWN_LABORATORY],
      replicationIds: [OWN_REPLICATION],
      isCoreTeam: true,
      publicListing: "coreTeam",
      coreRoles: ["Synthetic role"],
      userId: null,
      claimedAt: null,
      custom: {},
      dataOrigin: "demo",
    },
    [PROPOSED_MEMBER]: {
      ...stored(),
      laboratoryId: OWN_LABORATORY,
      personId: MEMBER_PERSON,
      role: "member",
      isAuthorisedRepresentative: false,
      earlierPeriods: [],
      status: "proposed",
    },
    [UNCONFIRMED_MEMBERSHIP]: { ...stored(), ...membership(MEMBER_PERSON, "advisor", "needsReview") },
    [LEAD_MEMBERSHIP]: { ...stored(), ...membership("person-synthetic-own-lead", "lead", "confirmed") },
  });
});

describe("the documents from which access is resolved", () => {
  it("refuse every write to the caller's own access document", async () => {
    const grant = { member: true, programmeRoles: ["programme_admin"], mfaEnrolled: true, secondFactorRequired: false };
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "makes itself an administrator", (caller) =>
        update(caller, `access/${uidOfCaller(caller)}`, grant),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "merges a capability into its access document",
        (caller) => () =>
          setDoc(
            doc(dbOf(caller), `access/${uidOfCaller(caller)}`),
            {
              capabilities: { rolesManage: ["programme"], demographicsRead: ["programme"] },
              scopeKeys: arrayUnion("programme"),
            },
            { merge: true },
          ),
      ),
      "suspended: lifts its own suspension": [
        "denied",
        update("suspended", `access/${uidOfCaller("suspended")}`, { suspended: false }),
      ],
      "adminWithoutFactor: says that it needs no second factor": [
        "denied",
        update("adminWithoutFactor", `access/${uidOfCaller("adminWithoutFactor")}`, { secondFactorRequired: false }),
      ],
      "otherLead: adds the owning replication to the replications it leads": [
        "denied",
        update("otherLead", `access/${uidOfCaller("otherLead")}`, {
          leadReplicationIds: arrayUnion(OWN_REPLICATION),
          scopeKeys: arrayUnion(`rep:${OWN_REPLICATION}`),
          manageScopeKeys: arrayUnion(`rep:${OWN_REPLICATION}`),
        }),
      ],
    });
  });

  it("refuse an account that has no access document the creation of one", async () => {
    const uid = "uid-redteam-first-sign-in";
    const fresh: Actor = { db: firestoreWithToken(environment, uid, tokenOf(CALLERS.noMembership)), uid };
    await expectOutcomes({
      "creates its access document as a member": [
        "denied",
        create(fresh, `access/${uid}`, { ...CALLERS.member.access }),
      ],
      "creates its login profile": [
        "denied",
        create(fresh, `users/${uid}`, {
          emailLower: "first.sign.in@example.org",
          displayName: "Synthetic Newcomer",
          personId: OWNER_PERSON,
          status: "active",
          mfaEnrolled: false,
          lastSeenAt: STORED_AT,
          dataOrigin: "live",
        }),
      ],
      "creates an approved claim on the profile of another person": [
        "denied",
        create(fresh, `accountClaims/${uid}`, {
          uid,
          status: "approved",
          personId: OWNER_PERSON,
          submittedAt: STORED_AT,
        }),
      ],
    });
  });

  it("refuse every client a role assignment, a named grant, a record grant and an override of the matrix", async () => {
    const assignment = (uid: string) => ({
      uid,
      role: "programme_admin",
      scopeType: "programme",
      scopeId: "programme",
      status: "active",
      grantedBy: uid,
      grantedAt: serverTimestamp(),
      expiresAt: null,
      revokedBy: null,
      revokedAt: null,
      history: [],
    });
    const uidOf = (caller: SignedIn) => uidOfCaller(caller);
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "assigns itself the role of programme administrator", (caller) =>
        create(
          caller,
          `roleAssignments/${roleAssignmentId(uidOf(caller), "programme_admin", "programme", "programme")}`,
          assignment(uidOf(caller)),
        ),
      ),
      ...forEach(EVERYONE, "denied", "assigns itself the lead of the owning replication", (caller) =>
        create(
          caller,
          `roleAssignments/${roleAssignmentId(uidOf(caller), "replication_lead", "replication", OWN_REPLICATION)}-new`,
          {
            ...assignment(uidOf(caller)),
            role: "replication_lead",
            scopeType: "replication",
            scopeId: OWN_REPLICATION,
          },
        ),
      ),
      ...forEach(EVERYONE, "denied", "grants itself the reading of demographic data", (caller) =>
        create(caller, `capabilityGrants/${capabilityGrantId(uidOf(caller), "demographics.read")}-new`, {
          uid: uidOf(caller),
          capability: "demographics.read",
          grantedBy: uidOf(caller),
          grantedAt: serverTimestamp(),
          reason: "A synthetic reason.",
          expiresAt: null,
          revokedBy: null,
          revokedAt: null,
          history: [],
        }),
      ),
      ...forEach(EVERYONE, "denied", "grants itself the editing of a record", (caller) =>
        create(caller, `recordGrants/${recordGrantId(uidOf(caller), "replication", OTHER_REPLICATION)}`, {
          uid: uidOf(caller),
          entityType: "replication",
          entityId: OTHER_REPLICATION,
          level: "edit",
          grantedBy: uidOf(caller),
          grantedAt: serverTimestamp(),
          expiresAt: null,
          revokedAt: null,
        }),
      ),
      ...forEach(EVERYONE, "denied", "switches a sensitive capability on for the core team", (caller) =>
        update(caller, storedPath("roleCapabilities"), {
          "overrides.rolesManage": true,
          "overrides.demographicsRead": true,
        }),
      ),
      ...forEach(EVERYONE, "denied", "renews an existing role assignment", (caller) =>
        update(caller, storedPath("roleAssignments"), { uid: uidOf(caller), expiresAt: null, status: "active" }),
      ),
      ...forEach(EVERYONE, "denied", "sends itself an invitation as a programme administrator", (caller) =>
        create(caller, `invitations/invitation-${caller}`, {
          email: "invited.again@example.org",
          personId: null,
          role: "programme_admin",
          scopeType: "programme",
          scopeId: "programme",
          tokenHash: "0123456789abcdef".repeat(4),
          expiresAt: STORED_AT,
          acceptedAt: null,
          invitedBy: uidOf(caller),
          revokedAt: null,
        }),
      ),
    });
  });

  it("refuse every client the member list of a group, its managers included", async () => {
    const group = storedPath("groups");
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "adds itself to the group", (caller) =>
        update(caller, group, { memberUids: arrayUnion(uidOfCaller(caller)) }),
      ),
      ...forEach(EVERYONE, "denied", "makes itself a manager of the group", (caller) =>
        update(caller, group, { [`roles.${uidOfCaller(caller)}`]: "manager" }),
      ),
      ...forEach(EVERYONE, "denied", "creates a group that it manages", (caller) =>
        create(caller, `groups/group-of-${caller}`, {
          groupKey: `group-of-${caller}`,
          kind: "custom",
          name: "A synthetic group",
          replicationId: OWN_REPLICATION,
          laboratoryId: null,
          pageId: null,
          memberUids: [uidOfCaller(caller)],
          roles: { [uidOfCaller(caller)]: "manager" },
          unclaimedPersonIds: [],
        }),
      ),
    });
  });

  it("refuse a user the decision of its own claims", async () => {
    await expectOutcomes({
      "owner: changes the person of its account claim": [
        "denied",
        update("owner", `accountClaims/${OWNER_UID}`, { personId: "person-synthetic-admin", status: "approved" }),
      ],
      "owner: approves its request to represent a laboratory": [
        "denied",
        update("owner", storedPath("labClaims"), { status: "approved", requestedRole: "coordinator" }),
      ],
      "owner: writes the review of its request": [
        "denied",
        update("owner", storedPath("labClaimReview"), { reviewedBy: OWNER_UID, decisionNote: "Approved." }),
      ],
      "member: files an approved request to coordinate a laboratory": [
        "denied",
        create("member", `labClaims/${labClaimId(MEMBER_UID, OWN_LABORATORY)}`, {
          laboratoryId: OWN_LABORATORY,
          uid: MEMBER_UID,
          requestedRole: "coordinator",
          status: "approved",
          submittedAt: STORED_AT,
        }),
      ],
      "ownCoordinator: approves a request although only a function decides one": [
        "denied",
        update("ownCoordinator", storedPath("labClaims"), { status: "approved" }),
      ],
      "owner: changes the status and the person of its login profile": [
        "denied",
        update("owner", `users/${OWNER_UID}`, { personId: "person-synthetic-admin", mfaEnrolled: true }),
      ],
    });
  });
});

describe("the link between a login and a person", () => {
  it("is never written by a client: not for an unclaimed profile, not for a claimed one, not by its owner", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "claims an unclaimed profile", (caller) =>
        update(caller, UNCLAIMED_PERSON, { userId: uidOfCaller(caller), claimedAt: serverTimestamp() }),
      ),
      ...forEach(
        EVERYONE.filter((caller) => caller !== "owner"),
        "denied",
        "takes over the profile of another account",
        (caller) => update(caller, `persons/${OWNER_PERSON}`, { userId: uidOfCaller(caller) }),
      ),
      "owner: hands its profile to another account": [
        "denied",
        update("owner", `persons/${OWNER_PERSON}`, { userId: MEMBER_UID }),
      ],
      "owner: unlinks its profile": [
        "denied",
        update("owner", `persons/${OWNER_PERSON}`, { userId: null, claimedAt: null }),
      ],
    });
  });

  it("gives the owner of a profile three addresses and nothing that widens what the owner or anyone else may read", async () => {
    const own = `persons/${OWNER_PERSON}`;
    await expectOutcomes({
      "owner: sets the address of its profile at its university": [
        "allowed",
        update("owner", own, { universityUrl: "https://example.org/people/synthetic-owner" }),
      ],
      // Imports find a person again by the ORCID iD, and a rule cannot tell whose an iD is, so a
      // callable function changes it and reserves the identity key in the same transaction.
      "owner: sets its ORCID iD": ["denied", update("owner", own, { orcid: "0000-0002-1825-0097" })],
      "owner: adds a replication to its units": [
        "denied",
        update("owner", own, { replicationIds: arrayUnion(OTHER_REPLICATION) }),
      ],
      "owner: adds a laboratory to its units": [
        "denied",
        update("owner", own, { laboratoryIds: arrayUnion("lab-synthetic-other") }),
      ],
      "owner: lists itself as core team": [
        "denied",
        update("owner", own, { isCoreTeam: true, coreRoles: ["Director"] }),
      ],
      "owner: changes its public listing": ["denied", update("owner", own, { publicListing: "coreTeam" })],
      "owner: changes its slug": ["denied", update("owner", own, { slug: "synthetic-admin" })],
      "owner: changes its name": ["denied", update("owner", own, { displayName: "Synthetic Administrator" })],
      "owner: archives its profile": ["denied", update("owner", own, { archivedAt: serverTimestamp() })],
      "member: sets the ORCID iD of another person": [
        "denied",
        update("member", own, { orcid: "0000-0002-1825-0097" }),
      ],
    });
  });

  it("keeps the addresses that the claim flow trusts, and the indexes built from them, away from every client", async () => {
    const address = { email: "attacker.account@example.org", kind: "secondary", verifiedAt: null, claimEligible: true };
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "adds an address to the contact document of the owner", (caller) =>
        update(caller, `persons/${OWNER_PERSON}/private/contact`, { emails: arrayUnion(address) }),
      ),
      ...forEach(EVERYONE, "denied", "creates the contact document of an unclaimed profile", (caller) =>
        create(caller, `${UNCLAIMED_PERSON}/private/contact`, { emails: [{ ...address, kind: "primary" }] }),
      ),
      ...forEach(EVERYONE, "denied", "writes an entry of the index of addresses", (caller) =>
        create(caller, `personEmailIndex/hash-of-${caller}`, {
          personIds: ["person-synthetic-unclaimed"],
          claimEligiblePersonIds: ["person-synthetic-unclaimed"],
        }),
      ),
      ...forEach(EVERYONE, "denied", "points an identity key at another record", (caller) =>
        update(caller, storedPath("identityKeys"), { entityIds: arrayUnion(MEMBER_PERSON) }),
      ),
    });
  });
});

describe("an entry of a person in a unit", () => {
  it("is proposed by a coordinator and never confirmed by a client", async () => {
    const entry = (personId: string, status: string) => ({
      laboratoryId: OWN_LABORATORY,
      personId,
      role: "member",
      isAuthorisedRepresentative: false,
      earlierPeriods: [],
      status,
    });
    const members = `laboratories/${OWN_LABORATORY}/members`;
    const unclaimed = "person-synthetic-unclaimed";
    await expectOutcomes({
      "ownCoordinator: creates an entry that is confirmed already": [
        "denied",
        create("ownCoordinator", `${members}/${unclaimed}`, entry(unclaimed, "confirmed")),
      ],
      "member: proposes a person": [
        "denied",
        create("member", `${members}/${unclaimed}`, entry(unclaimed, "proposed")),
      ],
      "otherCoordinator: proposes a person in a laboratory it does not coordinate": [
        "denied",
        create("otherCoordinator", `${members}/${unclaimed}`, entry(unclaimed, "proposed")),
      ],
      // The same entry from the coordinator of the laboratory is accepted.
      "ownCoordinator: proposes a person": [
        "allowed",
        create("ownCoordinator", `${members}/${unclaimed}`, entry(unclaimed, "proposed")),
      ],
      "ownCoordinator: confirms the entry it proposed": [
        "denied",
        update("ownCoordinator", `${members}/${unclaimed}`, { status: "confirmed" }),
      ],
      "ownCoordinator: confirms an entry that trusted code proposed": [
        "denied",
        update("ownCoordinator", PROPOSED_MEMBER, { status: "confirmed" }),
      ],
      "admin: confirms an entry, which only a function does": [
        "denied",
        update("admin", PROPOSED_MEMBER, { status: "confirmed" }),
      ],
      "member: confirms its own entry directly": ["denied", update("member", PROPOSED_MEMBER, { status: "confirmed" })],
      "ownLabMember: ends the entry of another person": [
        "denied",
        update("ownLabMember", `${members}/${OWNER_PERSON}`, { status: "ended" }),
      ],
      "ownCoordinator: ends a confirmed entry": [
        "allowed",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { status: "ended" }),
      ],
      "ownCoordinator: confirms an entry that it has just ended": [
        "denied",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { status: "confirmed" }),
      ],
    });
  });

  it("is proposed by a lead in a role that leads nothing, and never confirmed or made a lead by that lead", async () => {
    const id = (personId: string, role: string) => `${MEMBERSHIPS}/${replicationMembershipId(personId, role)}`;
    const leadPerson = "person-synthetic-own-lead";
    const unclaimed = "person-synthetic-unclaimed";
    await expectOutcomes({
      "ownLead: proposes a confirmed analyst": [
        "denied",
        create("ownLead", id(unclaimed, "analyst"), membership(unclaimed, "analyst", "confirmed")),
      ],
      "ownTeam: proposes a membership": [
        "denied",
        create("ownTeam", id(unclaimed, "analyst"), membership(unclaimed, "analyst", "needsReview")),
      ],
      "otherLead: proposes a membership of a replication it does not lead": [
        "denied",
        create("otherLead", id(unclaimed, "analyst"), membership(unclaimed, "analyst", "needsReview")),
      ],
      // The same membership from the lead of the replication is accepted.
      "ownLead: proposes an analyst": [
        "allowed",
        create("ownLead", id(unclaimed, "analyst"), membership(unclaimed, "analyst", "needsReview")),
      ],
      "ownLead: confirms the membership it proposed": [
        "denied",
        update("ownLead", UNCONFIRMED_MEMBERSHIP, { reviewStatus: "confirmed" }),
      ],
      "ownLead: names a co-lead": [
        "denied",
        create("ownLead", id(MEMBER_PERSON, "coLead"), membership(MEMBER_PERSON, "coLead", "needsReview")),
      ],
      "ownLead: names a second lead": [
        "denied",
        create("ownLead", id(MEMBER_PERSON, "lead"), membership(MEMBER_PERSON, "lead", "needsReview")),
      ],
      "ownLead: hides the role of a lead behind the identifier of a member": [
        "denied",
        create("ownLead", id(MEMBER_PERSON, "member"), membership(MEMBER_PERSON, "lead", "needsReview")),
      ],
      "ownLead: ends the membership of a lead": ["denied", update("ownLead", LEAD_MEMBERSHIP, { isCurrent: false })],
      "ownLead: turns a membership into that of a lead": [
        "denied",
        update("ownLead", UNCONFIRMED_MEMBERSHIP, { role: "lead" }),
      ],
      "ownLead: moves a membership to another person": [
        "denied",
        update("ownLead", UNCONFIRMED_MEMBERSHIP, { personId: leadPerson }),
      ],
      "member: confirms its own membership directly": [
        "denied",
        update("member", UNCONFIRMED_MEMBERSHIP, { reviewStatus: "confirmed" }),
      ],
    });
  });
});

describe("what only trusted code changes on a record", () => {
  it("is refused to those who manage the record: status, status history, leads, identifiers and origin", async () => {
    const replication = `replications/${OWN_REPLICATION}`;
    const participation = `participations/${OWN_PARTICIPATION}`;
    await expectOutcomes({
      "ownLead: edits the short title": [
        "allowed",
        update("ownLead", replication, { shortTitle: "A synthetic title" }),
      ],
      "ownLead: changes the status of its replication": [
        "denied",
        update("ownLead", replication, { statusKey: "published" }),
      ],
      "ownLead: names an entry of the status history": [
        "denied",
        update("ownLead", replication, { statusHistoryId: "history-1" }),
      ],
      "ownLead: adds a lead to the list of leads": [
        "denied",
        update("ownLead", replication, { leadPersonIds: arrayUnion(MEMBER_PERSON) }),
      ],
      "ownLead: renames the study": ["denied", update("ownLead", replication, { studyKey: "SyntheticStudy2099" })],
      "ownLead: calls imported data live": ["denied", update("ownLead", replication, { dataOrigin: "live" })],
      "ownLead: confirms the participation of a laboratory": [
        "denied",
        update("ownLead", participation, { status: "confirmed" }),
      ],
      "ownCoordinator: says that its laboratory is collecting": [
        "denied",
        update("ownCoordinator", participation, { status: "collecting" }),
      ],
      ...forEach(EVERYONE, "denied", "writes an entry of the status history", (caller) =>
        create(
          caller,
          `statusHistory/history-of-${caller}`,
          {
            entityType: "replication",
            entityId: OWN_REPLICATION,
            fromStatusKey: "planning",
            toStatusKey: "published",
            effectiveAt: serverTimestamp(),
            recordedAt: serverTimestamp(),
            changedBy: uidOfCaller(caller),
            source: "manual",
            replicationId: OWN_REPLICATION,
            laboratoryId: null,
            scopeKeys: [`rep:${OWN_REPLICATION}`, "members"],
          },
          true,
        ),
      ),
      "ownCoordinator: changes the slug of its laboratory": [
        "denied",
        update("ownCoordinator", `laboratories/${OWN_LABORATORY}`, { slug: "synthetic-laboratory-two" }),
      ],
    });
  });

  it("is never the removal of a record: every delete of a core record is refused", async () => {
    const RECORDS = [
      `persons/${OWNER_PERSON}`,
      `laboratories/${OWN_LABORATORY}`,
      `laboratories/${OWN_LABORATORY}/members/${OWNER_PERSON}`,
      `replications/${OWN_REPLICATION}`,
      UNCONFIRMED_MEMBERSHIP,
      `participations/${OWN_PARTICIPATION}`,
      storedPath("participationDeviations"),
      storedPath("participationAcknowledgements"),
      storedPath("manuscripts"),
      storedPath("contributors"),
      storedPath("documentLinks"),
      storedPath("externalAccounts"),
      storedPath("correctionRequests"),
      `access/${OWNER_UID}`,
      storedPath("roleAssignments"),
    ];
    for (const path of RECORDS) {
      await expectOutcomes(
        forEach(["owner", "ownCoordinator", "ownLead", "coreTeam", "admin"], "denied", `removes ${path}`, (caller) =>
          remove(caller, path),
        ),
      );
    }
    await expectOutcomes({
      "owner: removes a favourite of its own": ["allowed", remove("owner", storedPath("userFavourites"))],
      "member: removes a favourite of another account": ["denied", remove("member", storedPath("userSubscriptions"))],
    });
  });

  it("is never a correction request that its author resolves", async () => {
    const own = newRecord("correctionRequests", MEMBER_UID);
    await expectOutcomes({
      "member: files a request": [
        "allowed",
        create("member", `correctionRequests/${autoId("request-redteam-own")}`, own),
      ],
      "member: accepts its own request": [
        "denied",
        update("member", `correctionRequests/${autoId("request-redteam-own")}`, { status: "accepted" }),
      ],
      "member: names itself as the resolver": [
        "denied",
        update("member", `correctionRequests/${autoId("request-redteam-own")}`, {
          resolvedBy: MEMBER_UID,
          resolvedAt: serverTimestamp(),
        }),
      ],
      "member: files a request in the name of another account": [
        "denied",
        create("member", `correctionRequests/${autoId("request-redteam-forged")}`, { ...own, uid: OWNER_UID }),
      ],
      "member: withdraws the request of another account": [
        "denied",
        update("member", storedPath("correctionRequests"), { status: "withdrawn" }),
      ],
      "member: withdraws its own request": [
        "allowed",
        update("member", `correctionRequests/${autoId("request-redteam-own")}`, { status: "withdrawn" }),
      ],
    });
  });
});
