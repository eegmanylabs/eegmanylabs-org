// Red-team attempts to move a document into or out of a scope: changing `scopeKeys`,
// `replicationId` or `laboratoryId` on a document that the caller may edit, creating a document
// that claims the scope of another unit, opening a restricted document to every member, and
// naming a target that the caller does not manage.
// Each test states the secure behaviour, so a test that fails has found a hole. Beside the
// refusals, each table holds a request that is accepted, so that a refusal is about the attack
// and not about a malformed document.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { MEMBERS_SCOPE_KEY, participationId, replicationScopeKey, unitScopeKeys, userScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { arrayUnion } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  autoId,
  MEMBER_PERSON,
  OTHER_LABORATORY,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  SECOND_PARTICIPATION,
  stored,
  uidOfCaller,
} from "../world";
import { newRecord, seed, storedPath } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, create, update } = requestsOf(() => environment);

const OWN_KEY = replicationScopeKey(OWN_REPLICATION);
const OTHER_KEY = replicationScopeKey(OTHER_REPLICATION);
const PARTICIPATION = `participations/${OWN_PARTICIPATION}`;
const RESTRICTED_LINK = "documentLinks/link-restricted";

const LEAD = uidOfCaller("ownLead");
const COORDINATOR = uidOfCaller("ownCoordinator");

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-scope");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
  await seed(environment, {
    // An ethics letter attached to the participation: read within its scope alone.
    [RESTRICTED_LINK]: {
      ...stored(),
      entityType: "participation",
      entityId: OWN_PARTICIPATION,
      kind: "pdf",
      url: "https://example.org/synthetic-ethics-letter",
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: true,
      replicationId: OWN_REPLICATION,
      laboratoryId: OWN_LABORATORY,
      scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
    },
  });
});

