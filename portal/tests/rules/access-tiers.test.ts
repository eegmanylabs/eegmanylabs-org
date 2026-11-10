// Hand-written tests of the rules that decide who a caller is: the standing of an account, the
// second factor behind every power of the programme, the secrecy of the documents beneath a
// person, and the lists that a scoped caller must constrain. The matrix covers the same ground
// for every collection. These tests state the special cases one by one.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { laboratoryScopeKey, participationId, replicationMembershipId, replicationScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  deleteField,
  doc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { type Actor, expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  type AccountSpec,
  autoId,
  CALLERS,
  type CallerProfile,
  firestoreOf,
  firestoreWithToken,
  MEMBER_PERSON,
  MEMBER_UID,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  resolveSyntheticAccess,
  SECOND_PARTICIPATION,
  stored,
  tokenOf,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents, create, update, remove } = requestsOf(() => environment);

const PERSON = `persons/${OWNER_PERSON}`;
const CONTACT = `${PERSON}/private/contact`;
const DEMOGRAPHICS = `${PERSON}/special/demographics`;
const ROLE_ASSIGNMENT = `roleAssignments/${FIXTURES.roleAssignments?.ids[0]}`;
const SOURCE = "sources/F";
const STATUS_DEFINITION = "statusDefinitions/replication__planning";

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-tiers");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

/** An account that is no caller of the world, with the access document its roles resolve to. */
async function account(name: string, spec: AccountSpec, authTime?: number): Promise<Actor> {
  const uid = `uid-${name}`;
  const access = resolveSyntheticAccess(uid, spec);
  await trusted(environment, (db) => setDoc(doc(db, `access/${uid}`), { ...stored(), ...access }));
  const profile: CallerProfile = {
    kind: "member",
    uid,
    email: `${name}.account@example.org`,
    access,
    secondFactor: spec.secondFactor ?? false,
  };
  return { db: firestoreWithToken(environment, uid, tokenOf(profile, authTime)), uid };
}

const correctionRequest = (uid: string) => ({
  uid,
  entityType: "person",
  entityId: OWNER_PERSON,
  field: "displayName",
  proposedValue: "Synthetic Name",
  status: "open",
  resolvedBy: null,
  resolvedAt: null,
});

