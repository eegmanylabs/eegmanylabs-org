// Red-team attack by an ordinary member on the affiliations of its own person.
//
// A person writes its own affiliations. `laboratoryId` on an affiliation ties the person to a
// laboratory, and the rules keep a client from changing it afterwards. On creation they accept
// any value: a laboratory that the person has no member entry in, and an identifier that names
// no laboratory at all, although the data model has the rules confirm with exists() that a
// document named by a reference field is present. A member therefore shows itself as affiliated
// with any laboratory, with a title of its choosing, in the directory that every member reads
// and that a request to represent a laboratory is checked against.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and laboratories on the example.org domain.
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { limit, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { autoId, MEMBER_PERSON, OTHER_LABORATORY, OWN_LABORATORY, OWNER_PERSON } from "../world";

let environment: RulesTestEnvironment;
const { create, update, listAcrossParents } = requestsOf(() => environment);

/** The person of the account `member` has no member entry in any laboratory. */
const AFFILIATIONS = `persons/${MEMBER_PERSON}/affiliations`;

const affiliation = (fields: Record<string, unknown>) => ({
  personId: MEMBER_PERSON,
  affiliationSource: "Synthetic University",
  isPrimary: false,
  ...fields,
});

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-affiliation");
});

afterAll(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await seedWorld(environment);
});

describe("an affiliation that a person writes for itself", () => {
  it("states where the person works, is read by every member, and never changes its laboratory afterwards", async () => {
    await expectOutcomes({
      "member: adds an affiliation of its own": [
        "allowed",
        create("member", `${AFFILIATIONS}/${autoId("own")}`, affiliation({})),
      ],
      "member: gives it a title": [
        "allowed",
        update("member", `${AFFILIATIONS}/${autoId("own")}`, { roleTitle: "Researcher" }),
      ],
      "member: points it at a laboratory afterwards": [
        "denied",
        update("member", `${AFFILIATIONS}/${autoId("own")}`, { laboratoryId: OWN_LABORATORY }),
      ],
      "member: writes an affiliation of another person": [
        "denied",
        create(
          "member",
          `persons/${OWNER_PERSON}/affiliations/${autoId("forged")}`,
          affiliation({ personId: OWNER_PERSON }),
        ),
      ],
      "otherCoordinator: lists the affiliations with its laboratory": [
        "allowed",
        listAcrossParents("otherCoordinator", "affiliations", where("laboratoryId", "==", OTHER_LABORATORY), limit(20)),
      ],
    });
  });

  it("does not name a laboratory in which the person has no member entry", async () => {
    await expectOutcomes({
      "member: affiliates itself with the owning laboratory": [
        "denied",
        create("member", `${AFFILIATIONS}/${autoId("claimed-own")}`, affiliation({ laboratoryId: OWN_LABORATORY })),
      ],
      "member: affiliates itself with the other laboratory as its principal investigator": [
        "denied",
        create(
          "member",
          `${AFFILIATIONS}/${autoId("claimed-other")}`,
          affiliation({ laboratoryId: OTHER_LABORATORY, roleTitle: "Principal investigator", isPrimary: true }),
        ),
      ],
    });
  });

  it("does not name a laboratory or an institution that does not exist", async () => {
    await expectOutcomes({
      "member: affiliates itself with a laboratory that no document describes": [
        "denied",
        create(
          "member",
          `${AFFILIATIONS}/${autoId("dangling")}`,
          affiliation({ laboratoryId: "lab-synthetic-that-does-not-exist" }),
        ),
      ],
      "member: affiliates itself with an institution that no document describes": [
        "denied",
        create(
          "member",
          `${AFFILIATIONS}/${autoId("dangling-institution")}`,
          affiliation({ institutionId: "institution-synthetic-that-does-not-exist", isPrimary: true }),
        ),
      ],
      // An institution that exists may be named: where a person works is for the person to say.
      "member: affiliates itself with an institution of the registry": [
        "allowed",
        create("member", `${AFFILIATIONS}/${autoId("institution")}`, affiliation({ institutionId: "institution-1" })),
      ],
    });
  });
});
