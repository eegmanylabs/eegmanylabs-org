// Unit tests of the table of withheld outputs: what a run writes, and what it refuses.
import { describe, expect, it } from "vitest";
import { ToolRefusal } from "../environment";
import { DEFAULT_TARGET, requireReleased, WITHHELD_OUTPUT_KEYS, WITHHELD_OUTPUTS, writesWithheld } from "./withheld";

describe("the withheld outputs", () => {
  it("name the question of the migration plan that each waits for", () => {
    expect(Object.fromEntries(WITHHELD_OUTPUT_KEYS.map((key) => [key, WITHHELD_OUTPUTS[key].question]))).toEqual({
      candidateStudies: 9,
      replicatedLabels: 7,
      predictionMarketMaterial: 22,
      contributorLists: 10,
      demographics: 20,
    });
  });

  const withheld = WITHHELD_OUTPUT_KEYS.filter((output) => WITHHELD_OUTPUTS[output].releasedBy === null);
  const released = WITHHELD_OUTPUT_KEYS.filter((output) => WITHHELD_OUTPUTS[output].releasedBy !== null);

  it("release what the answers of 13 November 2026 let through, and name the decision that did", () => {
    expect(released).toEqual(["replicatedLabels", "predictionMarketMaterial", "contributorLists", "demographics"]);
    expect(withheld).toEqual(["candidateStudies"]);
    for (const output of released) {
      expect(WITHHELD_OUTPUTS[output].releasedBy).toEqual({
        decidedBy: "programmeLead",
        decidedOn: "2026-11-13",
        reference: `docs/MIGRATION_PLAN.md, section 11, question ${WITHHELD_OUTPUTS[output].question}`,
      });
    }
  });

  it("write a released output on every run, a real project included", () => {
    for (const output of released) {
      expect(writesWithheld(DEFAULT_TARGET, output), output).toBe(true);
      expect(writesWithheld({ production: true, rehearse: [] }, output), output).toBe(true);
      expect(() => requireReleased({ production: true, rehearse: [] }, output, "x")).not.toThrow();
    }
  });

  it("are written by no run unless an emulator rehearses them", () => {
    for (const output of withheld) {
      expect(writesWithheld(DEFAULT_TARGET, output), output).toBe(false);
      expect(writesWithheld({ production: false, rehearse: [output] }, output), output).toBe(true);
    }
    expect(writesWithheld({ production: false, rehearse: ["replicatedLabels"] }, "candidateStudies")).toBe(false);
  });

  it("never reach a real project, whatever the configuration names for rehearsal", () => {
    for (const output of withheld) {
      expect(writesWithheld({ production: true, rehearse: WITHHELD_OUTPUT_KEYS }, output), output).toBe(false);
    }
  });

  it("refuse the apply of an importer whose output is withheld, and say which question it waits for", () => {
    expect(() =>
      requireReleased({ production: false, rehearse: ["candidateStudies"] }, "candidateStudies", "d"),
    ).not.toThrow();
    expect(() => requireReleased(DEFAULT_TARGET, "candidateStudies", "d")).toThrow(ToolRefusal);
    expect(() => requireReleased(DEFAULT_TARGET, "candidateStudies", "d")).toThrow(/question 9/);
    expect(() => requireReleased(DEFAULT_TARGET, "candidateStudies", "d")).toThrow(/"rehearse"/);
    const production = { production: true, rehearse: WITHHELD_OUTPUT_KEYS };
    expect(() => requireReleased(production, "candidateStudies", "d")).toThrow(/question 9/);
    expect(() => requireReleased(production, "candidateStudies", "d")).toThrow(/reviewed change/);
  });

  it("release the links and null-significance labels of the prediction market, which the plan writes sealed", () => {
    expect(() => requireReleased({ production: true, rehearse: [] }, "predictionMarketMaterial", "e")).not.toThrow();
    expect(WITHHELD_OUTPUTS.predictionMarketMaterial.releasedBy.reference).toBe(
      "docs/MIGRATION_PLAN.md, section 11, question 22",
    );
  });

  it("release the member rows of source G, whose values the plan stores for consenting people alone", () => {
    expect(() => requireReleased({ production: true, rehearse: [] }, "demographics", "g")).not.toThrow();
  });
});