describe("the standing of an account", () => {
  it("refuses a session that began before the sessions of the account were ended, and admits the next one", async () => {
    const endedAt = 1_790_000_000;
    await trusted(environment, (db) =>
      updateDoc(doc(db, `access/${MEMBER_UID}`), { sessionsValidAfter: Timestamp.fromMillis(endedAt * 1000) }),
    );
    const earlier: Actor = {
      db: firestoreWithToken(environment, MEMBER_UID, tokenOf(CALLERS.member)),
      uid: MEMBER_UID,
    };
    const later: Actor = {
      db: firestoreWithToken(environment, MEMBER_UID, tokenOf(CALLERS.member, endedAt)),
      uid: MEMBER_UID,
    };
    await expectOutcomes({
      "the earlier session reads the directory": ["denied", get(earlier, PERSON)],
      "the earlier session reads its own access document": ["denied", get(earlier, `access/${MEMBER_UID}`)],
      "the earlier session files a correction request": [
        "denied",
        create(earlier, `correctionRequests/${autoId("request-earlier")}`, correctionRequest(MEMBER_UID)),
      ],
      "the later session reads the directory": ["allowed", get(later, PERSON)],
      "the later session files a correction request": [
        "allowed",
        create(later, `correctionRequests/${autoId("request-later")}`, correctionRequest(MEMBER_UID)),
      ],
    });
  });

  it("refuses a lead everything from the request after the suspension, though the roles are still in the document", async () => {
    const lead = uidOfCaller("ownLead");
    const replication = `replications/${OWN_REPLICATION}`;
    await expectOutcomes({
      "the lead edits the replication": ["allowed", update("ownLead", replication, { theme: "Synthetic" })],
    });
    await trusted(environment, (db) => updateDoc(doc(db, `access/${lead}`), { suspended: true }));
    await expectOutcomes({
      "reads the directory": ["denied", get("ownLead", PERSON)],
      "reads its own access document": ["denied", get("ownLead", `access/${lead}`)],
      "edits the replication": ["denied", update("ownLead", replication, { theme: "Synthetic again" })],
      "reads the private detail of the replication": ["denied", get("ownLead", `${replication}/private/detail`)],
    });
    await trusted(environment, (db) => updateDoc(doc(db, `access/${lead}`), { suspended: false }));
    await expectOutcomes({ "the lead reads again once the suspension is lifted": ["allowed", get("ownLead", PERSON)] });
  });

  it("opens nothing but its own documents to an account that has signed in and holds no access document", async () => {
    const uid = "uid-new-account";
    const newcomer: Actor = {
      db: firestoreWithToken(environment, uid, { email: "new.account@example.org", email_verified: true }),
      uid,
    };
    await expectOutcomes({
      "reads its own profile, which does not exist yet": ["allowed", get(newcomer, `users/${uid}`)],
      "reads its own access document": ["allowed", get(newcomer, `access/${uid}`)],
      "reads its own claim": ["allowed", get(newcomer, `accountClaims/${uid}`)],
      "reads the directory": ["denied", get(newcomer, PERSON)],
      "reads the settings of the portal": ["denied", get(newcomer, "system/settings")],
      "lists laboratories": ["denied", list(newcomer, "laboratories", limit(10))],
      "marks a favourite": [
        "denied",
        create(newcomer, `users/${uid}/favourites/replication__${OWN_REPLICATION}`, {
          uid,
          entityType: "replication",
          entityId: OWN_REPLICATION,
        }),
      ],
      "files a correction request": [
        "denied",
        create(newcomer, `correctionRequests/${autoId("request-new")}`, correctionRequest(uid)),
      ],
      "writes its own access document": ["denied", create(newcomer, `access/${uid}`, { member: true })],
    });
  });

  it("lets an account that awaits approval read its own claim and nothing a member reads", async () => {
    const uid = uidOfCaller("noMembership");
    await trusted(environment, (db) =>
      setDoc(doc(db, `accountClaims/${uid}`), {
        ...stored(),
        uid,
        status: "pendingReview",
        personId: null,
        submittedAt: Timestamp.now(),
      }),
    );
    await expectOutcomes({
      "reads its own claim": ["allowed", get("noMembership", `accountClaims/${uid}`)],
      "reads the review of its own claim": ["denied", get("noMembership", `accountClaims/${uid}/private/review`)],
      "reads the claim of another account": ["denied", get("noMembership", `accountClaims/${OWNER_UID}`)],
      "reads the directory": ["denied", get("noMembership", PERSON)],
    });
  });
});

