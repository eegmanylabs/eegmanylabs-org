// Red-team attacks on references: pointing a record at a parent or a target that does not
// exist, or that belongs to another replication or laboratory, and creating a document whose
// identifier does not match the records it joins.
//
// Every test states the secure behaviour: the request is refused. A test that fails has found a
// reference that a client can break, or a record that a client can plant in a scope that is not
// its own.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { participationId, replicationScopeKey, unitScopeKeys } from "@eegml/shared";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { describe, it } from "vitest";
import {
  autoId,
  MEMBER_PERSON,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  SECOND_PARTICIPATION,
  STORED_AT,
  stored,
} from "../world";
import {
  arena,
  LABORATORY,
  OTHER_MANUSCRIPT,
  OTHER_TABLE,
  PARTICIPATION,
  REPLICATION,
} from "./integrity-and-audit-support";

const lab = arena("references");

const REPLICATION_KEY = replicationScopeKey(OWN_REPLICATION);
const OTHER_TABLE_ID = OTHER_TABLE.split("/")[1] ?? "";
const OTHER_MANUSCRIPT_ID = OTHER_MANUSCRIPT.split("/")[1] ?? "";
const GHOST = "does-not-exist";

const contributor = (fields: Record<string, unknown> = {}) => ({
  surnameSource: "Intruder",
  creditRoles: { conceptualization: true },
  reviewStatus: "confirmed",
  replicationId: OWN_REPLICATION,
  manuscriptId: null,
  contributorTableId: "table-1",
  personId: null,
  scopeKeys: [REPLICATION_KEY],
  ...fields,
});

describe("a contributor row that a lead of replication X writes", () => {
  it("is allowed in the contributor table of replication X", async () => {
    await assertSucceeds(lab.create("ownLead", `contributors/${autoId("contributor-red-team")}`, contributor()));
  });

  it("is not planted in the contributor table of another replication", async () => {
    // The row carries the scope of replication X, so its lead may write it, and it names the
    // table of the other replication, whose authorship list then shows it as confirmed.
    await assertFails(
      lab.create(
        "ownLead",
        `contributors/${autoId("contributor-red-team")}`,
        contributor({ contributorTableId: OTHER_TABLE_ID }),
      ),
    );
  });

  it("is not moved into the contributor table of another replication", async () => {
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { contributorTableId: OTHER_TABLE_ID }));
  });

  it("is not moved into a contributor table that does not exist", async () => {
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { contributorTableId: GHOST }));
  });

  it("is not created in a contributor table that does not exist", async () => {
    await assertFails(
      lab.create(
        "ownLead",
        `contributors/${autoId("contributor-red-team")}`,
        contributor({ contributorTableId: GHOST }),
      ),
    );
  });

  it("is not attached to the manuscript of another replication when it is changed", async () => {
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { manuscriptId: OTHER_MANUSCRIPT_ID }));
  });

  it("is not attached to the manuscript of another replication when it is created", async () => {
    await assertFails(
      lab.create(
        "ownLead",
        `contributors/${autoId("contributor-red-team")}`,
        contributor({ manuscriptId: OTHER_MANUSCRIPT_ID }),
      ),
    );
  });

  it("is not attached to a manuscript that does not exist", async () => {
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { manuscriptId: GHOST }));
  });

  it("is not attached to a person who does not exist", async () => {
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { personId: GHOST }));
  });

  it("does not take the scope of another replication", async () => {
    await assertFails(
      lab.create(
        "ownLead",
        `contributors/${autoId("contributor-red-team")}`,
        contributor({ replicationId: OTHER_REPLICATION, scopeKeys: [replicationScopeKey(OTHER_REPLICATION)] }),
      ),
    );
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { replicationId: OTHER_REPLICATION }));
    await assertFails(lab.update("ownLead", "contributors/contributor-1", { scopeKeys: [REPLICATION_KEY, "members"] }));
  });

  it("gets no contact document where the contributor does not exist or belongs to another replication", async () => {
    await lab.plant({
      "contributors/contributor-of-other-replication": {
        ...stored(),
        ...contributor({
          replicationId: OTHER_REPLICATION,
          contributorTableId: OTHER_TABLE_ID,
          scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
        }),
      },
    });
    const contact = { email: "intruder.contributor@example.org" };
    await assertFails(lab.create("ownLead", `contributors/${GHOST}/private/contact`, contact));
    await assertFails(lab.create("ownLead", "contributors/contributor-of-other-replication/private/contact", contact));
    await assertFails(lab.create("coreTeam", `contributors/${GHOST}/private/contact`, contact));
  });
});

