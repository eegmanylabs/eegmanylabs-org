// Red-team attack by a holder of a programme role who signed in without the second factor that
// the role requires. The rules withhold every capability of the programme from such a session.
// The scope key `programme`, which the access document of the account still lists once a factor
// is enrolled, must be withheld in the same way: a document that belongs to the programme as a
// whole is for programme administrators and the core team, and their powers need the factor.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and contributors on the example.org domain.
import { PROGRAMME_SCOPE_KEY } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, where } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { CALLERS, stored } from "../world";
import { account, seed } from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
let coreTeamWithoutFactor: Actor;
const { get, list } = requestsOf(() => environment);

const TABLE = "contributorTables/table-programme";
const CONTRIBUTOR = "contributors/contributor-programme";
const CONTACT = `${CONTRIBUTOR}/private/contact`;
const RESTRICTED_LINK = "documentLinks/link-programme-restricted";

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-factor-keys");
  await seedWorld(environment);
  // Records of the programme as a whole, as trusted code writes them: the importer of the
  // website data gives a programme-level manuscript the scope key `programme`.
  await seed(environment, {
    "manuscripts/manuscript-programme": {
      ...stored(),
      title: "A synthetic paper of the programme",
      kind: "article",
      status: "published",
      statusHistoryId: null,
      custom: {},
      scopeKeys: [PROGRAMME_SCOPE_KEY],
    },
    [TABLE]: { ...stored(), replicationId: null, sourceKey: "F", scopeKeys: [PROGRAMME_SCOPE_KEY] },
    [CONTRIBUTOR]: {
      ...stored(),
      surnameSource: "Synthetic",
      creditRoles: {},
      reviewStatus: "needsReview",
      replicationId: null,
      manuscriptId: "manuscript-programme",
      contributorTableId: "table-programme",
      personId: null,
      scopeKeys: [PROGRAMME_SCOPE_KEY],
    },
    [CONTACT]: { ...stored(), email: "programme.contributor@example.org" },
    [RESTRICTED_LINK]: {
      ...stored(),
      entityType: "manuscript",
      entityId: "manuscript-programme",
      kind: "googleDoc",
      url: "https://example.org/synthetic-reviewer-correspondence",
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: true,
      replicationId: null,
      laboratoryId: null,
      scopeKeys: [PROGRAMME_SCOPE_KEY],
    },
  });
  coreTeamWithoutFactor = await account(environment, "core-team-without-factor", {
    roles: [["core_team", "programme", "programme"]],
    personId: "person-synthetic-core-team-without-factor",
    mfaEnrolled: true,
    secondFactor: false,
  });
});

afterAll(async () => {
  await environment.cleanup();
});

describe("a document that belongs to the programme as a whole", () => {
  it("is read by the programme roles with their factor, and by no other member", async () => {
    await expectOutcomes({
      "admin: reads the contributor table": ["allowed", get("admin", TABLE)],
      "admin: reads the address of the contributor": ["allowed", get("admin", CONTACT)],
      "coreTeam: reads the restricted link": ["allowed", get("coreTeam", RESTRICTED_LINK)],
      "member: reads the contributor table": ["denied", get("member", TABLE)],
      "member: reads the address of the contributor": ["denied", get("member", CONTACT)],
      "member: reads the restricted link": ["denied", get("member", RESTRICTED_LINK)],
      "ownLead: reads the address of the contributor": ["denied", get("ownLead", CONTACT)],
    });
  });

  it("is refused to a programme administrator who signed in without the required factor", async () => {
    // The session holds the key, which is what the attack relies on.
    expect(CALLERS.adminWithoutFactor.access?.scopeKeys).toContain(PROGRAMME_SCOPE_KEY);
    await expectOutcomes({
      "reads the contributor table": ["denied", get("adminWithoutFactor", TABLE)],
      "reads the address of the contributor": ["denied", get("adminWithoutFactor", CONTACT)],
      "reads the restricted link": ["denied", get("adminWithoutFactor", RESTRICTED_LINK)],
      "lists the contributor tables of the programme": [
        "denied",
        list(
          "adminWithoutFactor",
          "contributorTables",
          where("scopeKeys", "array-contains", PROGRAMME_SCOPE_KEY),
          limit(5),
        ),
      ],
      "lists the links of the programme": [
        "denied",
        list(
          "adminWithoutFactor",
          "documentLinks",
          where("scopeKeys", "array-contains", PROGRAMME_SCOPE_KEY),
          limit(5),
        ),
      ],
    });
  });

  it("is refused to a member of the core team who signed in without the required factor", async () => {
    await expectOutcomes({
      "reads the contributor table": ["denied", get(coreTeamWithoutFactor, TABLE)],
      "reads the address of the contributor": ["denied", get(coreTeamWithoutFactor, CONTACT)],
      "reads the restricted link": ["denied", get(coreTeamWithoutFactor, RESTRICTED_LINK)],
      "lists the links of the programme": [
        "denied",
        list(
          coreTeamWithoutFactor,
          "documentLinks",
          where("scopeKeys", "array-contains", PROGRAMME_SCOPE_KEY),
          limit(5),
        ),
      ],
    });
  });
});