describe("the scope fields of a document that the caller may edit", () => {
  it("stay as they are on a participation and on what sits beneath it", async () => {
    const teamMember = storedPath("participationTeamMembers");
    const deviation = storedPath("participationDeviations");
    const checklistItem = storedPath("participationChecklist");
    await expectOutcomes({
      "ownLead: edits the target of the participation": [
        "allowed",
        update("ownLead", PARTICIPATION, { targetNMain: 60 }),
      ],
      "ownLead: opens the participation to another replication": [
        "denied",
        update("ownLead", PARTICIPATION, { scopeKeys: arrayUnion(OTHER_KEY) }),
      ],
      "ownLead: moves the participation to another laboratory": [
        "denied",
        update("ownLead", PARTICIPATION, { laboratoryId: OTHER_LABORATORY }),
      ],
      "ownCoordinator: moves the participation to another replication": [
        "denied",
        update("ownCoordinator", PARTICIPATION, { replicationId: OTHER_REPLICATION }),
      ],
      "ownCoordinator: removes the replication from the scope of the participation": [
        "denied",
        update("ownCoordinator", PARTICIPATION, { scopeKeys: [`lab:${OWN_LABORATORY}`] }),
      ],
      "ownLead: edits the role of a team member": ["allowed", update("ownLead", teamMember, { role: "analyst" })],
      "ownLead: moves a team member to another participation": [
        "denied",
        update("ownLead", teamMember, { participationId: SECOND_PARTICIPATION }),
      ],
      "ownLead: moves a team member to another laboratory": [
        "denied",
        update("ownLead", teamMember, { laboratoryId: OTHER_LABORATORY }),
      ],
      "ownCoordinator: opens a deviation to every member": [
        "denied",
        update("ownCoordinator", deviation, { scopeKeys: arrayUnion(MEMBERS_SCOPE_KEY) }),
      ],
      "ownCoordinator: moves a deviation out of the sight of the replication": [
        "denied",
        update("ownCoordinator", deviation, {
          replicationId: OTHER_REPLICATION,
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
        }),
      ],
      "ownLabMember: updates the status of a checklist item": [
        "allowed",
        update("ownLabMember", checklistItem, { status: "inProgress" }),
      ],
      "ownLabMember: moves a checklist item to another laboratory": [
        "denied",
        update("ownLabMember", checklistItem, { laboratoryId: OTHER_LABORATORY }),
      ],
      "ownLabMember: opens a checklist item to its own login": [
        "denied",
        update("ownLabMember", checklistItem, { scopeKeys: arrayUnion(userScopeKey(uidOfCaller("ownLabMember"))) }),
      ],
      "otherLabMember: updates a checklist item of another laboratory": [
        "denied",
        update("otherLabMember", checklistItem, { status: "done" }),
      ],
    });
  });

  it("are those of the parent on a document that is created beneath a participation", async () => {
    const beneath = `${PARTICIPATION}/teamMembers`;
    const row = newRecord("participationTeamMembers", LEAD);
    await expectOutcomes({
      "ownLead: adds a team member that every member reads": [
        "denied",
        create("ownLead", `${beneath}/${MEMBER_PERSON}`, {
          ...row,
          scopeKeys: [...unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY), MEMBERS_SCOPE_KEY],
        }),
      ],
      "ownLead: adds a team member with the scope of another replication": [
        "denied",
        create("ownLead", `${beneath}/${MEMBER_PERSON}`, {
          ...row,
          replicationId: OTHER_REPLICATION,
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
        }),
      ],
      "otherLead: adds a team member by claiming its own replication in the request": [
        "denied",
        create("otherLead", `${beneath}/${MEMBER_PERSON}`, {
          ...row,
          replicationId: OTHER_REPLICATION,
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
        }),
      ],
      "otherLead: adds a team member with the scope fields of the participation": [
        "denied",
        create("otherLead", `${beneath}/${MEMBER_PERSON}`, row),
      ],
      // The same document from the lead of the replication is accepted.
      "ownLead: adds a team member": ["allowed", create("ownLead", `${beneath}/${MEMBER_PERSON}`, row)],
      "otherCoordinator: files a deviation by claiming its own laboratory in the request": [
        "denied",
        create("otherCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-forged")}`, {
          ...newRecord("participationDeviations", uidOfCaller("otherCoordinator")),
          laboratoryId: OTHER_LABORATORY,
          scopeKeys: unitScopeKeys(OWN_REPLICATION, OTHER_LABORATORY),
        }),
      ],
      "ownCoordinator: files a deviation in the name of another account": [
        "denied",
        create("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-misattributed")}`, {
          ...newRecord("participationDeviations", COORDINATOR),
          reportedBy: LEAD,
        }),
      ],
    });
  });

  it("are rebuilt from the two identifiers of a participation that is created", async () => {
    const fresh = newRecord("participations", COORDINATOR);
    const path = `participations/${participationId(OTHER_REPLICATION, OWN_LABORATORY)}`;
    await expectOutcomes({
      "ownCoordinator: creates a participation that every member may read restricted parts of": [
        "denied",
        create("ownCoordinator", path, {
          ...fresh,
          scopeKeys: [...unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY), MEMBERS_SCOPE_KEY],
        }),
      ],
      "ownCoordinator: creates a participation under the identifier of another pair": [
        "denied",
        create("ownCoordinator", `participations/${participationId(OTHER_REPLICATION, OTHER_LABORATORY)}`, fresh),
      ],
      "ownCoordinator: creates a participation of a laboratory it does not coordinate": [
        "denied",
        create("ownCoordinator", `participations/${participationId(OTHER_REPLICATION, OTHER_LABORATORY)}`, {
          ...fresh,
          laboratoryId: OTHER_LABORATORY,
          scopeKeys: unitScopeKeys(OTHER_REPLICATION, OTHER_LABORATORY),
        }),
      ],
      "ownCoordinator: creates a participation that is confirmed already": [
        "denied",
        create("ownCoordinator", path, { ...fresh, status: "confirmed" }),
      ],
      "ownCoordinator: creates a participation that claims to be imported": [
        "denied",
        create("ownCoordinator", path, { ...fresh, dataOrigin: "importedHistorical" }),
      ],
      "member: creates a participation": ["denied", create("member", path, fresh)],
      "ownCoordinator: signs its laboratory up": ["allowed", create("ownCoordinator", path, fresh)],
    });
  });
});

