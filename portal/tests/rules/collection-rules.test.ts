// Hand-written tests of the rules that are special to one collection: the fields a writer may
// set, the shape of the documents that members write most, the references that must exist, the
// scope a document inherits and the changes that only trusted code makes. Each table lists
// requests with the answer the rules must give.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  acknowledgementId,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  participationId,
  replicationMembershipId,
  replicationScopeKey,
  SPECIAL_CATEGORY_FIELDS,
  unitScopeKeys,
  userScopeKey,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { FIXTURES } from "./fixtures";
import { type Expectations, expectOutcomes, requestsOf } from "./requests";
import { seedWorld, trusted } from "./seed";
import { createRulesEnvironment } from "./support";
import {
  autoId,
  MEMBER_PERSON,
  MEMBER_UID,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  stored,
  uidOfCaller,
} from "./world";

let environment: RulesTestEnvironment;
const { get, create, createAt, update, remove } = requestsOf(() => environment);

const LABORATORY = `laboratories/${OWN_LABORATORY}`;
const REPLICATION = `replications/${OWN_REPLICATION}`;
const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;
const PERSON = `persons/${OWNER_PERSON}`;
const REPLICATION_KEY = replicationScopeKey(OWN_REPLICATION);
const LABORATORY_KEY = laboratoryScopeKey(OWN_LABORATORY);
const UNIT = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
};

const text = (length: number) => "x".repeat(length);
const clientTime = () => Timestamp.fromMillis(Date.now() - 3_600_000);
const later = () => Timestamp.fromMillis(Date.now() + 86_400_000);

/** The stored document of a fixture without its standard fields, as the start of a new document. */
function fieldsOf(key: keyof typeof FIXTURES): Record<string, unknown> {
  const {
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    createdBy: _createdBy,
    updatedBy: _updatedBy,
    archivedAt: _archivedAt,
    writeContext: _writeContext,
    ...fields
  } = FIXTURES[key]?.seed ?? {};
  return fields;
}

/** A table in which every request is refused. */
const refused = (requests: Record<string, () => Promise<unknown>>): Expectations =>
  Object.fromEntries(Object.entries(requests).map(([label, request]) => [label, ["denied", request] as const]));

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-collections");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

describe("the documents beneath a user", () => {
  const favourites = `users/${OWNER_UID}/favourites`;
  const notification = `users/${OWNER_UID}/notifications/notification-1`;
  const preferences = `users/${OWNER_UID}/settings/preferences`;

  it("ties a favourite to its owner and to the record its identifier names", async () => {
    const favourite = { uid: OWNER_UID, entityType: "person", entityId: OWNER_PERSON };
    await expectOutcomes({
      ...refused({
        "an identifier that names another record": create("owner", `${favourites}/person__someone-else`, favourite),
        "a kind of record that does not exist": create("owner", `${favourites}/spaceship__${OWNER_PERSON}`, {
          ...favourite,
          entityType: "spaceship",
        }),
        "another account as its owner": create("owner", `${favourites}/person__${OWNER_PERSON}`, {
          ...favourite,
          uid: MEMBER_UID,
        }),
        "a favourite beneath another user": create("member", `${favourites}/person__${OWNER_PERSON}`, favourite),
        "a subscription with a level that does not exist": create(
          "owner",
          `users/${OWNER_UID}/subscriptions/person__${OWNER_PERSON}`,
          {
            ...favourite,
            level: "sometimes",
          },
        ),
      }),
      "a favourite of the owner": ["allowed", create("owner", `${favourites}/person__${OWNER_PERSON}`, favourite)],
      "its removal by another member": ["denied", remove("member", `${favourites}/person__${OWNER_PERSON}`)],
      "its removal by the owner": ["allowed", remove("owner", `${favourites}/person__${OWNER_PERSON}`)],
    });
  });

  it("lets the owner of a notification mark it as read or unread and change nothing else", async () => {
    await expectOutcomes({
      ...refused({
        "a time of the client's choosing": update("owner", notification, { readAt: clientTime() }),
        "another payload": update("owner", notification, { payload: { forged: true } }),
        "another type": update("owner", notification, { type: "assignment" }),
        "the time it was emailed": update("owner", notification, { emailedAt: serverTimestamp() }),
        "an archive": update("owner", notification, { archivedAt: serverTimestamp() }),
        "a notification of its own making": create(
          "owner",
          `users/${OWNER_UID}/notifications/forged`,
          fieldsOf("userNotifications"),
        ),
        "a removal": remove("owner", notification),
        "a mark by another member": update("member", notification, { readAt: serverTimestamp() }),
        "a mark by an administrator": update("admin", notification, { readAt: serverTimestamp() }),
      }),
      "read, at the request time": ["allowed", update("owner", notification, { readAt: serverTimestamp() })],
      "unread again": ["allowed", update("owner", notification, { readAt: null })],
    });
  });

  it("holds notification preferences to their enumerations", async () => {
    await expectOutcomes({
      ...refused({
        "a digest frequency that does not exist": update("owner", preferences, { digestFrequency: "hourly" }),
        "a channel that does not exist": update("owner", preferences, {
          channels: { inApp: true, email: true, pager: true },
        }),
        "a channel that is not a boolean": update("owner", preferences, { channels: { inApp: "yes", email: true } }),
        "quiet hours at an impossible time": update("owner", preferences, {
          quietHours: { start: "25:00", end: "07:00", timeZone: "Europe/London" },
        }),
        "quiet hours with an unexpected key": update("owner", preferences, {
          quietHours: { start: "22:00", end: "07:00", timeZone: "Europe/London", weekends: true },
        }),
        "a switch for a type that does not exist": update("owner", preferences, { typeSwitches: { telepathy: true } }),
      }),
      "quiet hours in a time zone": [
        "allowed",
        update("owner", preferences, { quietHours: { start: "22:00", end: "07:00", timeZone: "Europe/London" } }),
      ],
    });
  });
});

describe("a correction request", () => {
  const request = (uid: string) => ({ ...fieldsOf("correctionRequests"), uid });
  const mine = request(MEMBER_UID);
  const stored1 = "correctionRequests/request-1";

  it("is shape-checked field by field when a member creates it", async () => {
    const at = (name: string) => `correctionRequests/${autoId(name)}`;
    await expectOutcomes({
      ...refused(
        Object.fromEntries(
          SPECIAL_CATEGORY_FIELDS.map((field) => [
            `a request about the special-category field ${field}`,
            create("member", at(`special-${field}`), { ...mine, field }),
          ]),
        ),
      ),
      ...refused({
        "another account as its creator": create("member", at("forged-uid"), request(OWNER_UID)),
        "a status other than open": create("member", at("accepted"), { ...mine, status: "accepted" }),
        "a resolver": create("member", at("resolved-by"), { ...mine, resolvedBy: MEMBER_UID }),
        "a time of resolution": create("member", at("resolved-at"), { ...mine, resolvedAt: serverTimestamp() }),
        "a kind of record that does not exist": create("member", at("kind"), { ...mine, entityType: "spaceship" }),
        "a record identifier with a slash": create("member", at("slash"), { ...mine, entityId: "persons/x" }),
        "a field path in place of a field": create("member", at("path"), { ...mine, field: "custom.note" }),
        "an empty field name": create("member", at("empty-field"), { ...mine, field: "" }),
        "a map as the proposed value": create("member", at("map"), { ...mine, proposedValue: { value: "x" } }),
        "a proposed value that is too long": create("member", at("long-value"), {
          ...mine,
          proposedValue: text(10_001),
        }),
        "a message that is too long": create("member", at("long-message"), { ...mine, message: text(10_001) }),
        "an empty message": create("member", at("empty-message"), { ...mine, message: "" }),
        "a message that is not text": create("member", at("number-message"), { ...mine, message: 7 }),
      }),
      "a number as the proposed value": ["allowed", create("member", at("number"), { ...mine, proposedValue: 42 })],
      "a boolean as the proposed value": ["allowed", create("member", at("boolean"), { ...mine, proposedValue: true })],
      "the longest value and message": [
        "allowed",
        create("member", at("longest"), { ...mine, proposedValue: text(10_000), message: text(10_000) }),
      ],
    });
  });

  it("can be withdrawn by its creator while it is open, and is resolved by nobody directly", async () => {
    await expectOutcomes({
      ...refused({
        "another member withdraws it": update("member", stored1, { status: "withdrawn" }),
        "another member reads it": get("member", stored1),
        "its creator accepts it": update("owner", stored1, { status: "accepted" }),
        "its creator changes the proposal": update("owner", stored1, {
          status: "withdrawn",
          proposedValue: "Another name",
        }),
        "its creator names a resolver": update("owner", stored1, { status: "withdrawn", resolvedBy: OWNER_UID }),
        "an administrator accepts it": update("admin", stored1, {
          status: "accepted",
          resolvedBy: uidOfCaller("admin"),
        }),
        "an administrator withdraws it": update("admin", stored1, { status: "withdrawn" }),
        "its creator deletes it": remove("owner", stored1),
      }),
      "its creator withdraws it": ["allowed", update("owner", stored1, { status: "withdrawn" })],
      "its creator withdraws it a second time": ["denied", update("owner", stored1, { status: "withdrawn" })],
      "its creator reopens it": ["denied", update("owner", stored1, { status: "open" })],
    });
    await trusted(environment, (db) => updateDoc(doc(db, stored1), { status: "accepted" }));
    await expectOutcomes({
      "its creator withdraws a request that was accepted": [
        "denied",
        update("owner", stored1, { status: "withdrawn" }),
      ],
    });
  });
});

