// Red-team attacks on the shape of what a client may write: a wrong type, a text far beyond its
// cap, a map nested deep, a negative or fractional number where a count belongs, a key that
// breaks a field path. The data model says that the rules enforce the caps of the shared
// schemas, and every member's browser parses what it reads against those schemas, so one
// malformed document in a collection that members read breaks the view of everyone who lists it.
//
// Every test states the secure behaviour: the request is refused. A test that fails has found a
// write that the rules accept and the schema of the collection does not.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { describe, it } from "vitest";
import {
  autoId,
  MEMBER_PERSON,
  MEMBER_UID,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
} from "../world";
import { arena, LABORATORY, nested, PARTICIPATION, REPLICATION, text } from "./integrity-and-audit-support";

const lab = arena("validation");

type Attacks = Readonly<Record<string, () => Promise<unknown>>>;

/** One test for each attack, each of which must be refused. */
function refuses(attacks: Attacks): void {
  it.each(Object.entries(attacks))("refuses %s", async (_label, attack) => {
    await assertFails(attack());
  });
}

/** Far beyond every cap of the schemas, and still within the size that Firestore accepts. */
const HUGE = 900_000;

describe("an ordinary member, on the affiliations of their own person, which every member reads", () => {
  const path = `persons/${MEMBER_PERSON}/affiliations/${autoId("red-team")}`;
  const affiliation = { personId: MEMBER_PERSON, affiliationSource: "Example Institute", isPrimary: false };
  const create = (fields: Record<string, unknown>) => () => lab.create("member", path, { ...affiliation, ...fields });

  it("is allowed the well-formed affiliation that the attacks distort", async () => {
    await assertSucceeds(create({ roleTitle: "Researcher", startDate: "2024-01-01" })());
  });

  refuses({
    "a verbatim affiliation of 900,000 characters": create({ affiliationSource: text(HUGE) }),
    "a verbatim affiliation that is a number": create({ affiliationSource: 42 }),
    "a role title of 900,000 characters": create({ roleTitle: text(HUGE) }),
    "a role title that is a map nested fifteen deep": create({ roleTitle: nested(15) }),
    "a start date that is no date": create({ startDate: "the day before yesterday" }),
    "an end date that is a number": create({ endDate: 20_260_101 }),
    "a primary flag that is no boolean": create({ isPrimary: "yes" }),
    "a key that the schema does not name": create({ unexpectedKey: true }),
  });

  it("refuses the same distortions on an affiliation that exists", async () => {
    await assertSucceeds(create({})());
    await assertFails(lab.update("member", path, { roleTitle: text(HUGE) }));
  });
});

describe("an ordinary member, on their own notification preferences", () => {
  const path = `users/${MEMBER_UID}/settings/preferences`;
  const preferences = {
    channels: { inApp: true, email: true },
    digestFrequency: "daily",
    quietHours: null,
    typeSwitches: { mention: true },
  };
  const create = (fields: Record<string, unknown>) => () => lab.create("member", path, { ...preferences, ...fields });

  it("is allowed the well-formed preferences that the attacks distort", async () => {
    await assertSucceeds(create({})());
  });

  refuses({
    "a switch that holds 900,000 characters in place of a boolean": create({ typeSwitches: { mention: text(HUGE) } }),
    "a switch that holds a map nested fifteen deep": create({ typeSwitches: { mention: nested(15) } }),
    "a switch for a type of notification that does not exist": create({ typeSwitches: { gossip: true } }),
    "a channel that is no boolean": create({ channels: { inApp: "yes", email: true } }),
    "a third channel": create({ channels: { inApp: true, email: true, carrierPigeon: true } }),
    "a digest frequency that does not exist": create({ digestFrequency: "hourly" }),
    "quiet hours that start at no time of day": create({
      quietHours: { start: "25:00", end: "07:00", timeZone: "Europe/London" },
    }),
  });
});