describe("the audience of a link, an output and an account name", () => {
  it("never widens: a restricted link stays restricted, and a link follows its target", async () => {
    const link = (fields: Record<string, unknown>) => ({ ...newRecord("documentLinks", LEAD), ...fields });
    await expectOutcomes({
      "member: reads the restricted link": ["denied", get("member", RESTRICTED_LINK)],
      "otherLead: reads the restricted link": ["denied", get("otherLead", RESTRICTED_LINK)],
      "ownLabMember: reads the restricted link of its laboratory": ["allowed", get("ownLabMember", RESTRICTED_LINK)],
      "ownLead: corrects the address of the restricted link": [
        "allowed",
        update("ownLead", RESTRICTED_LINK, { url: "https://example.org/synthetic-ethics-letter-2" }),
      ],
      "ownLead: lifts the restriction": ["denied", update("ownLead", RESTRICTED_LINK, { restricted: false })],
      "ownLead: opens the restricted link to every member": [
        "denied",
        update("ownLead", RESTRICTED_LINK, { scopeKeys: arrayUnion(MEMBERS_SCOPE_KEY) }),
      ],
      "ownCoordinator: opens the restricted link to another laboratory": [
        "denied",
        update("ownCoordinator", RESTRICTED_LINK, { scopeKeys: arrayUnion(`lab:${OTHER_LABORATORY}`) }),
      ],
      "ownLead: attaches the link to another record": [
        "denied",
        update("ownLead", RESTRICTED_LINK, { entityId: SECOND_PARTICIPATION }),
      ],
      "otherCoordinator: edits a link of a unit it does not manage": [
        "denied",
        update("otherCoordinator", RESTRICTED_LINK, { title: "Changed" }),
      ],
      "ownLead: creates a restricted link that every member reads": [
        "denied",
        create(
          "ownLead",
          `documentLinks/${autoId("link-leaky")}`,
          link({ restricted: true, scopeKeys: [OWN_KEY, MEMBERS_SCOPE_KEY] }),
        ),
      ],
      "ownLead: creates a link in the scope of another replication": [
        "denied",
        create(
          "ownLead",
          `documentLinks/${autoId("link-planted")}`,
          link({ scopeKeys: [OTHER_KEY, MEMBERS_SCOPE_KEY] }),
        ),
      ],
      "ownLead: attaches a link to a replication it does not lead": [
        "denied",
        create(
          "ownLead",
          `documentLinks/${autoId("link-foreign")}`,
          link({
            entityId: OTHER_REPLICATION,
            replicationId: OTHER_REPLICATION,
            scopeKeys: [OTHER_KEY, MEMBERS_SCOPE_KEY],
          }),
        ),
      ],
      "ownLead: names its own replication in the scope fields of a link to another": [
        "denied",
        create("ownLead", `documentLinks/${autoId("link-mismatched")}`, link({ entityId: OTHER_REPLICATION })),
      ],
      "ownLead: attaches a link with a script address": [
        "denied",
        create("ownLead", `documentLinks/${autoId("link-script")}`, link({ url: "javascript:alert(document.domain)" })),
      ],
      "ownTeam: attaches a link to the replication it is a member of": [
        "denied",
        create("ownTeam", `documentLinks/${autoId("link-team")}`, link({})),
      ],
      "ownLead: attaches a link to its replication": [
        "allowed",
        create("ownLead", `documentLinks/${autoId("link-own")}`, link({})),
      ],
    });
  });

  it("is the replication of an output, which a lead neither changes nor escapes", async () => {
    const manuscript = storedPath("manuscripts");
    const event = storedPath("manuscriptEvents");
    const table = storedPath("contributorTables");
    const contributor = storedPath("contributors");
    await expectOutcomes({
      "ownLead: edits the journal of a manuscript": [
        "allowed",
        update("ownLead", manuscript, { journal: "Journal of Synthetic Results" }),
      ],
      "ownLead: moves a manuscript to another replication": [
        "denied",
        update("ownLead", manuscript, { replicationId: OTHER_REPLICATION, scopeKeys: [OTHER_KEY] }),
      ],
      "ownLead: marks a manuscript as published": ["denied", update("ownLead", manuscript, { status: "published" })],
      "otherLead: edits a manuscript of another replication": [
        "denied",
        update("otherLead", manuscript, { journal: "Changed" }),
      ],
      "ownLead: creates a manuscript of another replication": [
        "denied",
        create("ownLead", `manuscripts/${autoId("manuscript-foreign")}`, {
          ...newRecord("manuscripts", LEAD),
          replicationId: OTHER_REPLICATION,
          scopeKeys: [OTHER_KEY],
        }),
      ],
      "ownLead: creates a manuscript of the programme as a whole": [
        "denied",
        create("ownLead", `manuscripts/${autoId("manuscript-programme")}`, {
          title: "A synthetic paper",
          kind: "article",
          status: "planned",
          statusHistoryId: null,
          custom: {},
          scopeKeys: [],
        }),
      ],
      "ownLead: creates a manuscript of its replication that carries the key of the programme": [
        "denied",
        create("ownLead", `manuscripts/${autoId("manuscript-wide")}`, {
          ...newRecord("manuscripts", LEAD),
          scopeKeys: [OWN_KEY, "programme"],
        }),
      ],
      "ownLead: moves an event to another replication": [
        "denied",
        update("ownLead", event, { replicationId: OTHER_REPLICATION }),
      ],
      "ownLead: opens a contributor table to every member": [
        "denied",
        update("ownLead", table, { scopeKeys: arrayUnion(MEMBERS_SCOPE_KEY) }),
      ],
      "ownLead: moves a contributor table to another replication": [
        "denied",
        update("ownLead", table, { replicationId: OTHER_REPLICATION }),
      ],
      "ownLead: moves a contributor to another replication": [
        "denied",
        update("ownLead", contributor, { replicationId: OTHER_REPLICATION, scopeKeys: [OTHER_KEY] }),
      ],
      "ownLead: opens the address of a contributor to every member": [
        "denied",
        update("ownLead", contributor, { scopeKeys: arrayUnion(MEMBERS_SCOPE_KEY) }),
      ],
      "otherLead: writes the address of a contributor of another replication": [
        "denied",
        update("otherLead", storedPath("contributorContact"), { email: "changed.address@example.org" }),
      ],
      "ownTeam: edits a contributor of the replication it is a member of": [
        "denied",
        update("ownTeam", contributor, { reviewStatus: "confirmed" }),
      ],
    });
  });

  it("is the owner of an account name, which the one who records it must manage", async () => {
    const stored = storedPath("externalAccounts");
    const fresh = newRecord("externalAccounts", LEAD);
    await expectOutcomes({
      "ownLead: renames the account of its replication": [
        "allowed",
        update("ownLead", stored, { accountName: "synthetic-study-renamed" }),
      ],
      "ownLead: hands the account to another replication": [
        "denied",
        update("ownLead", stored, { ownerId: OTHER_REPLICATION }),
      ],
      "ownLead: opens the account to every member": [
        "denied",
        update("ownLead", stored, { scopeKeys: arrayUnion(MEMBERS_SCOPE_KEY) }),
      ],
      "ownLead: records an account of a replication it does not lead": [
        "denied",
        create("ownLead", `externalAccounts/${autoId("account-foreign")}`, {
          ...fresh,
          ownerId: OTHER_REPLICATION,
          scopeKeys: [OTHER_KEY],
        }),
      ],
      "ownLead: records an account of its replication in the scope of another": [
        "denied",
        create("ownLead", `externalAccounts/${autoId("account-planted")}`, { ...fresh, scopeKeys: [OTHER_KEY] }),
      ],
      "ownLead: records an account of a person": [
        "denied",
        create("ownLead", `externalAccounts/${autoId("account-of-person")}`, {
          ...fresh,
          ownerType: "person",
          ownerId: MEMBER_PERSON,
          scopeKeys: [userScopeKey(LEAD)],
        }),
      ],
      "ownLead: records an account of a group": [
        "denied",
        create("ownLead", `externalAccounts/${autoId("account-of-group")}`, {
          ...fresh,
          ownerType: "group",
          ownerId: "synthetic-working-group",
          scopeKeys: ["group:synthetic-working-group"],
        }),
      ],
      "ownTeam: renames the account of the replication it is a member of": [
        "denied",
        update("ownTeam", stored, { accountName: "changed" }),
      ],
    });
  });
});