describe("a person", () => {
  it("lets the person edit the three addresses of the directory record and nothing else", async () => {
    await expectOutcomes({
      ...refused({
        "the display name": update("owner", PERSON, { displayName: "Another Name" }),
        "the family name": update("owner", PERSON, { familyName: "Name" }),
        "the public listing": update("owner", PERSON, { publicListing: "coreTeam" }),
        "the core team flag": update("owner", PERSON, { isCoreTeam: true }),
        "the core roles": update("owner", PERSON, { coreRoles: ["Chair"] }),
        "the country": update("owner", PERSON, { countryCode: "GB" }),
        "the custom values": update("owner", PERSON, { custom: { note: "x" } }),
        "the login": update("owner", PERSON, { userId: MEMBER_UID }),
        "the slug": update("owner", PERSON, { slug: "another-slug" }),
        "the institution": update("owner", PERSON, { institutionId: "institution-1" }),
        "an archive": update("owner", PERSON, { archivedAt: serverTimestamp() }),
        // Imports find a person again by the ORCID iD, so a callable function changes it and
        // reserves the identity key: no client writes it, the person and the programme included.
        "the ORCID iD": update("owner", PERSON, { orcid: "0000-0002-1825-0097" }),
        "the ORCID iD, by an administrator": update("admin", PERSON, { orcid: "0000-0002-1825-0097" }),
        "the identifier of the public website, by an administrator": update("admin", PERSON, {
          websitePersonId: "synthetic-owner",
        }),
        "a script as a web address": update("owner", PERSON, { scholarUrl: "javascript:alert(1)" }),
        "a file transfer address": update("owner", PERSON, { universityUrl: "ftp://example.org/profile" }),
        "an address that is too long": update("owner", PERSON, { labUrl: `https://example.org/${text(2_048)}` }),
        "the record of another person": update("owner", `persons/${MEMBER_PERSON}`, {
          labUrl: "https://example.org/lab",
        }),
        "the record, by a member who is not the person": update("member", PERSON, {
          labUrl: "https://example.org/lab",
        }),
        "the record, by a coordinator of the person's laboratory": update("ownCoordinator", PERSON, {
          labUrl: "https://example.org/lab",
        }),
      }),
      "the three addresses": [
        "allowed",
        update("owner", PERSON, {
          scholarUrl: "https://example.org/scholar",
          universityUrl: "https://example.org/university",
          labUrl: "http://example.org/laboratory",
        }),
      ],
      "the removal of one of them": ["allowed", update("owner", PERSON, { labUrl: deleteField() })],
    });
  });

  it("lets those who manage people edit the directory fields, and keeps the derived ones for trusted code", async () => {
    await expectOutcomes({
      "the names and the listing": [
        "allowed",
        update("coreTeam", PERSON, {
          displayName: "Synthetic Owner-Example",
          familyName: "Owner-Example",
          publicListing: "none",
        }),
      ],
      ...refused({
        "the login": update("admin", PERSON, { userId: null }),
        "the time of the claim": update("admin", PERSON, { claimedAt: serverTimestamp() }),
        "the summary of the affiliation": update("admin", PERSON, { affiliationSummary: "Forged University" }),
        "a required field removed": update("admin", PERSON, { displayName: deleteField() }),
        "a script as a web address": update("admin", PERSON, { labUrl: "javascript:alert(1)" }),
        "a new person": create("admin", "persons/person-forged", fieldsOf("persons")),
        "a removal": remove("admin", PERSON),
      }),
    });
  });

  it("bounds the postal address and ties an affiliation to its person", async () => {
    const affiliations = `${PERSON}/affiliations`;
    await expectOutcomes({
      ...refused({
        "an address that is too long": update("owner", `${PERSON}/private/address`, { postalAddress: text(2_001) }),
        "an address that is no text": update("owner", `${PERSON}/private/address`, { postalAddress: 7 }),
        "an affiliation that names another person": create("owner", `${affiliations}/${autoId("forged")}`, {
          personId: MEMBER_PERSON,
          isPrimary: false,
        }),
        "an affiliation whose primary flag is no boolean": create("owner", `${affiliations}/${autoId("flag")}`, {
          personId: OWNER_PERSON,
          isPrimary: "yes",
        }),
        "an affiliation of another person": create(
          "owner",
          `persons/${MEMBER_PERSON}/affiliations/${autoId("forged")}`,
          {
            personId: MEMBER_PERSON,
            isPrimary: false,
          },
        ),
        "a move of an affiliation to another laboratory": update("owner", `${affiliations}/affiliation-1`, {
          laboratoryId: OTHER_LABORATORY,
        }),
        "a removal of an affiliation": remove("owner", `${affiliations}/affiliation-1`),
        // A person names a laboratory only where it holds a confirmed member entry for them.
        "an affiliation with a laboratory that holds no entry for the person": create(
          "owner",
          `${affiliations}/${autoId("otherLaboratory")}`,
          { personId: OWNER_PERSON, laboratoryId: OTHER_LABORATORY, isPrimary: false },
        ),
        "an affiliation with a laboratory that does not exist": create(
          "owner",
          `${affiliations}/${autoId("noLaboratory")}`,
          { personId: OWNER_PERSON, laboratoryId: "lab-synthetic-none", isPrimary: false },
        ),
        "an affiliation with an institution that does not exist": create(
          "owner",
          `${affiliations}/${autoId("noInstitution")}`,
          { personId: OWNER_PERSON, institutionId: "institution-none", isPrimary: false },
        ),
        "an affiliation under an identifier of the person's own choosing": createAt(
          "owner",
          `${affiliations}/with-laboratory`,
          { personId: OWNER_PERSON, isPrimary: false },
        ),
      }),
      // The owning laboratory holds a confirmed member entry for the person of the account `owner`.
      "an affiliation with the laboratory of the person": [
        "allowed",
        create("owner", `${affiliations}/${autoId("withLaboratory")}`, {
          personId: OWNER_PERSON,
          laboratoryId: OWN_LABORATORY,
          institutionId: "institution-1",
          isPrimary: false,
        }),
      ],
      "an affiliation with any laboratory that exists, by an administrator": [
        "allowed",
        create("admin", `${affiliations}/${autoId("byAdministrator")}`, {
          personId: OWNER_PERSON,
          laboratoryId: OTHER_LABORATORY,
          isPrimary: false,
        }),
      ],
    });
  });
});

describe("a laboratory", () => {
  it("is shape-checked field by field when a coordinator edits it", async () => {
    await expectOutcomes({
      ...refused({
        "an empty name": update("ownCoordinator", LABORATORY, { name: "" }),
        "a name that is too long": update("ownCoordinator", LABORATORY, { name: text(301) }),
        "a name that is no text": update("ownCoordinator", LABORATORY, { name: 7 }),
        "a country code in lower case": update("ownCoordinator", LABORATORY, { countryCode: "gb" }),
        "a country code of three letters": update("ownCoordinator", LABORATORY, { countryCode: "GBR" }),
        "a website that is no web address": update("ownCoordinator", LABORATORY, { website: "ftp://example.org" }),
        "a status that does not exist": update("ownCoordinator", LABORATORY, { status: "closed" }),
        "custom values that are no map": update("ownCoordinator", LABORATORY, { custom: "text" }),
        "a description that is too long": update("ownCoordinator", LABORATORY, { description: text(10_001) }),
        "an empty department": update("ownCoordinator", LABORATORY, { department: "" }),
        "a city that is too long": update("ownCoordinator", LABORATORY, { city: text(301) }),
        "an institution that does not exist": update("ownCoordinator", LABORATORY, {
          institutionId: "institution-missing",
        }),
        "a principal investigator who does not exist": update("ownCoordinator", LABORATORY, {
          piPersonId: "person-missing",
        }),
        "a principal investigator as a path": update("ownCoordinator", LABORATORY, { piPersonId: "persons/x" }),
        "another slug": update("ownCoordinator", LABORATORY, { slug: "another-laboratory" }),
        "another origin": update("ownCoordinator", LABORATORY, { dataOrigin: "live" }),
        "a required field removed": update("ownCoordinator", LABORATORY, { custom: deleteField() }),
        "an unexpected key": update("ownCoordinator", LABORATORY, { rating: 5 }),
        "a removal": remove("ownCoordinator", LABORATORY),
        "the profile of another laboratory": update("ownCoordinator", `laboratories/${OTHER_LABORATORY}`, {
          city: "Example Town",
        }),
        "an edit by a member of the laboratory": update("ownLabMember", LABORATORY, { city: "Example Town" }),
      }),
      "a full profile": [
        "allowed",
        update("ownCoordinator", LABORATORY, {
          name: text(300),
          institutionId: "institution-1",
          department: "Department of Synthetic Psychology",
          countryCode: "GB",
          city: "Example Town",
          website: "https://example.org/laboratory",
          piPersonId: OWNER_PERSON,
          status: "inactive",
          description: text(10_000),
          custom: { note: "A value of a custom property." },
        }),
      ],
      "the same references again, which need no second look": [
        "allowed",
        update("ownCoordinator", LABORATORY, { city: "Another Town" }),
      ],
    });
  });

  it("bounds the private detail", async () => {
    const detail = `${LABORATORY}/private/detail`;
    await expectOutcomes({
      ...refused({
        "an address that is too long": update("ownCoordinator", detail, { address: text(2_001) }),
        "notes that are too long": update("ownCoordinator", detail, { internalNotes: text(10_001) }),
        "notes that are no text": update("ownCoordinator", detail, { internalNotes: ["x"] }),
        "an edit by a member of the laboratory, who may read it": update("ownLabMember", detail, {
          internalNotes: "x",
        }),
        "a detail document for a laboratory that does not exist": create(
          "admin",
          "laboratories/lab-missing/private/detail",
          { address: "x" },
        ),
      }),
      "a read by a member of the laboratory": ["allowed", get("ownLabMember", detail)],
    });
  });

  it("starts a member entry as proposed and lets no client confirm one", async () => {
    const members = `${LABORATORY}/members`;
    const entry = { ...fieldsOf("laboratoryMembers"), personId: MEMBER_PERSON, status: "proposed" };
    await expectOutcomes({
      ...refused({
        "an entry that is confirmed from the start": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          status: "confirmed",
        }),
        "an entry confirmed from the start by an administrator": create("admin", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          status: "confirmed",
        }),
        "a role that does not exist": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          role: "director",
        }),
        "an identifier that names another person": create("ownCoordinator", `${members}/person-else`, entry),
        "another laboratory in the document": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          laboratoryId: OTHER_LABORATORY,
        }),
        "a person who does not exist": create("ownCoordinator", `${members}/person-missing`, {
          ...entry,
          personId: "person-missing",
        }),
        "a flag that is no boolean": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          isAuthorisedRepresentative: "yes",
        }),
        "more earlier periods than an entry holds": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          earlierPeriods: Array.from({ length: 51 }, () => ({ startDate: "2020-01-01" })),
        }),
        // A rule cannot check the elements of a list, so trusted code keeps the earlier periods.
        "an earlier period, which trusted code keeps": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          earlierPeriods: [{ startDate: "2020-01-01", endDate: "2020-12-31" }],
        }),
        "a start date that is no date": create("ownCoordinator", `${members}/${MEMBER_PERSON}`, {
          ...entry,
          startDate: "2026-02-30",
        }),
        "an entry in a laboratory that does not exist": create(
          "admin",
          `laboratories/lab-missing/members/${MEMBER_PERSON}`,
          {
            ...entry,
            laboratoryId: "lab-missing",
          },
        ),
      }),
      "a proposed entry": ["allowed", create("ownCoordinator", `${members}/${MEMBER_PERSON}`, entry)],
      "its confirmation by the coordinator": [
        "denied",
        update("ownCoordinator", `${members}/${MEMBER_PERSON}`, { status: "confirmed" }),
      ],
      "its confirmation by an administrator, which a function performs": [
        "denied",
        update("admin", `${members}/${MEMBER_PERSON}`, { status: "confirmed" }),
      ],
      "an edit of the dates of a confirmed entry, which leaves it confirmed": [
        "allowed",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { startDate: "2024-01-01" }),
      ],
      // The person confirmed an entry as a member. What was confirmed changes only together
      // with the confirmation: the entry returns to proposed, and the person confirms it again.
      "the mark of an authorised representative on an entry that stays confirmed": [
        "denied",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { isAuthorisedRepresentative: true }),
      ],
      "another role on an entry that stays confirmed": [
        "denied",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { role: "pi" }),
      ],
      "an earlier period on an entry, which trusted code keeps": [
        "denied",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { earlierPeriods: [{ startDate: "2020-01-01" }] }),
      ],
      "the end of a confirmed entry": [
        "allowed",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { status: "ended", endDate: "2026-03-31" }),
      ],
      "its confirmation again": [
        "denied",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { status: "confirmed" }),
      ],
      "another role on an entry that is put forward again as a proposal": [
        "allowed",
        update("ownCoordinator", `${members}/${OWNER_PERSON}`, { role: "representative", status: "proposed" }),
      ],
      "a new configuration of equipment, which a function writes": [
        "denied",
        create("ownCoordinator", `${LABORATORY}/equipment/configuration-2`, fieldsOf("laboratoryEquipment")),
      ],
    });
  });
});