describe("a protocol and its versions, which a lead of replication X writes", () => {
  it("does not name a current version that does not exist", async () => {
    await assertFails(lab.update("ownLead", `${REPLICATION}/protocols/protocol-1`, { currentVersionId: GHOST }));
  });

  it("does not name the version of another protocol as its current version", async () => {
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/protocols/protocol-1`, { currentVersionId: "version-of-protocol-2" }),
    );
  });

  it("does not name a document link that does not exist", async () => {
    await assertFails(lab.update("ownLead", `${REPLICATION}/protocolVersions/version-1`, { documentLinkId: GHOST }));
  });

  it("gets no version beneath a protocol that does not exist, or beneath another replication", async () => {
    const version = {
      replicationId: OWN_REPLICATION,
      protocolId: GHOST,
      versionLabel: "1.0",
      status: "draft",
      approvedBy: null,
      approvedAt: null,
    };
    await assertFails(lab.create("ownLead", `${REPLICATION}/protocolVersions/${autoId("version-red-team")}`, version));
    await assertFails(
      lab.create("ownLead", `replications/${OTHER_REPLICATION}/protocolVersions/${autoId("version-red-team")}`, {
        ...version,
        protocolId: "protocol-1",
      }),
    );
    await assertFails(
      lab.create("ownLead", `replications/${OTHER_REPLICATION}/protocolVersions/${autoId("version-red-team")}`, {
        ...version,
        replicationId: OTHER_REPLICATION,
        protocolId: "protocol-1",
      }),
    );
  });

  it("gets no hypothesis, protocol or requirement beneath a replication that does not exist", async () => {
    const ghost = `replications/${GHOST}`;
    await assertFails(
      lab.create("coreTeam", `${ghost}/hypotheses/h01`, {
        replicationId: GHOST,
        hypothesisNumber: "1",
        text: "A hypothesis of no study.",
        scientificReviewStatus: "unverified",
        analysisStatus: "notStarted",
        resultReviewedBy: null,
        resultReviewedAt: null,
      }),
    );
    await assertFails(
      lab.create("coreTeam", `${ghost}/protocols/${autoId("protocol-1")}`, {
        replicationId: GHOST,
        title: "A protocol of no study",
        currentVersionId: null,
      }),
    );
    await assertFails(
      lab.create("coreTeam", `${ghost}/equipmentRequirements/eye-tracker`, {
        replicationId: GHOST,
        requirementKey: "eye-tracker",
        operator: "present",
        isMandatory: false,
      }),
    );
    await assertFails(lab.create("coreTeam", `${ghost}/private/detail`, { internalNotes: "Notes on no study." }));
    await assertFails(
      lab.create("coreTeam", `${ghost}/memberships/${MEMBER_PERSON}__member`, {
        replicationId: GHOST,
        personId: MEMBER_PERSON,
        role: "member",
        isCurrent: true,
        earlierPeriods: [],
        reviewStatus: "needsReview",
      }),
    );
  });
});

describe("a participation", () => {
  const fields = (replicationId: string, laboratoryId: string, changes: Record<string, unknown> = {}) => ({
    replicationId,
    laboratoryId,
    scopeKeys: unitScopeKeys(replicationId, laboratoryId),
    status: "interested",
    statusHistoryId: null,
    readinessStatus: "notStarted",
    custom: {},
    dataOrigin: "live",
    ...changes,
  });

  it("is not created for a replication or a laboratory that does not exist", async () => {
    await assertFails(
      lab.create(
        "ownCoordinator",
        `participations/${participationId("GhostStudy1999", OWN_LABORATORY)}`,
        fields("GhostStudy1999", OWN_LABORATORY),
      ),
    );
    await assertFails(
      lab.create(
        "ownLead",
        `participations/${participationId(OWN_REPLICATION, GHOST)}`,
        fields(OWN_REPLICATION, GHOST),
      ),
    );
  });

  it("is not created under an identifier that names another replication or laboratory", async () => {
    const other = participationId(OTHER_REPLICATION, OTHER_LABORATORY);
    // The fields name the units the attacker manages, and the identifier those of someone else.
    await assertFails(
      lab.create("ownCoordinator", `participations/${other}`, fields(OTHER_REPLICATION, OWN_LABORATORY)),
    );
    await assertFails(lab.create("ownLead", `participations/${other}`, fields(OWN_REPLICATION, OTHER_LABORATORY)));
    await assertFails(lab.create("ownLead", "participations/free-text", fields(OWN_REPLICATION, OTHER_LABORATORY)));
  });

  it("is not created for units that the attacker does not manage", async () => {
    const other = participationId(OTHER_REPLICATION, OTHER_LABORATORY);
    await assertFails(
      lab.create("ownCoordinator", `participations/${other}`, fields(OTHER_REPLICATION, OTHER_LABORATORY)),
    );
    await assertFails(lab.create("ownLead", `participations/${other}`, fields(OTHER_REPLICATION, OTHER_LABORATORY)));
    await assertFails(
      lab.create("ownLabMember", `participations/${other}`, fields(OTHER_REPLICATION, OTHER_LABORATORY)),
    );
  });

  it("does not move to another replication or laboratory, by a change or by a second document", async () => {
    await assertFails(lab.update("ownLead", PARTICIPATION, { laboratoryId: OTHER_LABORATORY }));
    await assertFails(lab.update("ownCoordinator", PARTICIPATION, { replicationId: OTHER_REPLICATION }));
    await assertFails(
      lab.update("ownCoordinator", PARTICIPATION, { scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY) }),
    );
    // The pair exists already, so a second document for it needs another identifier.
    await assertFails(
      lab.create("ownLead", `participations/${OWN_PARTICIPATION}-2`, fields(OWN_REPLICATION, OWN_LABORATORY)),
    );
  });

  it("does not name a protocol version that belongs to another protocol than the one it names", async () => {
    await assertFails(
      lab.update("ownLead", PARTICIPATION, { protocolId: "protocol-1", protocolVersionId: "version-of-protocol-2" }),
    );
  });

  it("does not name a local lead, a protocol, a version or equipment that does not exist", async () => {
    await assertFails(lab.update("ownCoordinator", PARTICIPATION, { localLeadPersonId: GHOST }));
    await assertFails(lab.update("ownLead", PARTICIPATION, { protocolId: GHOST }));
    await assertFails(lab.update("ownLead", PARTICIPATION, { protocolVersionId: GHOST }));
    await assertFails(lab.update("ownCoordinator", PARTICIPATION, { equipmentConfigurationId: GHOST }));
  });

  it("does not name a protocol of another replication or the equipment of another laboratory", async () => {
    await lab.plant({
      [`replications/${OTHER_REPLICATION}/protocols/protocol-of-other`]: {
        ...stored(),
        replicationId: OTHER_REPLICATION,
        title: "Protocol of the other replication",
        currentVersionId: null,
      },
      [`laboratories/${OTHER_LABORATORY}/equipment/configuration-of-other`]: {
        ...stored(),
        laboratoryId: OTHER_LABORATORY,
        name: "Booth of the other laboratory",
        isCurrent: true,
        validFrom: STORED_AT,
        validTo: null,
        supersedesId: null,
      },
    });
    await assertFails(lab.update("ownLead", PARTICIPATION, { protocolId: "protocol-of-other" }));
    await assertFails(
      lab.update("ownCoordinator", PARTICIPATION, { equipmentConfigurationId: "configuration-of-other" }),
    );
  });

  it("gets no team member, deviation or detail beneath a participation of other units or of none", async () => {
    const teamMember = (id: string, changes: Record<string, unknown>) => ({
      participationId: id,
      personId: MEMBER_PERSON,
      role: "analyst",
      ...changes,
    });
    const own = {
      replicationId: OWN_REPLICATION,
      laboratoryId: OWN_LABORATORY,
      ...{ scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY) },
    };
    const otherId = participationId(OTHER_REPLICATION, OTHER_LABORATORY);
    await lab.plant({
      [`participations/${otherId}`]: {
        ...stored(),
        ...fields(OTHER_REPLICATION, OTHER_LABORATORY, { dataOrigin: "demo" }),
      },
    });
    // Beneath the participation of other units, with scope fields that name the attacker's own.
    await assertFails(
      lab.create("ownCoordinator", `participations/${otherId}/teamMembers/${MEMBER_PERSON}`, teamMember(otherId, own)),
    );
    await assertFails(
      lab.create("ownLead", `participations/${otherId}/teamMembers/${MEMBER_PERSON}`, teamMember(otherId, own)),
    );
    // Beneath a participation that does not exist.
    await assertFails(
      lab.create("ownCoordinator", `participations/${GHOST}/teamMembers/${MEMBER_PERSON}`, teamMember(GHOST, own)),
    );
    // For a person who does not exist.
    await assertFails(
      lab.create("ownCoordinator", `${PARTICIPATION}/teamMembers/${GHOST}`, {
        ...teamMember(OWN_PARTICIPATION, own),
        personId: GHOST,
      }),
    );
    // The lead of replication X has no say in the detail of a participation of the other replication.
    await assertFails(
      lab.create("ownLead", `participations/${otherId}/private/detail`, {
        ethicsStatus: "approved",
        trainingStatus: "completed",
        readinessApprovedBy: null,
        readinessApprovedAt: null,
      }),
    );
    // The coordinator of laboratory A has none in that of the other laboratory in replication X.
    await assertFails(
      lab.create("ownCoordinator", `participations/${SECOND_PARTICIPATION}/private/detail`, {
        ethicsStatus: "approved",
        trainingStatus: "completed",
        readinessApprovedBy: null,
        readinessApprovedAt: null,
      }),
    );
  });
});

describe("a document beneath a parent that does not exist, which the core team writes", () => {
  it("is no postal address of a person who does not exist", async () => {
    await assertFails(
      lab.create("coreTeam", `persons/${GHOST}/private/address`, { postalAddress: "1 Nowhere Street, Example Town" }),
    );
  });

  it("is no affiliation of a person who does not exist", async () => {
    await assertFails(
      lab.create("coreTeam", `persons/${GHOST}/affiliations/${autoId("affiliation-1")}`, {
        personId: GHOST,
        affiliationSource: "Example Institute",
        isPrimary: true,
      }),
    );
  });

  it("is no private detail of a participation that does not exist", async () => {
    await assertFails(
      lab.create("coreTeam", `participations/${GHOST}/private/detail`, {
        ethicsStatus: "unknown",
        trainingStatus: "unknown",
        readinessApprovedBy: null,
        readinessApprovedAt: null,
      }),
    );
  });

  it("is no private note of a person, detail of a laboratory or member entry of a laboratory that does not exist", async () => {
    await assertFails(lab.create("coreTeam", `persons/${GHOST}/private/notes`, { privateNotes: "A note on nobody." }));
    await assertFails(lab.create("coreTeam", `laboratories/${GHOST}/private/detail`, { address: "Nowhere" }));
    await assertFails(
      lab.create("coreTeam", `laboratories/${GHOST}/members/${MEMBER_PERSON}`, {
        laboratoryId: GHOST,
        personId: MEMBER_PERSON,
        role: "member",
        isAuthorisedRepresentative: false,
        earlierPeriods: [],
        status: "proposed",
      }),
    );
    await assertFails(
      lab.create("coreTeam", `${LABORATORY}/members/${GHOST}`, {
        laboratoryId: OWN_LABORATORY,
        personId: GHOST,
        role: "member",
        isAuthorisedRepresentative: false,
        earlierPeriods: [],
        status: "proposed",
      }),
    );
  });

  it("is no event of a manuscript that does not exist", async () => {
    await assertFails(
      lab.create("coreTeam", `manuscripts/${GHOST}/events/${autoId("event-1")}`, {
        manuscriptId: GHOST,
        kind: "submission",
        occurredAt: STORED_AT,
        documentLinkIds: [],
        replicationId: null,
        laboratoryId: null,
        scopeKeys: [],
      }),
    );
  });
});

describe("a reference in a record that an ordinary member or the core team writes", () => {
  const affiliation = { personId: MEMBER_PERSON, affiliationSource: "Example Institute", isPrimary: false };
  const path = `persons/${MEMBER_PERSON}/affiliations/${autoId("red-team")}`;

  it("is no laboratory that does not exist, on the affiliation of an ordinary member", async () => {
    await assertFails(lab.create("member", path, { ...affiliation, laboratoryId: GHOST }));
  });

  it("is no institution that does not exist, on the affiliation of an ordinary member", async () => {
    await assertFails(lab.create("member", path, { ...affiliation, institutionId: GHOST }));
  });

  it("is no other person, on the affiliation of an ordinary member", async () => {
    await assertFails(lab.create("member", path, { ...affiliation, personId: "person-synthetic-owner" }));
    await assertFails(
      lab.create("member", `persons/person-synthetic-owner/affiliations/${autoId("red-team")}`, {
        ...affiliation,
        personId: "person-synthetic-owner",
      }),
    );
  });

  it("is no programme that does not exist, on a candidate study", async () => {
    await assertFails(lab.update("coreTeam", "candidateStudies/candidate-1", { programmeId: GHOST }));
  });

  it("is no hypothesis of no replication, on a question of the prediction market", async () => {
    await assertFails(lab.update("coreTeam", "predictionMarketItems/item-1", { hypothesisId: "h42" }));
  });

  it("is no hypothesis that does not exist, on a question of the prediction market", async () => {
    await assertFails(
      lab.create("coreTeam", `predictionMarketItems/${autoId("item-red-team")}`, {
        replicationId: OWN_REPLICATION,
        hypothesisId: "h42",
        questionText: "Will a hypothesis that does not exist replicate?",
        choices: ["Yes", "No"],
      }),
    );
  });

  it("is no replication, programme, institution or principal investigator that does not exist", async () => {
    await assertFails(
      lab.create("coreTeam", `predictionMarketItems/${autoId("item-red-team")}`, {
        replicationId: GHOST,
        questionText: "Will a study that does not exist replicate?",
        choices: ["Yes", "No"],
      }),
    );
    await assertFails(lab.update("ownLead", REPLICATION, { programmeId: GHOST }));
    await assertFails(lab.update("ownCoordinator", LABORATORY, { institutionId: GHOST }));
    await assertFails(lab.update("ownCoordinator", LABORATORY, { piPersonId: GHOST }));
    await assertFails(
      lab.create("coreTeam", "countCategories/synthetic-category", {
        key: "synthetic-category",
        label: "Synthetic category",
        definition: "A category of a study that does not exist.",
        position: 50,
        isCore: false,
        replicationId: GHOST,
      }),
    );
  });
});

describe("an identifier by which imports find a record again", () => {
  const ORCID = "0000-0002-1825-0097";

  it("is not the ORCID iD of another person, taken by an ordinary member as their own", async () => {
    // Importers treat an ORCID iD as identifying evidence (docs/DATA_MODEL.md, section 3), and a
    // rule cannot tell whose it is. The owner's record carries the iD, and the member claims it.
    const owner = await lab.stored("persons/person-synthetic-owner");
    await lab.plant({ "persons/person-synthetic-owner": { ...owner, orcid: ORCID } });
    await assertFails(lab.update("member", `persons/${MEMBER_PERSON}`, { orcid: ORCID }));
  });

  it("is not the ROR identifier of another institution, given by the core team to a second one", async () => {
    await lab.plant({
      "institutions/institution-2": {
        ...stored(),
        name: "Second Synthetic University",
        rorId: "05gq02987",
        emailDomains: [],
      },
    });
    await assertFails(lab.update("coreTeam", "institutions/institution-1", { rorId: "05gq02987" }));
  });

  it("is not the original identifier of a vocabulary term, changed by the core team", async () => {
    await assertFails(lab.update("coreTeam", "vocabularyTerms/term-1", { sourceId: "term-of-another-vocabulary" }));
  });

  it("is not the slug of a person or of a laboratory, the study key of a replication or the key of a lookup", async () => {
    await assertFails(lab.update("coreTeam", "persons/person-synthetic-owner", { slug: "synthetic-member" }));
    await assertFails(lab.update("ownCoordinator", LABORATORY, { slug: "synthetic-laboratory-two" }));
    await assertFails(lab.update("ownLead", REPLICATION, { studyKey: OTHER_REPLICATION }));
    await assertFails(lab.update("coreTeam", "programmes/synthetic-programme", { key: "another-programme" }));
    await assertFails(lab.update("coreTeam", "countCategories/tested", { key: "usable" }));
    await assertFails(lab.update("coreTeam", "statusDefinitions/replication__planning", { key: "published" }));
    await assertFails(lab.update("coreTeam", "statusDefinitions/replication__planning", { entityType: "task" }));
    await assertFails(lab.update("coreTeam", "checklistTemplates/onboarding", { key: "offboarding" }));
    await assertFails(lab.update("coreTeam", "vocabularyTerms/term-1", { name: "Another construct" }));
    await assertFails(lab.update("coreTeam", "candidateStudies/candidate-1", { originalDoi: "10.1000/forged" }));
    await assertFails(lab.update("ownLead", `${REPLICATION}/hypotheses/h01`, { hypothesisNumber: "7" }));
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/equipmentRequirements/min-channels`, { requirementKey: "max-channels" }),
    );
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/memberships/person-synthetic-owner__member`, { role: "advisor" }),
    );
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/memberships/person-synthetic-owner__member`, { personId: MEMBER_PERSON }),
    );
    await assertFails(
      lab.update("ownCoordinator", `${LABORATORY}/members/person-synthetic-owner`, { personId: MEMBER_PERSON }),
    );
  });
});

