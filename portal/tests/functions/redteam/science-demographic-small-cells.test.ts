// Red-team attacks on the demographic aggregates of the analysis views (requirement R15.10,
// docs/SECURITY.md, section 2, D-006), made through the functions emulator. The aggregates are
// meant to show how a group is composed without pointing at anyone: a count below the threshold
// is suppressed. A reader who holds the named grant asks for the counts of a laboratory so small
// that the suppressed cells, their categories and the number of people in the scope give away
// the value of each person, without the per-person read that `getPersonDemographics` audits.
//
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts and people, and invented category labels.
import { COLLECTIONS, getDemographicAggregatesContract, SMALL_CELL_THRESHOLD } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";
import { adminDb } from "../../support/admin";
import { recordConsent } from "../../support/consent";
import {
  account,
  administrator,
  call,
  codeOf,
  grantCapability,
  laboratory,
  person,
  resetWorld,
  standard,
  withoutTriggers,
} from "../support";

const LAB_ONE = "lab-redteam-demographics-one";
const LAB_FEW = "lab-redteam-demographics-few";

withoutTriggers();
beforeEach(resetWorld);

async function peopleOf(laboratoryId: string, categories: readonly string[]): Promise<void> {
  for (const [index, category] of categories.entries()) {
    const id = `${laboratoryId}-person-${index}`;
    await person(id, [], { laboratoryIds: [laboratoryId] });
    await adminDb.doc(COLLECTIONS.personDemographics.docPath(id)).set({
      ...standard(),
      genderCategory: category,
      recordedAt: Timestamp.now(),
    });
    await recordConsent(id);
  }
}

describe("the demographic aggregates of a small laboratory", () => {
  it("are refused to a member without the named grant", async () => {
    await laboratory(LAB_FEW);
    await peopleOf(LAB_FEW, ["syntheticCategoryA", "syntheticCategoryA", "syntheticCategoryA"]);
    const member = await account("uid-redteam-demographics-member");
    const admin = await administrator("uid-redteam-demographics-admin-nogrant");
    for (const caller of [member, admin]) {
      expect(
        await codeOf(
          call(caller, getDemographicAggregatesContract, {
            field: "genderCategory",
            scopeType: "laboratory",
            scopeId: LAB_FEW,
          }),
        ),
      ).toBe("permission-denied");
    }
  });

  it("do not give away the value of the one person of a laboratory", async () => {
    await laboratory(LAB_ONE);
    await peopleOf(LAB_ONE, ["syntheticCategoryB"]);
    const reader = await administrator("uid-redteam-demographics-reader");
    await grantCapability(reader.uid, "demographics.read");
    const served = await call(reader, getDemographicAggregatesContract, {
      field: "genderCategory",
      scopeType: "laboratory",
      scopeId: LAB_ONE,
    });
    // A scope smaller than the threshold names no category at all: one suppressed cell beside a
    // count of one person is that person's value.
    const named = served.cells.map((cell) => cell.category);
    expect({ people: served.people, named }).not.toEqual({ people: 1, named: ["syntheticCategoryB"] });
    expect(served.cells.filter((cell) => cell.count === null).map((cell) => cell.category)).not.toContain(
      "syntheticCategoryB",
    );
  });

  it("do not give away a value that every person of a laboratory shares, below the threshold", async () => {
    await laboratory(LAB_FEW);
    const few = Array.from({ length: SMALL_CELL_THRESHOLD - 2 }, () => "syntheticCategoryC");
    await peopleOf(LAB_FEW, few);
    const reader = await administrator("uid-redteam-demographics-reader");
    await grantCapability(reader.uid, "demographics.read");
    const served = await call(reader, getDemographicAggregatesContract, {
      field: "genderCategory",
      scopeType: "laboratory",
      scopeId: LAB_FEW,
    });
    // Only one category is present, and its cell is suppressed: the category and the number of
    // people in the scope together state that each of the three people is in it.
    const onlyCategory = served.cells.length === 1 ? served.cells[0]?.category : null;
    expect(onlyCategory === "syntheticCategoryC" && served.people === few.length).toBe(false);
  });
});