describe("the second factor", () => {
  const administrator: AccountSpec = {
    roles: [["programme_admin", "programme", "programme"]],
    personId: "person-synthetic-administrator",
  };

  it("withholds every power of the programme from an administrator who has not enrolled a factor", async () => {
    // The token claims a second factor, and the access document says that none is enrolled.
    const unenrolled = await account("admin-unenrolled", { ...administrator, mfaEnrolled: false, secondFactor: true });
    await expectOutcomes({
      "reads the directory, as any member does": ["allowed", get(unenrolled, PERSON)],
      "reads role assignments": ["denied", get(unenrolled, ROLE_ASSIGNMENT)],
      "reads the source registry": ["denied", get(unenrolled, SOURCE)],
      "reads the contact details of a person": ["denied", get(unenrolled, CONTACT)],
      "reads the private detail of a replication": [
        "denied",
        get(unenrolled, `replications/${OWN_REPLICATION}/private/detail`),
      ],
      "edits a status definition": ["denied", update(unenrolled, STATUS_DEFINITION, { label: "Forged" })],
      "edits a replication": ["denied", update(unenrolled, `replications/${OWN_REPLICATION}`, { theme: "Forged" })],
    });
  });

  it("refuses an access document that lists the powers while no factor is enrolled", async () => {
    // What a resolver would never write: the capabilities of an administrator beside mfaEnrolled false.
    const uid = uidOfCaller("admin");
    await trusted(environment, (db) => updateDoc(doc(db, `access/${uid}`), { mfaEnrolled: false }));
    await expectOutcomes({
      "reads role assignments": ["denied", get("admin", ROLE_ASSIGNMENT)],
      "edits a status definition": ["denied", update("admin", STATUS_DEFINITION, { label: "Forged" })],
      "reads the directory, as any member does": ["allowed", get("admin", PERSON)],
    });
  });

  it("requires the factor in the session itself: an enrolled administrator without it is an ordinary member", async () => {
    await expectOutcomes({
      "with the factor, reads role assignments": ["allowed", get("admin", ROLE_ASSIGNMENT)],
      "with the factor, lists the source registry": ["allowed", list("admin", "sources", limit(10))],
      "with the factor, edits a status definition": [
        "allowed",
        update("admin", STATUS_DEFINITION, { label: "Planned" }),
      ],
      "without it, reads role assignments": ["denied", get("adminWithoutFactor", ROLE_ASSIGNMENT)],
      "without it, lists the source registry": ["denied", list("adminWithoutFactor", "sources", limit(10))],
      "without it, reads import batches": ["denied", get("adminWithoutFactor", "importBatches/batch-1")],
      "without it, reads the review of a claim": [
        "denied",
        get("adminWithoutFactor", `accountClaims/${OWNER_UID}/private/review`),
      ],
      "without it, reads private notes on a person": ["denied", get("adminWithoutFactor", `${PERSON}/private/notes`)],
      "without it, reads the contact details of a person": ["denied", get("adminWithoutFactor", CONTACT)],
      "without it, edits a status definition": [
        "denied",
        update("adminWithoutFactor", STATUS_DEFINITION, { label: "Forged" }),
      ],
      "without it, edits a laboratory": [
        "denied",
        update("adminWithoutFactor", `laboratories/${OWN_LABORATORY}`, { city: "Forged" }),
      ],
      "without it, reads the directory, as any member does": ["allowed", get("adminWithoutFactor", PERSON)],
    });
  });

  it("counts a missing secondFactorRequired as required", async () => {
    const uid = uidOfCaller("adminWithoutFactor");
    await trusted(environment, (db) => updateDoc(doc(db, `access/${uid}`), { secondFactorRequired: deleteField() }));
    await expectOutcomes({ "reads role assignments": ["denied", get("adminWithoutFactor", ROLE_ASSIGNMENT)] });
    await trusted(environment, (db) =>
      updateDoc(doc(db, `access/${uidOfCaller("admin")}`), { secondFactorRequired: deleteField() }),
    );
    await expectOutcomes({
      "reads role assignments in a session with the factor": ["allowed", get("admin", ROLE_ASSIGNMENT)],
    });
  });

  it("lets the holder of a named grant use it in a session with a second factor only", async () => {
    const spec: AccountSpec = { personId: "person-synthetic-grant", namedGrants: ["roles.manage"], mfaEnrolled: true };
    const withFactor = await account("grant-holder", { ...spec, secondFactor: true });
    const without = await account("grant-holder", spec);
    await expectOutcomes({
      "with the factor, reads role assignments": ["allowed", get(withFactor, ROLE_ASSIGNMENT)],
      "with the factor, reads capability grants": ["allowed", list(withFactor, "capabilityGrants", limit(10))],
      "with the factor, reads what the grant does not name": ["denied", get(withFactor, SOURCE)],
      "without it, reads role assignments": ["denied", get(without, ROLE_ASSIGNMENT)],
      "without it, reads the directory, as any member does": ["allowed", get(without, PERSON)],
    });
  });

  it("gives the core team a sensitive capability only through an override of the matrix", async () => {
    const core: AccountSpec = {
      roles: [["core_team", "programme", "programme"]],
      personId: "person-synthetic-core",
      mfaEnrolled: true,
      secondFactor: true,
    };
    const byDefault = await account("core-default", core);
    const widened = await account("core-widened", {
      ...core,
      overrides: [{ role: "core_team", overrides: { rolesManage: true } }],
    });
    const narrowed = await account("core-narrowed", {
      ...core,
      overrides: [{ role: "core_team", overrides: { lookupsManage: false, importsRun: false } }],
    });
    await expectOutcomes({
      "by default, reads role assignments": ["denied", get(byDefault, ROLE_ASSIGNMENT)],
      "by default, reads the source registry": ["allowed", get(byDefault, SOURCE)],
      "by default, edits a status definition": ["allowed", update(byDefault, STATUS_DEFINITION, { label: "Planned" })],
      "with roles.manage switched on, reads role assignments": ["allowed", get(widened, ROLE_ASSIGNMENT)],
      "with imports.run switched off, reads the source registry": ["denied", get(narrowed, SOURCE)],
      "with lookups.manage switched off, edits a status definition": [
        "denied",
        update(narrowed, STATUS_DEFINITION, { label: "Forged" }),
      ],
      "with lookups.manage switched off, still edits a replication": [
        "allowed",
        update(narrowed, `replications/${OWN_REPLICATION}`, { theme: "Synthetic" }),
      ],
    });
  });

  it("asks no second factor of a lead or a coordinator for the unit they manage", async () => {
    expect(CALLERS.ownLead.access?.secondFactorRequired).toBe(false);
    await expectOutcomes({
      "a lead edits the replication": [
        "allowed",
        update("ownLead", `replications/${OWN_REPLICATION}`, { theme: "Synthetic" }),
      ],
      "a coordinator edits the laboratory": [
        "allowed",
        update("ownCoordinator", `laboratories/${OWN_LABORATORY}`, { city: "Example Town" }),
      ],
    });
  });
});