describe("an ordinary member, on a correction request, which must never carry special-category data", () => {
  const request =
    (fields: Record<string, unknown>, id = "request-red-team") =>
    () =>
      lab.create("member", `correctionRequests/${autoId(id)}`, {
        uid: MEMBER_UID,
        entityType: "person",
        entityId: MEMBER_PERSON,
        field: "displayName",
        proposedValue: "Synthetic Member-Example",
        status: "open",
        resolvedBy: null,
        resolvedAt: null,
        ...fields,
      });

  it("is allowed the well-formed request that the attacks distort", async () => {
    await assertSucceeds(request({ message: "My name changed." })());
  });

  refuses({
    "a request about the field genderSource": request({ field: "genderSource", proposedValue: "a synthetic value" }),
    "a request about the field ethnicitySelfDescribed": request({
      field: "ethnicitySelfDescribed",
      proposedValue: "a synthetic value",
    }),
    "a request about gender under a capital letter": request({
      field: "GenderSource",
      proposedValue: "a synthetic value",
    }),
    "a request about gender with a trailing space": request({
      field: "genderSource ",
      proposedValue: "a synthetic value",
    }),
    "a request about the field gender": request({ field: "gender", proposedValue: "a synthetic value" }),
    "a request about the field ethnicity": request({ field: "ethnicity", proposedValue: "a synthetic value" }),
    "a proposed value of 10,001 characters": request({ proposedValue: text(10_001) }),
    "a proposed value that is a map": request({ proposedValue: { nested: true } }),
    "a proposed value that is a list": request({ proposedValue: ["a", "b"] }),
    "a message of 10,001 characters": request({ message: text(10_001) }),
    "a field with a full stop, which is a path into the record": request({ field: "custom.gender" }),
    "a kind of record that does not exist": request({ entityType: "spaceship" }),
    "a request that is resolved already": request({ status: "accepted", resolvedBy: MEMBER_UID }),
  });
});

describe("a member of laboratory A, on a checklist item of that laboratory", () => {
  const path = `${PARTICIPATION}/checklist/ethics`;
  const update = (patch: Record<string, unknown>) => () => lab.update("ownLabMember", path, patch);

  it("is allowed the well-formed change that the attacks distort", async () => {
    await assertSucceeds(update({ status: "inProgress", note: "The application has been sent." })());
  });

  refuses({
    "a note of 10,001 characters": update({ note: text(10_001) }),
    "a note that is a number": update({ note: 5 }),
    "a status that does not exist": update({ status: "abandoned" }),
    "evidence at an address that is no web address": update({ evidenceUrl: "javascript:alert(1)" }),
    "evidence at an address of 2,049 characters": update({ evidenceUrl: `https://example.org/${text(2_030)}` }),
    "another label": update({ label: "Ethics waived" }),
    "another position": update({ position: 1 }),
    "an archive of the item": update({ archivedAt: new Date() }),
    "a key that the schema does not name": update({ unexpectedKey: true }),
  });
});

describe("a coordinator of laboratory A, on the profile of that laboratory", () => {
  const update = (patch: Record<string, unknown>) => () => lab.update("ownCoordinator", LABORATORY, patch);

  it("is allowed the well-formed change that the attacks distort", async () => {
    await assertSucceeds(update({ city: "Example Town", custom: { boothCount: 2 } })());
  });

  refuses({
    "a name of 301 characters": update({ name: text(301) }),
    "a status that does not exist": update({ status: "accredited" }),
    "a country code in lower case": update({ countryCode: "gb" }),
    "a website that is no web address": update({ website: "javascript:alert(1)" }),
    "a description of 10,001 characters": update({ description: text(10_001) }),
    "custom values that are no map": update({ custom: "none" }),
    // The schema leaves the values of custom properties open as well, so this one is a gap in both.
    "a custom value of 900,000 characters, on a profile that every member lists": update({
      custom: { boothCount: text(HUGE) },
    }),
    "a custom value under a key with a full stop": update({ custom: { "booth.count": 2 } }),
  });
});

describe("a coordinator of laboratory A, on a member entry of that laboratory, which every member reads", () => {
  const path = `${LABORATORY}/members/${MEMBER_PERSON}`;
  const entry = {
    laboratoryId: OWN_LABORATORY,
    personId: MEMBER_PERSON,
    role: "member",
    isAuthorisedRepresentative: false,
    earlierPeriods: [],
    status: "proposed",
  };
  const create = (fields: Record<string, unknown>) => () => lab.create("ownCoordinator", path, { ...entry, ...fields });

  it("is allowed the well-formed entry that the attacks distort", async () => {
    await assertSucceeds(create({ startDate: "2024-01-01" })());
  });

  refuses({
    "a start date that is a number": create({ startDate: 20_240_101 }),
    "an end date of 900,000 characters": create({ endDate: text(HUGE) }),
    "an earlier period that is a number": create({ earlierPeriods: [42] }),
    "an earlier period that holds 900,000 characters": create({ earlierPeriods: [{ startDate: text(HUGE) }] }),
    "fifty-one earlier periods": create({
      earlierPeriods: Array.from({ length: 51 }, () => ({ startDate: "2020-01-01", endDate: "2020-12-31" })),
    }),
    "a role that does not exist": create({ role: "owner" }),
    "a flag that is no boolean": create({ isAuthorisedRepresentative: "yes" }),
  });
});

