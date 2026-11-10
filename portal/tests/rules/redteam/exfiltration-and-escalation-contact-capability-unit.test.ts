// Red-team attack on the contact documents of the people of a unit by an account that holds
// `people.contact.read` for a different unit.
//
// The registry gives the contact document of a person to whoever holds the capability for a
// replication or a laboratory that the directory document of the person names. The rule asks
// two things apart: that the capability is held for some unit, and that the caller leads or
// coordinates a unit of the person. An account with two roles satisfies the two with different
// units. The attacker below leads the owning replication, whose leads a programme administrator
// has barred from contact details through the capability matrix, and coordinates another
// laboratory, which still confers the capability there.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { laboratoryScopeKey, replicationScopeKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import {
  type AccountSpec,
  OTHER_LABORATORY,
  OWN_LABORATORY,
  OWN_REPLICATION,
  resolveSyntheticAccess,
  stored,
} from "../world";
import { account, seed } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get } = requestsOf(() => environment);

/** The capability matrix after an administrator has taken contact details away from replication leads. */
const LEADS_BARRED: AccountSpec["overrides"] = [{ role: "replication_lead", overrides: { peopleContactRead: false } }];
/** The same for laboratory coordinators. */
const COORDINATORS_BARRED: AccountSpec["overrides"] = [
  { role: "lab_coordinator", overrides: { peopleContactRead: false } },
];

const IN_REPLICATION = "persons/person-synthetic-in-replication";
const IN_LABORATORY = "persons/person-synthetic-in-laboratory";

const person = (slug: string, replicationIds: readonly string[], laboratoryIds: readonly string[]) => ({
  ...stored(),
  slug,
  displayName: "Synthetic Person",
  laboratoryIds,
  replicationIds,
  isCoreTeam: false,
  publicListing: "none",
  coreRoles: [],
  userId: null,
  claimedAt: null,
  custom: {},
  dataOrigin: "demo",
});

const contact = (email: string) => ({
  ...stored(),
  emails: [{ email, kind: "primary", verifiedAt: null, claimEligible: true }],
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-contact-unit");
  await seedWorld(environment);
  await seed(environment, {
    [IN_REPLICATION]: person("synthetic-in-replication", [OWN_REPLICATION], []),
    [`${IN_REPLICATION}/private/contact`]: contact("person.in.replication@example.org"),
    [IN_LABORATORY]: person("synthetic-in-laboratory", [], [OWN_LABORATORY]),
    [`${IN_LABORATORY}/private/contact`]: contact("person.in.laboratory@example.org"),
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("the contact documents of the people of a unit", () => {
  it("are refused to a lead whose role no longer confers the capability, and given to one whose role does", async () => {
    const barredLead = await account(environment, "barred-lead", {
      roles: [["replication_lead", "replication", OWN_REPLICATION]],
      personId: "person-synthetic-barred-lead",
      overrides: LEADS_BARRED,
    });
    await expectOutcomes({
      "a lead barred by the matrix: reads the contact document": [
        "denied",
        get(barredLead, `${IN_REPLICATION}/private/contact`),
      ],
      "ownLead: reads the contact document": ["allowed", get("ownLead", `${IN_REPLICATION}/private/contact`)],
      "ownCoordinator: reads the contact document of a person of its laboratory": [
        "allowed",
        get("ownCoordinator", `${IN_LABORATORY}/private/contact`),
      ],
    });
  });

  it("are refused to a barred lead who holds the capability for another laboratory", async () => {
    const spec: AccountSpec = {
      roles: [
        ["replication_lead", "replication", OWN_REPLICATION],
        ["lab_coordinator", "laboratory", OTHER_LABORATORY],
      ],
      personId: "person-synthetic-two-roles",
      overrides: LEADS_BARRED,
    };
    // The access document holds the capability for the other laboratory alone.
    expect(resolveSyntheticAccess("uid-any", spec).capabilities.peopleContactRead).toEqual([
      laboratoryScopeKey(OTHER_LABORATORY),
    ]);
    const attacker: Actor = await account(environment, "lead-and-other-coordinator", spec);
    await expectOutcomes({
      "reads the contact document of a person of the replication it leads": [
        "denied",
        get(attacker, `${IN_REPLICATION}/private/contact`),
      ],
    });
  });

  it("are refused to a barred coordinator who holds the capability for another replication", async () => {
    const spec: AccountSpec = {
      roles: [
        ["lab_coordinator", "laboratory", OWN_LABORATORY],
        ["replication_lead", "replication", "SyntheticStudy2003"],
      ],
      personId: "person-synthetic-two-roles-reversed",
      overrides: COORDINATORS_BARRED,
    };
    expect(resolveSyntheticAccess("uid-any", spec).capabilities.peopleContactRead).toEqual([
      replicationScopeKey("SyntheticStudy2003"),
    ]);
    const attacker: Actor = await account(environment, "coordinator-and-other-lead", spec);
    await expectOutcomes({
      "reads the contact document of a person of the laboratory it coordinates": [
        "denied",
        get(attacker, `${IN_LABORATORY}/private/contact`),
      ],
    });
  });
});