describe("the documents beneath a person", () => {
  it("lets every member read the directory document", async () => {
    await expectOutcomes({
      "an ordinary member": ["allowed", get("member", PERSON)],
      "a member of another laboratory": ["allowed", get("otherLabMember", PERSON)],
      "an account without a membership": ["denied", get("noMembership", PERSON)],
      nobody: ["denied", get("signedOut", PERSON)],
    });
  });

  it("keeps the contact document from a member who can read the directory document, unless in scope", async () => {
    await expectOutcomes({
      "the same ordinary member": ["denied", get("member", CONTACT)],
      "a member of the person's laboratory": ["denied", get("ownLabMember", CONTACT)],
      "a team member of the person's replication": ["denied", get("ownTeam", CONTACT)],
      "a coordinator of another laboratory": ["denied", get("otherCoordinator", CONTACT)],
      "a lead of another replication": ["denied", get("otherLead", CONTACT)],
      "the person": ["allowed", get("owner", CONTACT)],
      "a coordinator of the person's laboratory": ["allowed", get("ownCoordinator", CONTACT)],
      "a lead of the person's replication": ["allowed", get("ownLead", CONTACT)],
      "the core team": ["allowed", get("coreTeam", CONTACT)],
      "a programme administrator": ["allowed", get("admin", CONTACT)],
      "a list of the private documents of the person": ["denied", list("admin", `${PERSON}/private`, limit(10))],
      "a harvest across people": ["denied", listAcrossParents("admin", "private", limit(10))],
    });
  });

  it("follows the units that the directory document names, which no client can change", async () => {
    await trusted(environment, (db) =>
      updateDoc(doc(db, PERSON), { replicationIds: [], laboratoryIds: [OTHER_LABORATORY] }),
    );
    await expectOutcomes({
      "a lead of a replication the person has left": ["denied", get("ownLead", CONTACT)],
      "a coordinator of the laboratory the person has left": ["denied", get("ownCoordinator", CONTACT)],
      "a coordinator of the laboratory the person is in now": ["allowed", get("otherCoordinator", CONTACT)],
      "a lead who adds the replication to the person": [
        "denied",
        update("ownLead", PERSON, { replicationIds: [OWN_REPLICATION] }),
      ],
      "an administrator who adds the replication to the person": [
        "denied",
        update("admin", PERSON, { replicationIds: [OWN_REPLICATION] }),
      ],
      "the person, who adds a laboratory": ["denied", update("owner", PERSON, { laboratoryIds: [OWN_LABORATORY] })],
    });
  });

  it("lets nobody write the contact document, which the claim flow trusts", async () => {
    const emails = [{ email: "forged.address@example.org", kind: "primary", verifiedAt: null, claimEligible: true }];
    await expectOutcomes({
      "the person": ["denied", update("owner", CONTACT, { emails })],
      "a coordinator": ["denied", update("ownCoordinator", CONTACT, { emails })],
      "an administrator": ["denied", update("admin", CONTACT, { emails })],
      "an administrator, for a person without one": [
        "denied",
        create("admin", `persons/${MEMBER_PERSON}/private/contact`, { emails }),
      ],
      "a delete by an administrator": ["denied", remove("admin", CONTACT)],
    });
  });

  it("lets nobody at all read or write the special-category document", async () => {
    const holder = await account("demographics-holder", {
      personId: "person-synthetic-demographics",
      namedGrants: ["demographics.read"],
      mfaEnrolled: true,
      secondFactor: true,
    });
    const everyone: readonly Actor[] = [
      "signedOut",
      "member",
      "owner",
      "ownLabMember",
      "ownCoordinator",
      "ownLead",
      "coreTeam",
      "adminWithoutFactor",
      "admin",
      holder,
    ];
    for (const actor of everyone) {
      const who = typeof actor === "string" ? actor : "the holder of a demographics grant";
      await expectOutcomes({
        [`${who} reads it`]: ["denied", get(actor, DEMOGRAPHICS)],
        [`${who} lists the special documents of the person`]: ["denied", list(actor, `${PERSON}/special`, limit(10))],
        [`${who} harvests across people`]: ["denied", listAcrossParents(actor, "special", limit(10))],
        [`${who} changes it`]: ["denied", update(actor, DEMOGRAPHICS, { genderSource: "forged" })],
        [`${who} creates one`]: [
          "denied",
          create(actor, `persons/${MEMBER_PERSON}/special/demographics`, {
            genderSource: "forged",
            recordedAt: Timestamp.now(),
          }),
        ],
        [`${who} deletes it`]: ["denied", remove(actor, DEMOGRAPHICS)],
      });
    }
  });

  it("keeps the special-category cells of an import from every client as well", async () => {
    await expectOutcomes({
      "an administrator reads the cells of a source record": [
        "denied",
        get("admin", "sourceRecords/source-record-1/special/raw"),
      ],
      "an administrator reads the state of a change": [
        "denied",
        get("admin", "importBatches/batch-1/changes/000001/special/state"),
      ],
      "an administrator reads the address of a source": ["denied", get("admin", "sources/F/private/location")],
      "an administrator reads the raw row beside them": ["allowed", get("admin", "sourceRecords/source-record-1")],
    });
  });
});