describe("a replication", () => {
  it("keeps the status, the status history and the leads for trusted code", async () => {
    await expectOutcomes({
      ...refused({
        "the status, by a lead": update("ownLead", REPLICATION, { statusKey: "published" }),
        "the status history, by a lead": update("ownLead", REPLICATION, { statusHistoryId: "history-forged" }),
        "the leads, by a lead": update("ownLead", REPLICATION, { leadPersonIds: [OWNER_PERSON] }),
        "the status, by an administrator": update("admin", REPLICATION, { statusKey: "published" }),
        "an entry of the status history": create(
          "admin",
          "statusHistory/history-forged",
          fieldsOf("statusHistory"),
          true,
        ),
        "a change of an entry of the status history": update("admin", "statusHistory/history-1", { reason: "Forged" }),
        "a citation status that does not exist": update("ownLead", REPLICATION, { citationStatus: "guessed" }),
        "a selection status that does not exist": update("ownLead", REPLICATION, { selectionStatus: "maybe" }),
        "a script as the address for signing up": update("ownLead", REPLICATION, { signupUrl: "javascript:alert(1)" }),
        "a vocabulary that is no list": update("ownLead", REPLICATION, { vocabulary: "attention" }),
        "a programme that does not exist": update("ownLead", REPLICATION, { programmeId: "programme-missing" }),
        "a removal": remove("admin", REPLICATION),
      }),
      "descriptive fields, by a lead": [
        "allowed",
        update("ownLead", REPLICATION, {
          abstract: "A synthetic abstract.",
          targetN: 120,
          signupUrl: "https://example.org/signup",
        }),
      ],
    });
  });

  it("is created by the programme, with its identifier as its study key and nothing that trusted code fills in", async () => {
    const replication = (studyKey: string) => ({ ...(FIXTURES.replications?.create?.data("") ?? {}), studyKey });
    const at = (studyKey: string) => `replications/${studyKey}`;
    await expectOutcomes({
      ...refused({
        "a study key that differs from the identifier": create(
          "admin",
          at("SyntheticStudy2004"),
          replication("SyntheticStudy2005"),
        ),
        "an identifier with an underscore": create("admin", at("Synthetic_2004"), replication("Synthetic_2004")),
        "an identifier that starts with a digit": create("admin", at("2004Synthetic"), replication("2004Synthetic")),
        "a status from the start": create("admin", at("SyntheticStudy2004"), {
          ...replication("SyntheticStudy2004"),
          statusKey: "planning",
        }),
        "leads from the start": create("admin", at("SyntheticStudy2004"), {
          ...replication("SyntheticStudy2004"),
          leadPersonIds: [OWNER_PERSON],
        }),
        "the origin of an import": create("admin", at("SyntheticStudy2004"), {
          ...replication("SyntheticStudy2004"),
          dataOrigin: "importedHistorical",
        }),
        "a programme that does not exist": create("admin", at("SyntheticStudy2004"), {
          ...replication("SyntheticStudy2004"),
          programmeId: "programme-missing",
        }),
        "a replication made by a lead": create("ownLead", at("SyntheticStudy2004"), replication("SyntheticStudy2004")),
      }),
      "a replication made by the core team": [
        "allowed",
        create("coreTeam", at("SyntheticStudy2004"), replication("SyntheticStudy2004")),
      ],
    });
  });

  it("lets a client write the internal notes of the private detail and nothing else in it", async () => {
    const detail = `${REPLICATION}/private/detail`;
    const fresh = `replications/${OTHER_REPLICATION}/private/detail`;
    await expectOutcomes({
      ...refused({
        "the verbatim notes of a source": update("ownLead", detail, { notesSource: "Forged source note." }),
        "the unverified outcome labels": update("ownLead", detail, { replicatedSource: { h01: "yes" } }),
        "the verbatim notes, by an administrator": update("admin", detail, { notesSource: "Forged source note." }),
        "internal notes that are too long": update("ownLead", detail, { internalNotes: text(10_001) }),
        "a new detail document with outcome labels": create("otherLead", fresh, {
          internalNotes: "x",
          replicatedSource: { h01: "yes" },
        }),
        "a new detail document with verbatim notes": create("otherLead", fresh, { notesSource: "Forged source note." }),
        "a detail document for a replication that does not exist": create(
          "admin",
          "replications/Missing2000/private/detail",
          { internalNotes: "x" },
        ),
        "an edit by a team member, who may read it": update("ownTeam", detail, { internalNotes: "x" }),
      }),
      "a read by a team member": ["allowed", get("ownTeam", detail)],
      "the internal notes": ["allowed", update("ownLead", detail, { internalNotes: text(10_000) })],
    });
  });

  it("leaves the roles lead and coLead, and every confirmation, to the programme", async () => {
    const memberships = `${REPLICATION}/memberships`;
    const membership = (personId: string, role: string, reviewStatus = "needsReview") => ({
      ...fieldsOf("replicationMemberships"),
      personId,
      role,
      reviewStatus,
    });
    const idOf = replicationMembershipId;
    const confirmed = `${memberships}/${idOf(OWNER_PERSON, "member")}`;
    const leadMembership = `${memberships}/${idOf(OWNER_PERSON, "lead")}`;
    await trusted(environment, (db) =>
      setDoc(doc(db, leadMembership), { ...stored(), ...membership(OWNER_PERSON, "lead", "confirmed") }),
    );
    await expectOutcomes({
      ...refused({
        "a lead adds a lead": create(
          "ownLead",
          `${memberships}/${idOf(MEMBER_PERSON, "lead")}`,
          membership(MEMBER_PERSON, "lead"),
        ),
        "a lead adds a co-lead": create(
          "ownLead",
          `${memberships}/${idOf(MEMBER_PERSON, "coLead")}`,
          membership(MEMBER_PERSON, "coLead"),
        ),
        "a lead adds a confirmed membership": create(
          "ownLead",
          `${memberships}/${idOf(MEMBER_PERSON, "advisor")}`,
          membership(MEMBER_PERSON, "advisor", "confirmed"),
        ),
        "an identifier that names another role": create(
          "ownLead",
          `${memberships}/${idOf(MEMBER_PERSON, "member")}`,
          membership(MEMBER_PERSON, "advisor"),
        ),
        "a person who does not exist": create(
          "ownLead",
          `${memberships}/${idOf("person-missing", "advisor")}`,
          membership("person-missing", "advisor"),
        ),
        "another replication in the document": create("ownLead", `${memberships}/${idOf(MEMBER_PERSON, "advisor")}`, {
          ...membership(MEMBER_PERSON, "advisor"),
          replicationId: OTHER_REPLICATION,
        }),
        "a role that does not exist": create(
          "admin",
          `${memberships}/${idOf(MEMBER_PERSON, "founder")}`,
          membership(MEMBER_PERSON, "founder"),
        ),
        "a membership in a replication that does not exist": create(
          "admin",
          `replications/Missing2000/memberships/${idOf(MEMBER_PERSON, "advisor")}`,
          { ...membership(MEMBER_PERSON, "advisor"), replicationId: "Missing2000" },
        ),
        "a lead withdraws a confirmation": update("ownLead", confirmed, { reviewStatus: "needsReview" }),
        "a lead edits the membership of a lead": update("ownLead", leadMembership, { isCurrent: false }),
        "a lead of another replication edits a membership": update("otherLead", confirmed, { isCurrent: false }),
        "a removal": remove("admin", confirmed),
      }),
      "a lead proposes an advisor": [
        "allowed",
        create("ownLead", `${memberships}/${idOf(MEMBER_PERSON, "advisor")}`, membership(MEMBER_PERSON, "advisor")),
      ],
      "the lead confirms the proposal": [
        "denied",
        update("ownLead", `${memberships}/${idOf(MEMBER_PERSON, "advisor")}`, { reviewStatus: "confirmed" }),
      ],
      "the core team confirms it": [
        "allowed",
        update("coreTeam", `${memberships}/${idOf(MEMBER_PERSON, "advisor")}`, { reviewStatus: "confirmed" }),
      ],
      "a lead ends a confirmed membership": [
        "allowed",
        update("ownLead", confirmed, { isCurrent: false, endDate: "2026-03-31" }),
      ],
      // The confirmation covered the period that has ended, and a current, confirmed membership
      // gives the leads sight of the contact details of the person.
      "the lead makes the ended membership current again": [
        "denied",
        update("ownLead", confirmed, { isCurrent: true }),
      ],
      "the lead writes an earlier period, which trusted code keeps": [
        "denied",
        update("ownLead", confirmed, { earlierPeriods: [{ startDate: "2020-01-01" }] }),
      ],
      "the core team makes it current again": ["allowed", update("coreTeam", confirmed, { isCurrent: true })],
      "an administrator adds a confirmed co-lead": [
        "allowed",
        create(
          "admin",
          `${memberships}/${idOf(MEMBER_PERSON, "coLead")}`,
          membership(MEMBER_PERSON, "coLead", "confirmed"),
        ),
      ],
      "an administrator edits the membership of a lead": [
        "allowed",
        update("admin", leadMembership, { isCurrent: false }),
      ],
    });
  });

  it("shape-checks a hypothesis field by field", async () => {
    const hypotheses = `${REPLICATION}/hypotheses`;
    const hypothesis = (number: string) => ({ ...fieldsOf("replicationHypotheses"), hypothesisNumber: number });
    const lead = uidOfCaller("ownLead");
    const core = uidOfCaller("coreTeam");
    await expectOutcomes({
      ...refused({
        "the identifier h00": create("ownLead", `${hypotheses}/h00`, hypothesis("0")),
        "an identifier of three digits": create("ownLead", `${hypotheses}/h100`, hypothesis("100")),
        "an identifier without its leading zero": create("ownLead", `${hypotheses}/h3`, hypothesis("3")),
        "an identifier in upper case": create("ownLead", `${hypotheses}/H03`, hypothesis("3")),
        "a number that differs from the identifier": create("ownLead", `${hypotheses}/h03`, hypothesis("4")),
        "a number with its leading zero": create("ownLead", `${hypotheses}/h03`, hypothesis("03")),
        "a text that is too long": create("ownLead", `${hypotheses}/h03`, { ...hypothesis("3"), text: text(102_401) }),
        "a text that is no text": create("ownLead", `${hypotheses}/h03`, { ...hypothesis("3"), text: ["x"] }),
        "a scientific review status that does not exist": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          scientificReviewStatus: "done",
        }),
        "an analysis status that does not exist": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          analysisStatus: "finished",
        }),
        "a preregistration that is no web address": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          preregistrationUrl: "osf.io/abcde",
        }),
        "an empty expected effect": create("ownLead", `${hypotheses}/h03`, { ...hypothesis("3"), expectedEffect: "" }),
        "an outcome measure that is too long": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          outcomeMeasure: text(10_001),
        }),
        "another account as the reviewer of the result": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          resultReviewedBy: OWNER_UID,
          resultReviewedAt: serverTimestamp(),
        }),
        "a review at a time of the client's choosing": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          resultReviewedBy: lead,
          resultReviewedAt: clientTime(),
        }),
        "a reviewer without a time": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          resultReviewedBy: lead,
        }),
        "another replication in the document": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          replicationId: OTHER_REPLICATION,
        }),
        "a hypothesis of a replication that does not exist": create(
          "admin",
          "replications/Missing2000/hypotheses/h01",
          {
            ...hypothesis("1"),
            replicationId: "Missing2000",
          },
        ),
        "a hypothesis of another replication": create("ownLead", `replications/${OTHER_REPLICATION}/hypotheses/h01`, {
          ...hypothesis("1"),
          replicationId: OTHER_REPLICATION,
        }),
        "an edit to a text that is too long": update("ownLead", `${hypotheses}/h01`, { text: text(102_401) }),
        "an edit that names another reviewer": update("ownLead", `${hypotheses}/h01`, {
          resultReviewedBy: OWNER_UID,
          resultReviewedAt: serverTimestamp(),
        }),
        "an edit to a study description that is no web address": update("ownLead", `${hypotheses}/h01`, {
          studyDescriptionUrl: "x",
        }),
        "a removal": remove("ownLead", `${hypotheses}/h01`),
        // A lead does not review its own result: the review and the review status are for
        // programme administrators and the core team.
        "a hypothesis that its lead has reviewed": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          resultReviewedBy: lead,
          resultReviewedAt: serverTimestamp(),
        }),
        "a hypothesis that its lead creates as verified": create("ownLead", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          scientificReviewStatus: "verified",
        }),
        "a result and its review, by the lead": update("ownLead", `${hypotheses}/h01`, {
          analysisStatus: "completed",
          resultSummary: "The synthetic effect was found.",
          resultReviewedBy: lead,
          resultReviewedAt: serverTimestamp(),
        }),
        "the review status, by the lead": update("ownLead", `${hypotheses}/h01`, {
          scientificReviewStatus: "underReview",
        }),
        "a text that takes more than 100 KiB, in characters of three bytes": update("ownLead", `${hypotheses}/h01`, {
          text: "\u20AC".repeat(40_000),
        }),
      }),
      "the tenth hypothesis, with the longest text": [
        "allowed",
        create("ownLead", `${hypotheses}/h10`, { ...hypothesis("10"), text: text(102_400) }),
      ],
      "a hypothesis that the core team reviews as it creates it": [
        "allowed",
        create("coreTeam", `${hypotheses}/h03`, {
          ...hypothesis("3"),
          resultReviewedBy: core,
          resultReviewedAt: serverTimestamp(),
        }),
      ],
      "a result, by the lead": [
        "allowed",
        update("ownLead", `${hypotheses}/h01`, {
          analysisStatus: "completed",
          resultSummary: "The synthetic effect was found.",
        }),
      ],
      "its review, by the core team": [
        "allowed",
        update("coreTeam", `${hypotheses}/h01`, {
          scientificReviewStatus: "verified",
          resultReviewedBy: core,
          resultReviewedAt: serverTimestamp(),
        }),
      ],
      // The review covers the content. Its lead changes nothing but the addresses any more, and
      // a reviewer who changes the content clears the review or signs it anew.
      "another result under the review, by the lead": [
        "denied",
        update("ownLead", `${hypotheses}/h01`, { resultSummary: "The synthetic effect was not found." }),
      ],
      "an archive of the reviewed hypothesis, by the lead": [
        "denied",
        update("ownLead", `${hypotheses}/h01`, { archivedAt: serverTimestamp() }),
      ],
      "an address on the reviewed hypothesis, by the lead": [
        "allowed",
        update("ownLead", `${hypotheses}/h01`, { studyDescriptionUrl: "https://example.org/study-description" }),
      ],
      "another result under the review of someone else, by an administrator": [
        "denied",
        update("admin", `${hypotheses}/h01`, { resultSummary: "The synthetic effect was not found." }),
      ],
      "another result that the administrator signs anew": [
        "allowed",
        update("admin", `${hypotheses}/h01`, {
          resultSummary: "The synthetic effect was not found.",
          resultReviewedBy: uidOfCaller("admin"),
          resultReviewedAt: serverTimestamp(),
        }),
      ],
      "a change of the content that clears the review": [
        "allowed",
        update("coreTeam", `${hypotheses}/h01`, {
          scientificReviewStatus: "underReview",
          resultReviewedBy: null,
          resultReviewedAt: null,
        }),
      ],
    });
  });

  it("ties protocols, versions and requirements to their replication and their keys", async () => {
    const version = { ...fieldsOf("replicationProtocolVersions"), versionLabel: "2.0", status: "draft" };
    const requirement = { ...fieldsOf("replicationEquipmentRequirements") };
    const lead = uidOfCaller("ownLead");
    await expectOutcomes({
      ...refused({
        "a version of a protocol that does not exist": create(
          "ownLead",
          `${REPLICATION}/protocolVersions/${autoId("version-2")}`,
          {
            ...version,
            protocolId: "protocol-missing",
          },
        ),
        "a version status that does not exist": create(
          "ownLead",
          `${REPLICATION}/protocolVersions/${autoId("version-2")}`,
          {
            ...version,
            status: "final",
          },
        ),
        "an approval in another name": create("ownLead", `${REPLICATION}/protocolVersions/${autoId("version-2")}`, {
          ...version,
          approvedBy: OWNER_UID,
          approvedAt: serverTimestamp(),
        }),
        "a move of a version to another protocol": update("ownLead", `${REPLICATION}/protocolVersions/version-1`, {
          protocolId: "protocol-2",
        }),
        "a protocol with an empty title": create("ownLead", `${REPLICATION}/protocols/${autoId("protocol-2")}`, {
          replicationId: OWN_REPLICATION,
          title: "",
          currentVersionId: null,
        }),
        "a requirement whose key differs from its identifier": create(
          "ownLead",
          `${REPLICATION}/equipmentRequirements/display`,
          {
            ...requirement,
            requirementKey: "refresh-rate",
          },
        ),
        "an operator that does not exist": create("ownLead", `${REPLICATION}/equipmentRequirements/display`, {
          ...requirement,
          requirementKey: "display",
          operator: "near",
        }),
        "a mandatory flag that is no boolean": update("ownLead", `${REPLICATION}/equipmentRequirements/min-channels`, {
          isMandatory: "yes",
        }),
      }),
      "a version approved by the caller": [
        "allowed",
        create("ownLead", `${REPLICATION}/protocolVersions/${autoId("version-2")}`, {
          ...version,
          status: "approved",
          approvedBy: lead,
          approvedAt: serverTimestamp(),
        }),
      ],
    });
  });
});