describe("a document link and an external account that a lead of replication X writes", () => {
  const link = (fields: Record<string, unknown>) => ({
    kind: "googleDoc",
    url: "https://example.org/synthetic-document",
    accessStatus: "unknown",
    lastCheckedAt: null,
    restricted: false,
    laboratoryId: null,
    ...fields,
  });

  it("does not attach a link to a record of another replication, or carry another audience than its target", async () => {
    const otherKey = replicationScopeKey(OTHER_REPLICATION);
    await assertFails(
      lab.create(
        "ownLead",
        `documentLinks/${autoId("link-red-team")}`,
        link({
          entityType: "replication",
          entityId: OTHER_REPLICATION,
          replicationId: OTHER_REPLICATION,
          scopeKeys: [otherKey, "members"],
        }),
      ),
    );
    // The target is the other replication, and the scope fields name the attacker's own.
    await assertFails(
      lab.create(
        "ownLead",
        `documentLinks/${autoId("link-red-team")}`,
        link({
          entityType: "replication",
          entityId: OTHER_REPLICATION,
          replicationId: OWN_REPLICATION,
          scopeKeys: [REPLICATION_KEY, "members"],
        }),
      ),
    );
    await assertFails(
      lab.create(
        "ownLead",
        `documentLinks/${autoId("link-red-team")}`,
        link({
          entityType: "manuscript",
          entityId: OTHER_MANUSCRIPT_ID,
          replicationId: OWN_REPLICATION,
          scopeKeys: [REPLICATION_KEY, "members"],
        }),
      ),
    );
    await assertFails(
      lab.create(
        "ownLead",
        `documentLinks/${autoId("link-red-team")}`,
        link({
          entityType: "hypothesis",
          entityId: `${OWN_REPLICATION}__h99`,
          replicationId: OWN_REPLICATION,
          scopeKeys: [REPLICATION_KEY, "members"],
        }),
      ),
    );
    await assertFails(
      lab.create(
        "ownLead",
        `documentLinks/${autoId("link-red-team")}`,
        link({
          entityType: "replication",
          entityId: OWN_REPLICATION,
          replicationId: OWN_REPLICATION,
          scopeKeys: [REPLICATION_KEY, "members", "programme"],
        }),
      ),
    );
  });

  it("does not turn a link towards another record or another audience", async () => {
    await assertFails(lab.update("ownLead", "documentLinks/link-1", { entityId: OTHER_REPLICATION }));
    await assertFails(lab.update("ownLead", "documentLinks/link-1", { entityType: "laboratory" }));
    await assertFails(lab.update("ownLead", "documentLinks/link-1", { restricted: true }));
    await assertFails(lab.update("ownLead", "documentLinks/link-1", { scopeKeys: [REPLICATION_KEY] }));
    await assertFails(lab.update("ownLead", "documentLinks/link-1", { replicationId: OTHER_REPLICATION }));
  });

  it("does not record an account for another replication, or for one that does not exist", async () => {
    const account = (ownerId: string) => ({
      ownerType: "replication",
      ownerId,
      system: "github",
      accountName: "synthetic-intruder",
      scopeKeys: [replicationScopeKey(ownerId)],
    });
    await assertFails(
      lab.create("ownLead", `externalAccounts/${autoId("account-red-team")}`, account(OTHER_REPLICATION)),
    );
    await assertFails(
      lab.create("coreTeam", `externalAccounts/${autoId("account-red-team")}`, account("GhostStudy1999")),
    );
    await assertFails(lab.update("ownLead", "externalAccounts/account-1", { ownerId: OTHER_REPLICATION }));
  });

  it("does not write a manuscript or an event of another replication", async () => {
    await assertFails(
      lab.create("ownLead", `manuscripts/${autoId("manuscript-red-team")}`, {
        replicationId: OTHER_REPLICATION,
        title: "A manuscript of someone else's study",
        kind: "preprint",
        status: "planned",
        statusHistoryId: null,
        custom: {},
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
      }),
    );
    await assertFails(
      lab.create("ownLead", `${OTHER_MANUSCRIPT}/events/${autoId("event-red-team")}`, {
        manuscriptId: OTHER_MANUSCRIPT_ID,
        kind: "decision",
        outcome: "rejected",
        occurredAt: STORED_AT,
        documentLinkIds: [],
        replicationId: OTHER_REPLICATION,
        laboratoryId: null,
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
      }),
    );
    // An event beneath the attacker's own manuscript that claims the scope of the other replication.
    await assertFails(
      lab.create("ownLead", `manuscripts/manuscript-1/events/${autoId("event-red-team")}`, {
        manuscriptId: "manuscript-1",
        kind: "decision",
        occurredAt: STORED_AT,
        documentLinkIds: [],
        replicationId: OTHER_REPLICATION,
        laboratoryId: null,
        scopeKeys: [replicationScopeKey(OTHER_REPLICATION)],
      }),
    );
    await assertFails(lab.update("ownLead", OTHER_MANUSCRIPT, { title: "Renamed by the lead of another study" }));
  });
});
