// Unit tests of what the change log of an import shows for a special-category document.
// The values are invented placeholders: no real answer option appears here.
import { describe, expect, it } from "vitest";
import { specialMarker } from "./apply";
import { canonicalJson, contentHash } from "./values";

const state = (genderSource: string, ethnicitySource: string) => ({
  schemaVersion: 1,
  createdBy: "system:import",
  genderSource,
  ethnicitySource,
  sourceRecordIds: ["source-record-synthetic"],
});

describe("specialMarker", () => {
  it("says that a state exists and that it is special-category data", () => {
    expect(specialMarker(state("Synthetic option 1", "Synthetic option 2"))).toEqual({ specialCategory: true });
    expect(specialMarker(null)).toBeNull();
  });

  it("is the same for every state, so that it cannot confirm a guess of the values", () => {
    const first = specialMarker(state("Synthetic option 1", "Synthetic option 2"));
    const second = specialMarker(state("Synthetic option 3", "Synthetic option 4"));
    expect(first).toEqual(second);
  });

  it("holds no value of the state and nothing computed from one", () => {
    const secret = state("Synthetic option 1", "Synthetic option 2");
    const text = canonicalJson(specialMarker(secret));
    for (const value of Object.values(secret)) {
      if (typeof value === "string") expect(text).not.toContain(value);
    }
    // The digest that an earlier marker carried could be recomputed by anyone who guessed the values.
    expect(text).not.toContain(contentHash(secret));
    expect(Object.keys(specialMarker(secret) ?? {})).toEqual(["specialCategory"]);
  });
});