describe("a coordinator of laboratory A, on the participation of that laboratory", () => {
  const update = (patch: Record<string, unknown>) => () => lab.update("ownCoordinator", PARTICIPATION, patch);
  const detail = (patch: Record<string, unknown>) => () =>
    lab.update("ownCoordinator", `${PARTICIPATION}/private/detail`, patch);
  const deviation = (patch: Record<string, unknown>) => () =>
    lab.update("ownCoordinator", `${PARTICIPATION}/deviations/deviation-1`, patch);

  it("is allowed the well-formed changes that the attacks distort", async () => {
    await assertSucceeds(update({ targetNMain: 48, custom: { room: "B12" } })());
    await assertSucceeds(detail({ ethicsReference: "SYN-2026-001", ethicsStatus: "approved" })());
    await assertSucceeds(deviation({ correctiveAction: "The block order is now checked before a session." })());
  });

  refuses({
    "a negative target": update({ targetNMain: -1 }),
    "a fractional target": update({ targetNMain: 12.5 }),
    "a target of a thousand million": update({ targetNRest: 1_000_000_000 }),
    "a target that is text": update({ targetNMain: "40" }),
    "a readiness status that does not exist": update({ readinessStatus: "certified" }),
    "a sign-up time that is text": update({ signedUpAt: "last spring" }),
    "an ethics reference of 900,000 characters in the private detail": detail({ ethicsReference: text(HUGE) }),
    "an ethics reference that is a map in the private detail": detail({ ethicsReference: nested(15) }),
    "a time of ethics approval that is text in the private detail": detail({ ethicsApprovedAt: "yesterday" }),
    "a justification that is a number in the private detail": detail({ equipmentOverrideJustification: 42 }),
    "an ethics status that does not exist in the private detail": detail({ ethicsStatus: "waived" }),
    "notes of 10,001 characters in the private detail": detail({ notes: text(10_001) }),
    "a corrective action of 900,000 characters on a deviation": deviation({ correctiveAction: text(HUGE) }),
    "a corrective action that is a number on a deviation": deviation({ correctiveAction: 42 }),
    "a severity that does not exist on a deviation": deviation({ severity: "trivial" }),
    "a description of 10,001 characters on a deviation": deviation({ description: text(10_001) }),
  });
});

describe("a lead of replication X, on the replication, which every member reads", () => {
  const update = (patch: Record<string, unknown>) => () => lab.update("ownLead", REPLICATION, patch);

  it("is allowed the well-formed change that the attacks distort", async () => {
    // The stage that the public sees is no part of this change: it is a decision of the
    // programme, which trusted code records (see the tests of sign-off).
    await assertSucceeds(update({ targetN: 400, minEegChannels: 32, originalYear: 2001, signupActive: true })());
  });

  refuses({
    "a negative target sample": update({ targetN: -5 }),
    "a fractional target sample": update({ targetN: 12.5 }),
    "a negative original sample": update({ originalN: -1 }),
    "a fractional power-based sample": update({ powerBasedN: 0.5 }),
    "a negative number of channels": update({ minEegChannels: -64 }),
    "a year of publication that is text": update({ originalYear: "next year" }),
    "a negative public stage": update({ publicStageNumber: -3 }),
    "a fractional public stage": update({ publicStageNumber: 2.5 }),
    "a sign-up flag that is no boolean": update({ signupActive: "yes" }),
    "a short title of 900,000 characters": update({ shortTitle: text(HUGE) }),
    "a short title that is a number": update({ shortTitle: 2001 }),
    "a text for the public stage of 900,000 characters": update({ publicStageText: text(HUGE) }),
    "an abstract of 900,000 characters": update({ abstract: text(HUGE) }),
    "citation metadata that is no map": update({ citationMetadata: "none" }),
    "a vocabulary link that is a number": update({ vocabulary: [42] }),
    "a citation status that does not exist": update({ citationStatus: "trustMe" }),
    "a sign-up address that is no web address": update({ signupUrl: "javascript:alert(1)" }),
    "custom values that are no map": update({ custom: [] }),
  });
});