describe("a list of scoped records", () => {
  const OWN_KEY = laboratoryScopeKey(OWN_LABORATORY);
  const checklistItem = (participation: string, replicationId: string, laboratoryId: string) => ({
    ...(FIXTURES.participationChecklist?.seed ?? {}),
    participationId: participation,
    replicationId,
    laboratoryId,
    scopeKeys: [replicationScopeKey(replicationId), laboratoryScopeKey(laboratoryId)],
  });
  const FOREIGN_PARTICIPATION = participationId(OTHER_REPLICATION, OTHER_LABORATORY);

  beforeEach(async () => {
    await trusted(environment, async (db) => {
      await setDoc(
        doc(db, `participations/${SECOND_PARTICIPATION}/checklist/ethics`),
        checklistItem(SECOND_PARTICIPATION, OWN_REPLICATION, OTHER_LABORATORY),
      );
      await setDoc(
        doc(db, `participations/${FOREIGN_PARTICIPATION}/checklist/ethics`),
        checklistItem(FOREIGN_PARTICIPATION, OTHER_REPLICATION, OTHER_LABORATORY),
      );
    });
  });

  const OWN_CHECKLIST = `participations/${OWN_PARTICIPATION}/checklist`;

  it("is refused to a coordinator without a constraint and accepted when constrained to the laboratory", async () => {
    await expectOutcomes({
      "the checklist of the laboratory's own participation, unconstrained": [
        "denied",
        list("ownCoordinator", OWN_CHECKLIST, limit(50)),
      ],
      "every checklist, unconstrained": ["denied", listAcrossParents("ownCoordinator", "checklist", limit(50))],
      "constrained to the laboratory": [
        "allowed",
        list("ownCoordinator", OWN_CHECKLIST, where("laboratoryId", "==", OWN_LABORATORY), limit(50)),
      ],
      "constrained to the laboratory, across participations": [
        "allowed",
        listAcrossParents("ownCoordinator", "checklist", where("laboratoryId", "==", OWN_LABORATORY), limit(50)),
      ],
      "constrained to another laboratory": [
        "denied",
        listAcrossParents("ownCoordinator", "checklist", where("laboratoryId", "==", OTHER_LABORATORY), limit(50)),
      ],
      "constrained to the replication, which the coordinator does not hold": [
        "denied",
        listAcrossParents("ownCoordinator", "checklist", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "constrained to every scope key the coordinator holds": [
        "allowed",
        listAcrossParents(
          "ownCoordinator",
          "checklist",
          where("scopeKeys", "array-contains-any", CALLERS.ownCoordinator.access?.scopeKeys ?? []),
          limit(50),
        ),
      ],
      "constrained to a key the coordinator holds and one it does not": [
        "denied",
        listAcrossParents(
          "ownCoordinator",
          "checklist",
          where("scopeKeys", "array-contains-any", [OWN_KEY, replicationScopeKey(OWN_REPLICATION)]),
          limit(50),
        ),
      ],
      "constrained, without a limit": [
        "denied",
        list("ownCoordinator", OWN_CHECKLIST, where("laboratoryId", "==", OWN_LABORATORY)),
      ],
      "constrained, with a limit above the most a list may ask for": [
        "denied",
        list("ownCoordinator", OWN_CHECKLIST, where("laboratoryId", "==", OWN_LABORATORY), limit(1001)),
      ],
    });
  });

  it("returns to a lead the records of the replication in every laboratory, and nothing else", async () => {
    const db = firestoreOf(environment, CALLERS.ownLead);
    const snapshot = await getDocs(
      query(collectionGroup(db, "checklist"), where("replicationId", "==", OWN_REPLICATION), limit(50)),
    );
    expect(snapshot.docs.map((document) => document.ref.path).sort()).toEqual(
      [
        `participations/${OWN_PARTICIPATION}/checklist/ethics`,
        `participations/${SECOND_PARTICIPATION}/checklist/ethics`,
      ].sort(),
    );
    await expectOutcomes({
      "a lead of another replication asks for the same list": [
        "denied",
        listAcrossParents("otherLead", "checklist", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "an ordinary member asks for it": [
        "denied",
        listAcrossParents("member", "checklist", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "a team member of the replication asks for it": [
        "allowed",
        listAcrossParents("ownTeam", "checklist", where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "the core team lists every checklist": ["allowed", listAcrossParents("coreTeam", "checklist", limit(50))],
      "an administrator without the factor lists every checklist": [
        "denied",
        listAcrossParents("adminWithoutFactor", "checklist", limit(50)),
      ],
    });
  });

  it("opens confirmed memberships to every member and the others to the team of the replication alone", async () => {
    const unconfirmed = `replications/${OWN_REPLICATION}/memberships/${replicationMembershipId(MEMBER_PERSON, "analyst")}`;
    await trusted(environment, (db) =>
      setDoc(doc(db, unconfirmed), {
        ...(FIXTURES.replicationMemberships?.seed ?? {}),
        personId: MEMBER_PERSON,
        role: "analyst",
        reviewStatus: "needsReview",
      }),
    );
    const memberships = `replications/${OWN_REPLICATION}/memberships`;
    await expectOutcomes({
      "a member reads an unconfirmed membership": ["denied", get("member", unconfirmed)],
      "a lead of another replication reads it": ["denied", get("otherLead", unconfirmed)],
      "a coordinator of a laboratory reads it": ["denied", get("ownCoordinator", unconfirmed)],
      "a lead of the replication reads it": ["allowed", get("ownLead", unconfirmed)],
      "a team member of the replication reads it": ["allowed", get("ownTeam", unconfirmed)],
      "the core team reads it": ["allowed", get("coreTeam", unconfirmed)],
      "a member lists the memberships of the replication": ["denied", list("member", memberships, limit(50))],
      "a member lists the confirmed ones": [
        "allowed",
        list("member", memberships, where("reviewStatus", "==", "confirmed"), limit(50)),
      ],
      "a member lists the confirmed ones of every replication": [
        "allowed",
        listAcrossParents("member", "memberships", where("reviewStatus", "==", "confirmed"), limit(50)),
      ],
      "a member lists the unconfirmed ones": [
        "denied",
        listAcrossParents("member", "memberships", where("reviewStatus", "==", "needsReview"), limit(50)),
      ],
      "a lead lists every membership of the replication": [
        "allowed",
        list("ownLead", memberships, where("replicationId", "==", OWN_REPLICATION), limit(50)),
      ],
      "a lead lists every membership of another replication": [
        "denied",
        listAcrossParents("ownLead", "memberships", where("replicationId", "==", OTHER_REPLICATION), limit(50)),
      ],
    });
  });

  it("is bounded for everyone: a list says how many documents it asks for, and no more than a thousand", async () => {
    await expectOutcomes({
      "an administrator lists persons without a limit": ["denied", list("admin", "persons")],
      "an administrator asks for a thousand and one": ["denied", list("admin", "persons", limit(1001))],
      "an administrator asks for a thousand": ["allowed", list("admin", "persons", limit(1000))],
      "a member asks for a thousand": ["allowed", list("member", "persons", limit(1000))],
      "a member asks for the hypotheses of every replication": [
        "allowed",
        listAcrossParents("member", "hypotheses", limit(1000)),
      ],
      "a member asks for them without a limit": ["denied", listAcrossParents("member", "hypotheses")],
    });
  });
});