describe("lookup data", () => {
  it("is held to its keys, its enumerations and the records it refers to", async () => {
    const definition = { ...fieldsOf("statusDefinitions"), key: "synthetic" };
    const category = { ...fieldsOf("countCategories"), key: "synthetic" };
    await expectOutcomes({
      ...refused({
        "a status whose identifier does not join its type and key": create(
          "admin",
          "statusDefinitions/replication__other",
          definition,
        ),
        "a status for a kind of record that has none": create("admin", "statusDefinitions/laboratory__synthetic", {
          ...definition,
          entityType: "laboratory",
        }),
        "a status category that does not exist": create("admin", "statusDefinitions/replication__synthetic", {
          ...definition,
          category: "unknown",
        }),
        "a negative position": create("admin", "statusDefinitions/replication__synthetic", {
          ...definition,
          position: -1,
        }),
        "a status made by a lead": create("ownLead", "statusDefinitions/replication__synthetic", definition),
        "a programme beneath a parent that does not exist": create("admin", "programmes/synthetic-child", {
          key: "synthetic-child",
          name: "Synthetic child",
          parentId: "programme-missing",
          kind: "subproject",
        }),
        "a programme of a kind that does not exist": update("admin", "programmes/synthetic-programme", {
          kind: "department",
        }),
        "a programme whose key differs from its identifier": create("admin", "programmes/synthetic-child", {
          key: "another-key",
          name: "Synthetic child",
          parentId: null,
          kind: "programme",
        }),
        "a category of a replication that does not exist": create("admin", "countCategories/synthetic", {
          ...category,
          replicationId: "Missing2000",
        }),
        "a category whose key differs from its identifier": create("admin", "countCategories/another", category),
        "a category without a definition": create("admin", "countCategories/synthetic", {
          ...category,
          definition: "",
        }),
        "a template without items": update("admin", "checklistTemplates/onboarding", { items: [] }),
        "a template with too many items": update("admin", "checklistTemplates/onboarding", {
          items: Array.from({ length: 101 }, (_, index) => ({ key: `item-${index}`, label: "Item" })),
        }),
        "a candidate study that is already a replication": create("admin", "candidateStudies/candidate-2", {
          ...fieldsOf("candidateStudies"),
          dataOrigin: "live",
          replicationId: OWN_REPLICATION,
        }),
        "a candidate study with an origin other than live": create(
          "admin",
          "candidateStudies/candidate-2",
          fieldsOf("candidateStudies"),
        ),
        "a selection status that does not exist": update("admin", "candidateStudies/candidate-1", {
          selectionStatus: "favourite",
        }),
        "a vocabulary term without a name": create("admin", "vocabularyTerms/term-2", {
          ...fieldsOf("vocabularyTerms"),
          name: "",
        }),
        "a question about a replication that does not exist": create(
          "admin",
          `predictionMarketItems/${autoId("item-2")}`,
          {
            ...fieldsOf("predictionMarketItems"),
            replicationId: "Missing2000",
          },
        ),
        "a question with too many choices": update("admin", "predictionMarketItems/item-1", {
          choices: Array.from({ length: 51 }, (_, index) => `Choice ${index}`),
        }),
        "an institution without a name": update("admin", "institutions/institution-1", { name: "" }),
        "a new institution, which a function creates": create(
          "admin",
          "institutions/institution-2",
          fieldsOf("institutions"),
        ),
        "the settings of the portal": update("admin", "system/settings", { maintenanceMode: true }),
      }),
      "a status definition": ["allowed", create("coreTeam", "statusDefinitions/replication__synthetic", definition)],
      "a category of one replication": [
        "allowed",
        create("admin", "countCategories/synthetic", { ...category, replicationId: OWN_REPLICATION }),
      ],
    });
  });
});

