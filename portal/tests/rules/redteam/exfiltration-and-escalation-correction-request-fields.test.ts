// Red-team attack on the promise that a correction request never carries special-category data.
//
// Whoever resolves the review queue reads every correction request, and that includes the core
// team, which does not hold `demographics.read`. The rules therefore refuse a request whose
// `field` is one of the six special-category fields. The comparison is exact: the plain words
// that a person would use for those fields, another capitalisation and a trailing space all
// pass, and the value that the person typed is then stored where the reviewers read it.
// A person corrects these values through a callable function, never through a request.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and people on the example.org domain, with a
// placeholder in place of every special-category value.
import { SPECIAL_CATEGORY_FIELDS } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, it } from "vitest";
import { type Expectations, expectOutcomes, requestsOf } from "../requests";
import { seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { autoId, MEMBER_PERSON, MEMBER_UID } from "../world";

let environment: RulesTestEnvironment;
const { create, get } = requestsOf(() => environment);

/** A request by the account `member` to correct one field of its own person. */
const request = (id: string, field: string) =>
  create("member", `correctionRequests/${autoId(id)}`, {
    uid: MEMBER_UID,
    entityType: "person",
    entityId: MEMBER_PERSON,
    field,
    proposedValue: "a synthetic special-category value",
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
  });

/** One new request for each field, under an identifier that no stored request and no other test uses. */
let filed = 0;
const refusals = (fields: readonly string[]): Expectations =>
  Object.fromEntries(
    fields.map((field) => {
      filed += 1;
      return [`names the field "${field}"`, ["denied", request(`request-redteam-${filed}`, field)] as const];
    }),
  );

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-corrections");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

describe("a correction request", () => {
  it("is refused for each special-category field by its exact name, and accepted for a directory field", async () => {
    await expectOutcomes({
      ...refusals(SPECIAL_CATEGORY_FIELDS),
      'names the field "countryCode"': ["allowed", request("request-country", "countryCode")],
      // The reviewers of the queue read what a member filed, which is why the field matters.
      "coreTeam: reads the request that the member filed": [
        "allowed",
        get("coreTeam", `correctionRequests/${autoId("request-country")}`),
      ],
    });
  });

  it("is refused for the plain names of the special categories", async () => {
    await expectOutcomes(refusals(["gender", "ethnicity", "Gender", "Ethnicity"]));
  });

  it("is refused for a special-category field written in another case or with white space around it", async () => {
    await expectOutcomes(
      refusals(["GenderSource", "gendersource", "ETHNICITYCATEGORY", "genderSource ", " ethnicitySelfDescribed"]),
    );
  });
});