describe("a lead of replication X, on what sits beneath the replication, which every member reads", () => {
  const update = (path: string, patch: Record<string, unknown>) => () =>
    lab.update("ownLead", `${REPLICATION}/${path}`, patch);
  const requirement = (key: string, fields: Record<string, unknown>) => () =>
    lab.create("ownLead", `${REPLICATION}/equipmentRequirements/${key}`, {
      replicationId: OWN_REPLICATION,
      requirementKey: key,
      operator: "present",
      isMandatory: false,
      ...fields,
    });
  const membership = `memberships/${OWNER_PERSON}__member`;

  it("is allowed the well-formed changes that the attacks distort", async () => {
    await assertSucceeds(update("protocols/protocol-1", { description: "The protocol of a synthetic study." })());
    await assertSucceeds(update("protocolVersions/version-1", { effectiveDate: "2026-02-01" })());
    await assertSucceeds(requirement("eye-tracker", { note: "Any model." })());
    await assertSucceeds(update(membership, { endDate: "2026-03-31" })());
    await assertSucceeds(update("hypotheses/h01", { expectedEffect: "A medium effect." })());
  });

  refuses({
    "a protocol description of 900,000 characters": update("protocols/protocol-1", { description: text(HUGE) }),
    "a protocol description that is a number": update("protocols/protocol-1", { description: 42 }),
    "a protocol title of 301 characters": update("protocols/protocol-1", { title: text(301) }),
    "a current version of a protocol that is a number": update("protocols/protocol-1", { currentVersionId: 42 }),
    "an effective date of a version that is a number": update("protocolVersions/version-1", { effectiveDate: 1 }),
    "a change summary of a version of 900,000 characters": update("protocolVersions/version-1", {
      changeSummary: text(HUGE),
    }),
    "a version status that does not exist": update("protocolVersions/version-1", { status: "blessed" }),
    "a requirement whose note has 900,000 characters": requirement("eye-tracker", { note: text(HUGE) }),
    "a requirement whose value is a map nested fifteen deep": requirement("eye-tracker", { value: nested(15) }),
    "a requirement whose key holds a full stop and spaces": requirement("eye tracker.model", {}),
    "a requirement whose operator does not exist": requirement("eye-tracker", { operator: "roughly" }),
    "a start date of a membership that is a number": update(membership, { startDate: 20_240_101 }),
    "an earlier period of a membership that is a number": update(membership, { earlierPeriods: [42] }),
    "a hypothesis text beyond 100 KiB": update("hypotheses/h01", { text: text(102_401) }),
    "a hypothesis text of 102,400 characters that takes 300 KiB, where the cap is 100 KiB": update("hypotheses/h01", {
      text: "\u20AC".repeat(102_400),
    }),
    "an expected effect of 10,001 characters": update("hypotheses/h01", { expectedEffect: text(10_001) }),
    "a preregistration at an address that is no web address": update("hypotheses/h01", {
      preregistrationUrl: "javascript:alert(1)",
    }),
  });
});