describe("a participation", () => {
  const NEW_PARTICIPATION = participationId(OTHER_REPLICATION, OWN_LABORATORY);
  const fresh = () => FIXTURES.participations?.create?.data("") ?? {};
  const at = (id: string) => `participations/${id}`;

  it("is shape-checked field by field, and exists once for its replication and laboratory", async () => {
    const target = at(NEW_PARTICIPATION);
    await expectOutcomes({
      ...refused({
        "an identifier that does not join the two": create("ownCoordinator", at("participation-1"), fresh()),
        "an identifier with the two the other way round": create(
          "ownCoordinator",
          at(`${OWN_LABORATORY}__${OTHER_REPLICATION}`),
          fresh(),
        ),
        "scope keys of another unit": create("ownCoordinator", target, {
          ...fresh(),
          scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
        }),
        "scope keys in the wrong order": create("ownCoordinator", target, {
          ...fresh(),
          scopeKeys: [LABORATORY_KEY, replicationScopeKey(OTHER_REPLICATION)],
        }),
        "scope keys that open it to more": create("ownCoordinator", target, {
          ...fresh(),
          scopeKeys: [...unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY), MEMBERS_SCOPE_KEY],
        }),
        "a status that only a function sets": create("ownCoordinator", target, { ...fresh(), status: "collecting" }),
        // The replication invites and the laboratory registers its interest: neither side
        // records the decision of the other, and readiness starts at its beginning.
        "an invitation, recorded by the coordinator of the laboratory": create("ownCoordinator", target, {
          ...fresh(),
          status: "invited",
        }),
        "the interest of the laboratory, recorded by the lead of the replication": create("otherLead", target, {
          ...fresh(),
          status: "interested",
        }),
        "readiness that is approved from the start": create("ownCoordinator", target, {
          ...fresh(),
          readinessStatus: "approved",
        }),
        "readiness that is under way from the start": create("ownCoordinator", target, {
          ...fresh(),
          readinessStatus: "inProgress",
        }),
        "a custom value that is a list": create("ownCoordinator", target, { ...fresh(), custom: { rooms: ["B12"] } }),
        "a custom value under a key with a full stop": create("ownCoordinator", target, {
          ...fresh(),
          custom: { "room.number": 12 },
        }),
        "a status history from the start": create("ownCoordinator", target, {
          ...fresh(),
          statusHistoryId: "history-1",
        }),
        "the origin of an import": create("ownCoordinator", target, { ...fresh(), dataOrigin: "importedHistorical" }),
        "a negative target": create("ownCoordinator", target, { ...fresh(), targetNMain: -1 }),
        "a target that is no whole number": create("ownCoordinator", target, { ...fresh(), targetNMain: 12.5 }),
        "a target beyond the largest": create("ownCoordinator", target, { ...fresh(), targetNRest: 1_000_001 }),
        "a target as text": create("ownCoordinator", target, { ...fresh(), targetNMain: "40" }),
        "a readiness status that does not exist": create("ownCoordinator", target, {
          ...fresh(),
          readinessStatus: "done",
        }),
        "custom values that are no map": create("ownCoordinator", target, { ...fresh(), custom: [] }),
        "a time of signing up that is no time": create("ownCoordinator", target, {
          ...fresh(),
          signedUpAt: "yesterday",
        }),
        "a local lead who does not exist": create("ownCoordinator", target, {
          ...fresh(),
          localLeadPersonId: "person-missing",
        }),
        "a protocol of another replication": create("ownCoordinator", target, { ...fresh(), protocolId: "protocol-1" }),
        "a protocol version of another replication": create("ownCoordinator", target, {
          ...fresh(),
          protocolVersionId: "version-1",
        }),
        "an equipment configuration that does not exist": create("ownCoordinator", target, {
          ...fresh(),
          equipmentConfigurationId: "configuration-missing",
        }),
        "a replication that does not exist": create(
          "ownCoordinator",
          at(participationId("Missing2000", OWN_LABORATORY)),
          {
            ...fresh(),
            replicationId: "Missing2000",
            scopeKeys: unitScopeKeys("Missing2000", OWN_LABORATORY),
          },
        ),
        "a laboratory that does not exist": create("otherLead", at(participationId(OTHER_REPLICATION, "lab-missing")), {
          ...fresh(),
          status: "invited",
          laboratoryId: "lab-missing",
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, "lab-missing"),
        }),
        "a participation of a laboratory and a replication that the caller does not manage": create(
          "ownLead",
          target,
          fresh(),
        ),
      }),
    });
  });

  it("accepts every reference at once, which is the most documents a rule reads", async () => {
    await trusted(environment, async (db) => {
      const protocol = { ...stored(), ...fieldsOf("replicationProtocols"), replicationId: OTHER_REPLICATION };
      const version = { ...stored(), ...fieldsOf("replicationProtocolVersions"), replicationId: OTHER_REPLICATION };
      await setDoc(doc(db, `replications/${OTHER_REPLICATION}/protocols/protocol-1`), protocol);
      await setDoc(doc(db, `replications/${OTHER_REPLICATION}/protocolVersions/version-1`), version);
    });
    const complete = {
      ...fresh(),
      localLeadPersonId: OWNER_PERSON,
      protocolId: "protocol-1",
      protocolVersionId: "version-1",
      equipmentConfigurationId: "configuration-1",
      targetNMain: 1_000_000,
      targetNRest: 0,
      signedUpAt: serverTimestamp(),
      custom: { room: "B12", booths: 2, shielded: true },
    };
    await expectOutcomes({
      "a participation with all four references": [
        "allowed",
        create("ownCoordinator", at(NEW_PARTICIPATION), complete),
      ],
      "a second participation of the same pair, which is the same document": [
        "denied",
        create("ownCoordinator", at(NEW_PARTICIPATION), complete),
      ],
    });
  });

  it("keeps its status for the function that writes the history, and checks the references an edit introduces", async () => {
    await expectOutcomes({
      ...refused({
        "the status, by a lead": update("ownLead", PARTICIPATION, { status: "confirmed" }),
        "the status, by a coordinator": update("ownCoordinator", PARTICIPATION, { status: "withdrawn" }),
        "the status, by an administrator": update("admin", PARTICIPATION, { status: "ready" }),
        "the status history": update("ownLead", PARTICIPATION, { statusHistoryId: "history-forged" }),
        "the laboratory": update("ownLead", PARTICIPATION, { laboratoryId: OTHER_LABORATORY }),
        "a protocol that does not exist": update("ownLead", PARTICIPATION, { protocolId: "protocol-missing" }),
        "a negative target": update("ownLead", PARTICIPATION, { targetNRest: -5 }),
        "an edit by a member of the laboratory": update("ownLabMember", PARTICIPATION, { targetNMain: 10 }),
        "an edit by a team member of the replication": update("ownTeam", PARTICIPATION, { targetNMain: 10 }),
        "a removal": remove("admin", PARTICIPATION),
      }),
      "a protocol and a version of the replication, by a lead": [
        "allowed",
        update("ownLead", PARTICIPATION, {
          protocolId: "protocol-1",
          protocolVersionId: "version-1",
          signedUpAt: serverTimestamp(),
        }),
      ],
      "the equipment and the local lead, by a coordinator": [
        "allowed",
        update("ownCoordinator", PARTICIPATION, {
          equipmentConfigurationId: "configuration-1",
          localLeadPersonId: OWNER_PERSON,
          targetNRest: 12,
        }),
      ],
    });
  });

  it("checks the private detail and who approves readiness", async () => {
    const detail = `${PARTICIPATION}/private/detail`;
    const coordinator = uidOfCaller("ownCoordinator");
    await expectOutcomes({
      ...refused({
        "an ethics status that does not exist": update("ownCoordinator", detail, { ethicsStatus: "pending" }),
        "a training status that does not exist": update("ownCoordinator", detail, { trainingStatus: "done" }),
        "an approval of readiness in another name": update("ownCoordinator", detail, {
          readinessApprovedBy: OWNER_UID,
          readinessApprovedAt: serverTimestamp(),
        }),
        "an approval at a time of the client's choosing": update("ownCoordinator", detail, {
          readinessApprovedBy: coordinator,
          readinessApprovedAt: clientTime(),
        }),
        "notes that are too long": update("ownCoordinator", detail, { notes: text(10_001) }),
        "a read by an ordinary member": get("member", detail),
        "an edit by a member of the laboratory, who may read it": update("ownLabMember", detail, { notes: "x" }),
      }),
      "a read by a member of the laboratory": ["allowed", get("ownLabMember", detail)],
      // The laboratory asks for the review and the replication decides it.
      "an approval of readiness by the coordinator of the laboratory under review": [
        "denied",
        update("ownCoordinator", detail, { readinessApprovedBy: coordinator, readinessApprovedAt: serverTimestamp() }),
      ],
      "an approval of readiness by the lead of the replication, now": [
        "allowed",
        update("ownLead", detail, {
          readinessApprovedBy: uidOfCaller("ownLead"),
          readinessApprovedAt: serverTimestamp(),
        }),
      ],
      "a later edit of the notes, which the approval does not cover": [
        "allowed",
        update("ownCoordinator", detail, { notes: "The pilot is booked." }),
      ],
      // The approval covers ethics, training and the equipment override.
      "a later edit of what was approved, which leaves the approval as it is": [
        "denied",
        update("ownCoordinator", detail, { trainingStatus: "completed" }),
      ],
      "the removal of the approval by the coordinator": [
        "denied",
        update("ownCoordinator", detail, { readinessApprovedBy: null, readinessApprovedAt: null }),
      ],
      "an edit of what was approved that the lead signs anew": [
        "allowed",
        update("ownLead", detail, {
          trainingStatus: "completed",
          readinessApprovedBy: uidOfCaller("ownLead"),
          readinessApprovedAt: serverTimestamp(),
        }),
      ],
      "the removal of the approval by the core team": [
        "allowed",
        update("coreTeam", detail, { readinessApprovedBy: null, readinessApprovedAt: null }),
      ],
      "an edit of what is no longer approved, by the coordinator": [
        "allowed",
        update("ownCoordinator", detail, { ethicsStatus: "approved", ethicsReference: "SYN-2026-002" }),
      ],
    });
  });

  it("lets a member of the laboratory update the status, the evidence and the note of a checklist item, shape-checked", async () => {
    const item = `${PARTICIPATION}/checklist/ethics`;
    const member = uidOfCaller("ownLabMember");
    await expectOutcomes({
      ...refused({
        "the label": update("ownLabMember", item, { label: "Another label" }),
        "the position": update("ownLabMember", item, { position: 1 }),
        "the template key": update("ownLabMember", item, { templateKey: "another" }),
        "the participation": update("ownLabMember", item, { participationId: "another" }),
        "an archive": update("ownLabMember", item, { archivedAt: serverTimestamp() }),
        "a status that does not exist": update("ownLabMember", item, { status: "finished" }),
        "completion in another name": update("ownLabMember", item, {
          status: "done",
          completedBy: OWNER_UID,
          completedAt: serverTimestamp(),
        }),
        "completion at a time of the client's choosing": update("ownLabMember", item, {
          status: "done",
          completedBy: member,
          completedAt: clientTime(),
        }),
        "completion without a time": update("ownLabMember", item, { status: "done", completedBy: member }),
        "evidence that is no web address": update("ownLabMember", item, { evidenceUrl: "file:///ethics.pdf" }),
        "an empty note": update("ownLabMember", item, { note: "" }),
        "a note that is too long": update("ownLabMember", item, { note: text(10_001) }),
        "an unexpected key": update("ownLabMember", item, { priority: "high" }),
        "an edit by a member of another laboratory": update("otherLabMember", item, { status: "inProgress" }),
        "an edit by a team member of the replication, who may read it": update("ownTeam", item, {
          status: "inProgress",
        }),
        "an edit by an ordinary member": update("member", item, { status: "inProgress" }),
        "the label, by a coordinator": update("ownCoordinator", item, { label: "Another label" }),
        "a new item, which a function creates": create(
          "ownCoordinator",
          `${PARTICIPATION}/checklist/pilot`,
          fieldsOf("participationChecklist"),
        ),
        "a removal": remove("ownCoordinator", item),
      }),
      "a read by a team member of the replication": ["allowed", get("ownTeam", item)],
      "completion by the member, now, with evidence and a note": [
        "allowed",
        update("ownLabMember", item, {
          status: "done",
          completedBy: member,
          completedAt: serverTimestamp(),
          evidenceUrl: "https://example.org/ethics-letter",
          note: text(10_000),
        }),
      ],
      // The completion is a signature on the status, the evidence and the note of the item.
      "another note on the completed item, which leaves the completion as it is": [
        "denied",
        update("ownLead", item, { note: "Checked." }),
      ],
      "the item marked as not started while it still names who completed it": [
        "denied",
        update("ownLabMember", item, { status: "notStarted" }),
      ],
      "the item left as done with nobody named": [
        "denied",
        update("ownLabMember", item, { completedBy: null, completedAt: null }),
      ],
      "the item reopened by the member who completed it": [
        "allowed",
        update("ownLabMember", item, { status: "inProgress", completedBy: null, completedAt: null }),
      ],
      "the item marked as done with nobody named": ["denied", update("ownLabMember", item, { status: "done" })],
      "completion by the coordinator": [
        "allowed",
        update("ownCoordinator", item, {
          status: "done",
          completedBy: uidOfCaller("ownCoordinator"),
          completedAt: serverTimestamp(),
        }),
      ],
      "the item reopened by a member who did not complete it": [
        "denied",
        update("ownLabMember", item, { status: "inProgress", completedBy: null, completedAt: null }),
      ],
      "other evidence that the lead signs anew": [
        "allowed",
        update("ownLead", item, {
          evidenceUrl: "https://example.org/ethics-letter-2",
          completedBy: uidOfCaller("ownLead"),
          completedAt: serverTimestamp(),
        }),
      ],
      "the item reopened by the coordinator, who manages the participation": [
        "allowed",
        update("ownCoordinator", item, { status: "blocked", completedBy: null, completedAt: null }),
      ],
    });
  });

  it("makes what sits beneath a participation inherit its scope", async () => {
    const team = `${PARTICIPATION}/teamMembers`;
    const teamMember = { participationId: OWN_PARTICIPATION, personId: MEMBER_PERSON, role: "experimenter", ...UNIT };
    const deviation = (uid: string) => ({ ...fieldsOf("participationDeviations"), reportedBy: uid });
    const coordinator = uidOfCaller("ownCoordinator");
    await expectOutcomes({
      ...refused({
        "a team member with the scope of another replication": create("ownCoordinator", `${team}/${MEMBER_PERSON}`, {
          ...teamMember,
          replicationId: OTHER_REPLICATION,
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
        }),
        "a team member with fewer scope keys": create("ownCoordinator", `${team}/${MEMBER_PERSON}`, {
          ...teamMember,
          scopeKeys: [LABORATORY_KEY],
        }),
        "a team member open to every member": create("ownCoordinator", `${team}/${MEMBER_PERSON}`, {
          ...teamMember,
          scopeKeys: [...UNIT.scopeKeys, MEMBERS_SCOPE_KEY],
        }),
        "a team member that names another participation": create("ownCoordinator", `${team}/${MEMBER_PERSON}`, {
          ...teamMember,
          participationId: "another",
        }),
        "a team member whose identifier names another person": create(
          "ownCoordinator",
          `${team}/person-else`,
          teamMember,
        ),
        "a team member who does not exist": create("ownCoordinator", `${team}/person-missing`, {
          ...teamMember,
          personId: "person-missing",
        }),
        "a team role that does not exist": create("ownCoordinator", `${team}/${MEMBER_PERSON}`, {
          ...teamMember,
          role: "director",
        }),
        "a team member beneath a participation that does not exist": create(
          "admin",
          `participations/Missing2000__lab-missing/teamMembers/${MEMBER_PERSON}`,
          {
            ...teamMember,
            participationId: "Missing2000__lab-missing",
          },
        ),
        "a deviation reported in another name": create(
          "ownCoordinator",
          `${PARTICIPATION}/deviations/${autoId("deviation-2")}`,
          deviation(OWNER_UID),
        ),
        "a deviation of a severity that does not exist": create(
          "ownCoordinator",
          `${PARTICIPATION}/deviations/${autoId("deviation-2")}`,
          {
            ...deviation(coordinator),
            severity: "catastrophic",
          },
        ),
        "a deviation without a description": create(
          "ownCoordinator",
          `${PARTICIPATION}/deviations/${autoId("deviation-2")}`,
          {
            ...deviation(coordinator),
            description: "",
          },
        ),
        "a change of who reported a deviation": update("ownLead", `${PARTICIPATION}/deviations/deviation-1`, {
          reportedBy: uidOfCaller("ownLead"),
        }),
        "a deviation status that does not exist": update("ownLead", `${PARTICIPATION}/deviations/deviation-1`, {
          status: "closed",
        }),
      }),
      "a team member with the scope of the participation": [
        "allowed",
        create("ownCoordinator", `${team}/${MEMBER_PERSON}`, teamMember),
      ],
      "a deviation reported by the caller": [
        "allowed",
        create("ownLead", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, deviation(uidOfCaller("ownLead"))),
      ],
      // What the lead reported stays the lead's: the laboratory follows up and decides nothing.
      "a milder account of it by the coordinator of the laboratory": [
        "denied",
        update("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, { severity: "major" }),
      ],
      "its resolution by the coordinator of the laboratory": [
        "denied",
        update("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, { status: "resolved" }),
      ],
      "its archive by the coordinator of the laboratory": [
        "denied",
        update("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, {
          archivedAt: serverTimestamp(),
        }),
      ],
      "a corrective action and a review, by the coordinator of the laboratory": [
        "allowed",
        update("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, {
          correctiveAction: "The sessions are recorded again.",
          status: "underReview",
        }),
      ],
      "a corrective action that is no text": [
        "denied",
        update("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, { correctiveAction: 42 }),
      ],
      "its resolution by the lead who reported it": [
        "allowed",
        update("ownLead", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, { status: "resolved" }),
      ],
      "another severity, by the core team": [
        "allowed",
        update("coreTeam", `${PARTICIPATION}/deviations/${autoId("deviation-2")}`, { severity: "critical" }),
      ],
    });
  });

  it("records an acknowledgement as the act of the person concerned, once, and never changes it", async () => {
    const acknowledgements = `${PARTICIPATION}/acknowledgements`;
    // The world holds an approved version of the protocol (version-0) and a draft (version-1),
    // and the person of the account `owner` is on the team of the participation.
    const acknowledgement = (personId: string, fields: Record<string, unknown> = {}) => ({
      ...fieldsOf("participationAcknowledgements"),
      personId,
      protocolVersionId: "version-0",
      acknowledgedAt: serverTimestamp(),
      ...fields,
    });
    const id = acknowledgementId(OWNER_PERSON, "version-0");
    await trusted(environment, (db) =>
      setDoc(doc(db, `${REPLICATION}/protocolVersions/version-draft`), {
        ...(FIXTURES.replicationProtocolVersions?.seed ?? {}),
        versionLabel: "1.1",
      }),
    );
    await expectOutcomes({
      ...refused({
        "an acknowledgement that a coordinator records for the person": create(
          "ownCoordinator",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON),
          true,
        ),
        "an acknowledgement that a lead records for another person": create(
          "ownLead",
          `${acknowledgements}/${acknowledgementId(MEMBER_PERSON, "version-0")}`,
          acknowledgement(MEMBER_PERSON),
          true,
        ),
        "an acknowledgement that an administrator records for the person": create(
          "admin",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON),
          true,
        ),
        "an acknowledgement by a person who is not on the team of the participation": create(
          "member",
          `${acknowledgements}/${acknowledgementId(MEMBER_PERSON, "version-0")}`,
          acknowledgement(MEMBER_PERSON),
          true,
        ),
        "an identifier that names another person": create(
          "owner",
          `${acknowledgements}/${acknowledgementId(MEMBER_PERSON, "version-0")}`,
          acknowledgement(OWNER_PERSON),
          true,
        ),
        "a time in the past": create(
          "owner",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON, { acknowledgedAt: clientTime() }),
          true,
        ),
        "a time in the future": create(
          "owner",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON, { acknowledgedAt: later() }),
          true,
        ),
        "a version of another protocol": create(
          "owner",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON, { protocolId: "protocol-2" }),
          true,
        ),
        "a version that is still a draft": create(
          "owner",
          `${acknowledgements}/${acknowledgementId(OWNER_PERSON, "version-draft")}`,
          acknowledgement(OWNER_PERSON, { protocolVersionId: "version-draft" }),
          true,
        ),
        "a version that does not exist": create(
          "owner",
          `${acknowledgements}/${acknowledgementId(OWNER_PERSON, "version-missing")}`,
          acknowledgement(OWNER_PERSON, { protocolVersionId: "version-missing" }),
          true,
        ),
        "the scope of another unit": create(
          "owner",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON, { laboratoryId: OTHER_LABORATORY }),
          true,
        ),
        "the fields of a document that can be updated": create(
          "owner",
          `${acknowledgements}/${id}`,
          acknowledgement(OWNER_PERSON),
        ),
      }),
      "an acknowledgement by the person, now": [
        "allowed",
        create("owner", `${acknowledgements}/${id}`, acknowledgement(OWNER_PERSON), true),
      ],
      "the same acknowledgement a second time": [
        "denied",
        create("owner", `${acknowledgements}/${id}`, acknowledgement(OWNER_PERSON), true),
      ],
      "a change to it": ["denied", update("admin", `${acknowledgements}/${id}`, { acknowledgedAt: serverTimestamp() })],
      "a change to it by the person": [
        "denied",
        update("owner", `${acknowledgements}/${id}`, { acknowledgedAt: serverTimestamp() }),
      ],
      "its removal": ["denied", remove("admin", `${acknowledgements}/${id}`)],
      "its removal by the person": ["denied", remove("owner", `${acknowledgements}/${id}`)],
    });
  });

  it("opens outreach correspondence that names no replication to the programme alone", async () => {
    await trusted(environment, (db) =>
      setDoc(doc(db, "outreachContacts/contact-unresolved"), {
        ...(FIXTURES.outreachContacts?.seed ?? {}),
        replicationId: null,
        scopeKeys: [],
      }),
    );
    await expectOutcomes({
      "a lead reads the correspondence of the replication": ["allowed", get("ownLead", "outreachContacts/contact-1")],
      "a lead reads correspondence that names no replication": [
        "denied",
        get("ownLead", "outreachContacts/contact-unresolved"),
      ],
      "a coordinator reads it": ["denied", get("ownCoordinator", "outreachContacts/contact-unresolved")],
      "the core team reads it": ["allowed", get("coreTeam", "outreachContacts/contact-unresolved")],
      "a lead corrects the correspondence of the replication": [
        "denied",
        update("ownLead", "outreachContacts/contact-1", { notes: "x" }),
      ],
    });
  });
});