describe("a lead of replication X, on the scientific outputs of the replication", () => {
  const update = (path: string, patch: Record<string, unknown>) => () => lab.update("ownLead", path, patch);

  it("is allowed the well-formed changes that the attacks distort", async () => {
    await assertSucceeds(update("manuscripts/manuscript-1", { journal: "Journal of Synthetic Results" })());
    await assertSucceeds(update("manuscripts/manuscript-1/events/event-1", { round: 1, summary: "Submitted." })());
    await assertSucceeds(update("contributorTables/table-1", { isPublished: true })());
    await assertSucceeds(update("contributors/contributor-1", { orderInPublication: 3 })());
    await assertSucceeds(update("contributors/contributor-1/private/contact", { fundingStatement: "None." })());
    await assertSucceeds(update("documentLinks/link-1", { title: "Synthetic project" })());
  });

  refuses({
    "a journal of 900,000 characters on a manuscript": update("manuscripts/manuscript-1", { journal: text(HUGE) }),
    "a citation status that does not exist on a manuscript": update("manuscripts/manuscript-1", {
      citationStatus: "trustMe",
    }),
    "a time of submission that is text on a manuscript": update("manuscripts/manuscript-1", { submittedAt: "soon" }),
    "a DOI that is a number on a manuscript": update("manuscripts/manuscript-1", { doi: 10.1 }),
    "a title of 1,001 characters on a manuscript": update("manuscripts/manuscript-1", { title: text(1_001) }),
    "a kind that does not exist on a manuscript": update("manuscripts/manuscript-1", { kind: "blogPost" }),
    "a negative round on a manuscript event": update("manuscripts/manuscript-1/events/event-1", { round: -1 }),
    "a fractional round on a manuscript event": update("manuscripts/manuscript-1/events/event-1", { round: 1.5 }),
    "a summary of 900,000 characters on a manuscript event": update("manuscripts/manuscript-1/events/event-1", {
      summary: text(HUGE),
    }),
    "a published flag that is no boolean on a contributor table": update("contributorTables/table-1", {
      isPublished: "yes",
    }),
    "a source key that is a number on a contributor table": update("contributorTables/table-1", { sourceKey: 42 }),
    "a negative position on a contributor": update("contributors/contributor-1", { orderInPublication: -1 }),
    "a fractional position on a contributor": update("contributors/contributor-1", { orderInPublication: 2.5 }),
    "a surname of 900,000 characters on a contributor": update("contributors/contributor-1", {
      surnameSource: text(HUGE),
    }),
    "a CRediT role that holds 900,000 characters on a contributor": update("contributors/contributor-1", {
      creditRoles: { investigation: text(HUGE) },
    }),
    "fifteen CRediT roles on a contributor": update("contributors/contributor-1", {
      creditRoles: Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`role${index}`, true])),
    }),
    "an email address of 10,001 characters on the contact of a contributor": update(
      "contributors/contributor-1/private/contact",
      { email: text(10_001) },
    ),
    "a title of 900,000 characters on a document link": update("documentLinks/link-1", { title: text(HUGE) }),
    "an HTTP status that is text on a document link": update("documentLinks/link-1", { httpStatus: "fine" }),
    "an address that is no web address on a document link": update("documentLinks/link-1", {
      url: "javascript:alert(1)",
    }),
  });
});

describe("the core team, on the directory record of a person, which every member reads", () => {
  const update = (patch: Record<string, unknown>) => () => lab.update("coreTeam", `persons/${OWNER_PERSON}`, patch);

  it("is allowed the well-formed change that the attacks distort", async () => {
    await assertSucceeds(update({ displayName: "Synthetic Owner-Example", countryCode: "GB" })());
  });

  refuses({
    "a display name that is a number": update({ displayName: 12_345 }),
    "a display name of 900,000 characters": update({ displayName: text(HUGE) }),
    "a given name that is a map nested fifteen deep": update({ givenName: nested(15) }),
    "a core-team flag that is no boolean": update({ isCoreTeam: "yes" }),
    "a public listing that does not exist": update({ publicListing: "frontPage" }),
    "core roles that are no list": update({ coreRoles: 42 }),
    "a country code that is none": update({ countryCode: "not a country" }),
    "custom values that are no map": update({ custom: "none" }),
    "an ORCID iD that is none": update({ orcid: "not-an-orcid" }),
    "a profile address that is no web address": update({ scholarUrl: "javascript:alert(1)" }),
  });
});