describe("scientific outputs", () => {
  it("start a manuscript as planned, in the scope of its replication, and leave its status to a function", async () => {
    const manuscript = (): Record<string, unknown> => FIXTURES.manuscripts?.create?.data("") ?? {};
    /** An output of the programme as a whole names no replication and carries no scope key. */
    const programmeLevel = {
      ...Object.fromEntries(Object.entries(manuscript()).filter(([field]) => field !== "replicationId")),
      scopeKeys: [],
    };
    await expectOutcomes({
      ...refused({
        "a status other than planned": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          status: "submitted",
        }),
        "a status history from the start": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          statusHistoryId: "history-1",
        }),
        "no scope keys": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, { ...manuscript(), scopeKeys: [] }),
        "the scope keys of another replication": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
        }),
        "scope keys that open it to more": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
        }),
        "a replication that does not exist": create("admin", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          replicationId: "Missing2000",
          scopeKeys: [replicationScopeKey("Missing2000")],
        }),
        "an output of the programme, by a lead": create(
          "ownLead",
          `manuscripts/${autoId("manuscript-2")}`,
          programmeLevel,
        ),
        "a title that is too long": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          title: text(1_001),
        }),
        "a kind that does not exist": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          kind: "poster",
        }),
        "a repository address that is none": create("ownLead", `manuscripts/${autoId("manuscript-2")}`, {
          ...manuscript(),
          osfUrl: "osf.io/abcde",
        }),
        "the status of a manuscript, by a lead": update("ownLead", "manuscripts/manuscript-1", { status: "submitted" }),
        "the status of a manuscript, by an administrator": update("admin", "manuscripts/manuscript-1", {
          status: "submitted",
        }),
        "the replication of a manuscript": update("admin", "manuscripts/manuscript-1", {
          replicationId: OTHER_REPLICATION,
        }),
        "a removal": remove("admin", "manuscripts/manuscript-1"),
      }),
      "an output of the programme, by the core team": [
        "allowed",
        create("coreTeam", `manuscripts/${autoId("manuscript-programme")}`, programmeLevel),
      ],
      "an edit of it by a lead": [
        "denied",
        update("ownLead", `manuscripts/${autoId("manuscript-programme")}`, { journal: "Forged" }),
      ],
      "an edit of it by an administrator": [
        "allowed",
        update("admin", `manuscripts/${autoId("manuscript-programme")}`, { journal: "Journal of Synthetic Results" }),
      ],
    });
  });

  it("give an event, a contributor and a table the scope of what they belong to", async () => {
    const event = () => FIXTURES.manuscriptEvents?.create?.data("") ?? {};
    const contributor = () => FIXTURES.contributors?.create?.data("") ?? {};
    const table = () => FIXTURES.contributorTables?.create?.data("") ?? {};
    const events = "manuscripts/manuscript-1/events";
    // A contributor table and a manuscript of the other replication, and a table of the programme.
    await trusted(environment, async (db) => {
      await setDoc(doc(db, "contributorTables/table-other"), {
        ...(FIXTURES.contributorTables?.seed ?? {}),
        replicationId: OTHER_REPLICATION,
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
      });
      await setDoc(doc(db, "contributorTables/table-programme"), {
        ...(FIXTURES.contributorTables?.seed ?? {}),
        replicationId: null,
        scopeKeys: [],
      });
      await setDoc(doc(db, "manuscripts/manuscript-other"), {
        ...(FIXTURES.manuscripts?.seed ?? {}),
        replicationId: OTHER_REPLICATION,
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
      });
    });
    await expectOutcomes({
      ...refused({
        "an event with the replication of another manuscript": create("ownLead", `${events}/${autoId("event-2")}`, {
          ...event(),
          replicationId: OTHER_REPLICATION,
        }),
        "an event with scope keys of its own": create("ownLead", `${events}/${autoId("event-2")}`, {
          ...event(),
          scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
        }),
        "an event with a laboratory": create("ownLead", `${events}/${autoId("event-2")}`, {
          ...event(),
          laboratoryId: OWN_LABORATORY,
        }),
        "an event that names another manuscript": create("ownLead", `${events}/${autoId("event-2")}`, {
          ...event(),
          manuscriptId: "manuscript-9",
        }),
        "an event of a kind that does not exist": create("ownLead", `${events}/${autoId("event-2")}`, {
          ...event(),
          kind: "celebration",
        }),
        "an event beneath a manuscript that does not exist": create(
          "admin",
          `manuscripts/manuscript-missing/events/${autoId("event-1")}`,
          {
            ...event(),
            manuscriptId: "manuscript-missing",
          },
        ),
        "a removal of an event": remove("ownLead", `${events}/event-1`),
        "a contributor of a table that does not exist": create("ownLead", `contributors/${autoId("contributor-3")}`, {
          ...contributor(),
          contributorTableId: "table-missing",
        }),
        "a contributor with a review status that does not exist": create(
          "ownLead",
          `contributors/${autoId("contributor-3")}`,
          {
            ...contributor(),
            reviewStatus: "approved",
          },
        ),
        "a contributor with the scope keys of another replication": create(
          "ownLead",
          `contributors/${autoId("contributor-3")}`,
          {
            ...contributor(),
            scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
          },
        ),
        "a contributor of the programme, by a lead": create("ownLead", `contributors/${autoId("contributor-3")}`, {
          ...contributor(),
          replicationId: null,
          scopeKeys: [],
        }),
        "a table with a publication address that is none": create("ownLead", `contributorTables/${autoId("table-2")}`, {
          ...table(),
          publicationUrl: "x",
        }),
        "a table with scope keys that open it to every member": create(
          "ownLead",
          `contributorTables/${autoId("table-2")}`,
          {
            ...table(),
            scopeKeys: [REPLICATION_KEY, MEMBERS_SCOPE_KEY],
          },
        ),
        // Every member reads the rows, so a row stays within its replication.
        "a contributor in the table of another replication": create(
          "ownLead",
          `contributors/${autoId("contributor-3")}`,
          { ...contributor(), contributorTableId: "table-other" },
        ),
        "a contributor on the manuscript of another replication": create(
          "ownLead",
          `contributors/${autoId("contributor-3")}`,
          { ...contributor(), manuscriptId: "manuscript-other" },
        ),
        "a contributor who is a person that does not exist": create(
          "ownLead",
          `contributors/${autoId("contributor-3")}`,
          { ...contributor(), personId: "person-missing" },
        ),
        "a move of a contributor into the table of another replication": update(
          "ownLead",
          "contributors/contributor-1",
          { contributorTableId: "table-other" },
        ),
        "a move of a contributor onto the manuscript of another replication": update(
          "ownLead",
          "contributors/contributor-1",
          { manuscriptId: "manuscript-other" },
        ),
        "a contributor of the programme in the table of a replication": create(
          "admin",
          `contributors/${autoId("contributor-3")}`,
          { ...contributor(), replicationId: null, scopeKeys: [] },
        ),
        "a role that is none of the fourteen": update("ownLead", "contributors/contributor-1", {
          creditRoles: { applause: true },
        }),
        "an affiliation slot beyond the ninth": update("ownLead", "contributors/contributor-1", {
          affiliationSlotsSource: { "10": "Synthetic University" },
        }),
        "an affiliation cell that is no text": update("ownLead", "contributors/contributor-1", {
          affiliationSlotsSource: { "1": 42 },
        }),
        "a contact detail that is too long": update("ownLead", "contributors/contributor-1/private/contact", {
          email: text(10_001),
        }),
        "a read of a contact detail by an ordinary member": get("member", "contributors/contributor-1/private/contact"),
      }),
      "a read of a contact detail by a team member of the replication": [
        "allowed",
        get("ownTeam", "contributors/contributor-1/private/contact"),
      ],
      "a contributor on the manuscript of the same replication, with its cells as the sheet gave them": [
        "allowed",
        update("ownLead", "contributors/contributor-1", {
          manuscriptId: "manuscript-1",
          affiliationSlotsSource: { "1": "Synthetic University", "2": "" },
          creditRoles: { investigation: true, software: "x", validation: 1 },
        }),
      ],
      "a contributor of the programme in a table of the programme, by an administrator": [
        "allowed",
        create("admin", `contributors/${autoId("contributor-3")}`, {
          ...contributor(),
          replicationId: null,
          contributorTableId: "table-programme",
          scopeKeys: [],
        }),
      ],
    });
  });

  it("copy the audience of the target onto a document link, and fix it there", async () => {
    const link = (fields: Record<string, unknown> = {}) => ({
      ...(FIXTURES.documentLinks?.create?.data("") ?? {}),
      ...fields,
    });
    /** A new link, under an identifier that Firestore could have generated. */
    const at = (name: string) => `documentLinks/${autoId(name)}`;
    const stored1 = "documentLinks/link-1";
    const withMembers = (keys: string[]) => [...keys, MEMBERS_SCOPE_KEY];
    const hypothesis = { entityType: "hypothesis", entityId: `${OWN_REPLICATION}__h01` };
    await expectOutcomes({
      ...refused({
        "an open link without the members key": create("ownLead", at("a"), link({ scopeKeys: [REPLICATION_KEY] })),
        "a restricted link with the members key": create("ownLead", at("a"), link({ restricted: true })),
        "a link whose replication is not its target": create("ownLead", at("a"), link({ entityId: OTHER_REPLICATION })),
        "a link to a replication that also names a laboratory": create(
          "ownLead",
          at("a"),
          link({ laboratoryId: OWN_LABORATORY }),
        ),
        "a link with the scope keys of another replication": create(
          "ownLead",
          at("a"),
          link({ scopeKeys: withMembers([replicationScopeKey(OTHER_REPLICATION)]) }),
        ),
        "a link that says it was checked": create("ownLead", at("a"), link({ lastCheckedAt: serverTimestamp() })),
        "a script as the address": create("ownLead", at("a"), link({ url: "javascript:alert(1)" })),
        "a kind that does not exist": create("ownLead", at("a"), link({ kind: "video" })),
        "an access status that does not exist": create("ownLead", at("a"), link({ accessStatus: "secret" })),
        "a restricted flag that is no boolean": create("ownLead", at("a"), link({ restricted: "no" })),
        "a link to a person, which trusted code writes": create(
          "admin",
          at("a"),
          link({ entityType: "person", entityId: OWNER_PERSON }),
        ),
        "a link to a hypothesis that does not exist": create(
          "ownLead",
          at("a"),
          link({ entityType: "hypothesis", entityId: `${OWN_REPLICATION}__h09` }),
        ),
        "a link to a hypothesis of another replication": create(
          "ownLead",
          at("a"),
          link({ entityType: "hypothesis", entityId: `${OTHER_REPLICATION}__h01` }),
        ),
        "a link to a replication, by a coordinator": create("ownCoordinator", at("a"), link()),
        "a link to a replication, by a lead of another": create("otherLead", at("a"), link()),
        "a link to a participation with the scope of the replication alone": create(
          "ownCoordinator",
          at("a"),
          link({ entityType: "participation", entityId: OWN_PARTICIPATION }),
        ),
        "a link to a laboratory, by a lead": create(
          "ownLead",
          at("a"),
          link({
            entityType: "laboratory",
            entityId: OWN_LABORATORY,
            replicationId: null,
            laboratoryId: OWN_LABORATORY,
            scopeKeys: withMembers([LABORATORY_KEY]),
          }),
        ),
        "a move of a link to another record": update("ownLead", stored1, { entityId: OTHER_REPLICATION }),
        "a link turned restricted": update("ownLead", stored1, { restricted: true }),
        "a script as the new address": update("ownLead", stored1, { url: "javascript:alert(1)" }),
        "a removal": remove("ownLead", stored1),
      }),
      "a restricted link to the replication": [
        "allowed",
        create("ownLead", at("restricted"), link({ restricted: true, scopeKeys: [REPLICATION_KEY] })),
      ],
      "a read of it by an ordinary member": ["denied", get("member", at("restricted"))],
      "a read of it by a team member of the replication": ["allowed", get("ownTeam", at("restricted"))],
      "a read of an open link by an ordinary member": ["allowed", get("member", stored1)],
      "a link to a hypothesis": ["allowed", create("ownLead", at("hypothesis"), link(hypothesis))],
      "a link to a protocol version": [
        "allowed",
        create(
          "coreTeam",
          at("version"),
          link({ entityType: "protocolVersion", entityId: `${OWN_REPLICATION}__version-1` }),
        ),
      ],
      "a link to a manuscript": [
        "allowed",
        create("ownLead", at("manuscript"), link({ entityType: "manuscript", entityId: "manuscript-1" })),
      ],
      "a link to a participation, by a coordinator": [
        "allowed",
        create(
          "ownCoordinator",
          at("participation"),
          link({
            entityType: "participation",
            entityId: OWN_PARTICIPATION,
            laboratoryId: OWN_LABORATORY,
            scopeKeys: withMembers([REPLICATION_KEY, LABORATORY_KEY]),
          }),
        ),
      ],
      "a restricted link to a laboratory, by a coordinator": [
        "allowed",
        create(
          "ownCoordinator",
          at("laboratory"),
          link({
            entityType: "laboratory",
            entityId: OWN_LABORATORY,
            replicationId: null,
            laboratoryId: OWN_LABORATORY,
            restricted: true,
            scopeKeys: [LABORATORY_KEY],
          }),
        ),
      ],
      "an edit of the laboratory's link by a lead": [
        "denied",
        update("ownLead", at("laboratory"), { title: "Forged" }),
      ],
      "an edit of it by the coordinator": [
        "allowed",
        update("ownCoordinator", at("laboratory"), { title: "Ethics letter" }),
      ],
      // Whether an address answers is the result of a check that trusted code makes.
      "the result of a link check, by the coordinator": [
        "denied",
        update("ownCoordinator", at("laboratory"), { accessStatus: "restricted" }),
      ],
      "the result of a link check, by an administrator": [
        "denied",
        update("admin", stored1, { accessStatus: "public", httpStatus: 200, lastCheckedAt: serverTimestamp() }),
      ],
      "the owner that a link check found, by a lead": ["denied", update("ownLead", stored1, { ownerName: "Forged" })],
      "a link under an identifier that an import derives": [
        "denied",
        createAt("ownLead", `documentLinks/replication__${OWN_REPLICATION}__signup`, link()),
      ],
    });
  });

  it("give the account of an external system the audience of its owner", async () => {
    await trusted(environment, (db) =>
      setDoc(doc(db, "persons/person-unclaimed"), {
        ...(FIXTURES.persons?.seed ?? {}),
        slug: "synthetic-unclaimed",
        userId: null,
        claimedAt: null,
      }),
    );
    const account = (ownerType: string, ownerId: string, scopeKeys: string[]) => ({
      ownerType,
      ownerId,
      system: "sftp",
      accountName: "synthetic-account",
      scopeKeys,
    });
    /** A new account, under an identifier that Firestore could have generated. */
    const at = (name: string) => `externalAccounts/${autoId(name)}`;
    const stored1 = "externalAccounts/account-1";
    await expectOutcomes({
      ...refused({
        "an account of a replication, by a coordinator": create(
          "ownCoordinator",
          at("a"),
          account("replication", OWN_REPLICATION, [REPLICATION_KEY]),
        ),
        "an account of a laboratory with the keys of the replication": create(
          "ownCoordinator",
          at("a"),
          account("laboratory", OWN_LABORATORY, [REPLICATION_KEY]),
        ),
        "an account of a laboratory open to every member": create(
          "ownCoordinator",
          at("a"),
          account("laboratory", OWN_LABORATORY, [LABORATORY_KEY, MEMBERS_SCOPE_KEY]),
        ),
        "an account of a laboratory that does not exist": create(
          "admin",
          at("a"),
          account("laboratory", "lab-missing", [laboratoryScopeKey("lab-missing")]),
        ),
        "an account of another laboratory": create(
          "ownCoordinator",
          at("a"),
          account("laboratory", OTHER_LABORATORY, [laboratoryScopeKey(OTHER_LABORATORY)]),
        ),
        "an account of a group, by a lead": create(
          "ownLead",
          at("a"),
          account("group", "synthetic-working-group", ["group:synthetic-working-group"]),
        ),
        "an account of a group that does not exist": create(
          "admin",
          at("a"),
          account("group", "group-missing", ["group:group-missing"]),
        ),
        "an account of a person, by the person": create(
          "owner",
          at("a"),
          account("person", OWNER_PERSON, [userScopeKey(OWNER_UID)]),
        ),
        "an account of a person with the key of another login": create(
          "admin",
          at("a"),
          account("person", OWNER_PERSON, [userScopeKey(MEMBER_UID)]),
        ),
        "an account of an unclaimed person with a key": create(
          "admin",
          at("a"),
          account("person", "person-unclaimed", [userScopeKey(OWNER_UID)]),
        ),
        "an account in a system that does not exist": create("ownCoordinator", at("a"), {
          ...account("laboratory", OWN_LABORATORY, [LABORATORY_KEY]),
          system: "carrier-pigeon",
        }),
        "a move of an account to another owner": update("ownLead", stored1, { ownerId: OTHER_REPLICATION }),
        "a change of the kind of owner": update("admin", stored1, { ownerType: "group" }),
        "a removal": remove("admin", stored1),
      }),
      "an account of a laboratory, by its coordinator": [
        "allowed",
        create("ownCoordinator", at("laboratory"), account("laboratory", OWN_LABORATORY, [LABORATORY_KEY])),
      ],
      "a read of it by a member of the laboratory": ["allowed", get("ownLabMember", at("laboratory"))],
      "a read of it by a lead": ["denied", get("ownLead", at("laboratory"))],
      "an account of a group, by the core team": [
        "allowed",
        create("coreTeam", at("group"), account("group", "synthetic-working-group", ["group:synthetic-working-group"])),
      ],
      "an account of a claimed person, by an administrator": [
        "allowed",
        create("admin", at("person"), account("person", OWNER_PERSON, [userScopeKey(OWNER_UID)])),
      ],
      "a read of it by the person": ["allowed", get("owner", at("person"))],
      "a read of it by another member": ["denied", get("member", at("person"))],
      "an account of an unclaimed person, which only the programme reads": [
        "allowed",
        create("admin", at("unclaimed"), account("person", "person-unclaimed", [])),
      ],
      "a read of it by a member": ["denied", get("member", at("unclaimed"))],
    });
  });
});