describe("the core team, on the lookup collections, which every member reads", () => {
  const update = (path: string, patch: Record<string, unknown>) => () => lab.update("coreTeam", path, patch);
  const category = (key: string, fields: Record<string, unknown>) => () =>
    lab.create("coreTeam", `countCategories/${key}`, {
      key,
      label: "Synthetic category",
      definition: "A category that exists only in tests.",
      position: 50,
      isCore: false,
      ...fields,
    });
  const definition = (key: string, fields: Record<string, unknown>) => () =>
    lab.create("coreTeam", `statusDefinitions/replication__${key}`, {
      entityType: "replication",
      key,
      label: "Synthetic status",
      category: "active",
      position: 20,
      isDefault: false,
      ...fields,
    });

  it("is allowed the well-formed changes that the attacks distort", async () => {
    await assertSucceeds(update("institutions/institution-1", { city: "Example Town" })());
    await assertSucceeds(update("vocabularyTerms/term-1", { description: "A term that exists only in tests." })());
    await assertSucceeds(update("candidateStudies/candidate-1", { originalYear: 2004 })());
    await assertSucceeds(update("checklistTemplates/onboarding", { items: [{ key: "ethics", label: "Ethics" }] })());
    await assertSucceeds(category("synthetic-category", {})());
    await assertSucceeds(definition("synthetic-status", {})());
  });

  refuses({
    "a website of an institution that is no web address": update("institutions/institution-1", {
      website: "javascript:alert(1)",
    }),
    "email domains of an institution that are no list": update("institutions/institution-1", {
      emailDomains: "example.org",
    }),
    "a country code of an institution that is a number": update("institutions/institution-1", { countryCode: 44 }),
    "a city of an institution of 900,000 characters": update("institutions/institution-1", { city: text(HUGE) }),
    "a name of an institution of 301 characters": update("institutions/institution-1", { name: text(301) }),
    "a description of a vocabulary term of 900,000 characters": update("vocabularyTerms/term-1", {
      description: text(HUGE),
    }),
    "labels of a vocabulary term that are no list": update("vocabularyTerms/term-1", { labelsSource: 42 }),
    "a year of a candidate study that is text": update("candidateStudies/candidate-1", { originalYear: "soon" }),
    "a title of a candidate study of 900,000 characters": update("candidateStudies/candidate-1", {
      originalTitle: text(HUGE),
    }),
    "a choice of a question that is a map nested fifteen deep": update("predictionMarketItems/item-1", {
      choices: [nested(15)],
    }),
    "an item of a checklist template that is a number": update("checklistTemplates/onboarding", { items: [42] }),
    "a checklist template with no item": update("checklistTemplates/onboarding", { items: [] }),
    "a count category whose key holds a full stop, which splits a field path": category("tested.twice", {}),
    "a count category at a negative position": category("synthetic-category", { position: -1 }),
    "a count category at a fractional position": category("synthetic-category", { position: 1.5 }),
    "a status definition whose key holds a full stop and a space": definition("on hold.again", {}),
    "a status definition in a category that does not exist": definition("synthetic-status", { category: "limbo" }),
    "a status definition at a fractional position": definition("synthetic-status", { position: 1.5 }),
  });
});

describe("a participation that a coordinator of laboratory A creates", () => {
  // The other laboratory has a participation in replication X already, so the new one is that of
  // laboratory A in the other replication.
  const fields = {
    replicationId: "SyntheticStudy2002",
    laboratoryId: OWN_LABORATORY,
    scopeKeys: ["rep:SyntheticStudy2002", `lab:${OWN_LABORATORY}`],
    status: "interested",
    statusHistoryId: null,
    readinessStatus: "notStarted",
    custom: {},
    dataOrigin: "live",
  };
  const path = `participations/SyntheticStudy2002__${OWN_LABORATORY}`;
  const create =
    (changes: Record<string, unknown>, at: string = path) =>
    () =>
      lab.create("ownCoordinator", at, { ...fields, ...changes });

  it("is refused even where it is well formed, because only createParticipation creates one", async () => {
    await assertFails(create({ targetNMain: 40 })());
  });

  refuses({
    "with an identifier that does not join its replication and its laboratory": create({}, "participations/anything"),
    "with the identifier of another pair": create({}, `participations/${OWN_PARTICIPATION}-copy`),
    "with scope keys of another unit": create({ scopeKeys: [`rep:${OWN_REPLICATION}`, `lab:${OWN_LABORATORY}`] }),
    "with the scope key of every member": create({
      scopeKeys: ["rep:SyntheticStudy2002", `lab:${OWN_LABORATORY}`, "members"],
    }),
    "with a status beyond the first two": create({ status: "collecting" }),
    "with a status history of its own": create({ statusHistoryId: "history-1" }),
    "as a record of an import": create({ dataOrigin: "importedHistorical" }),
    "as a projected record": create({ dataOrigin: "projected" }),
    "with a negative target": create({ targetNMain: -1 }),
    "with a fractional target": create({ targetNRest: 0.5 }),
    "with the provenance of an import": create({ sourceRecordIds: ["source-record-1"] }),
  });
});
