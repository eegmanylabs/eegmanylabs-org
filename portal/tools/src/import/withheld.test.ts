// Unit tests of the table of withheld outputs: what a run writes, and what it refuses.
import { describe, expect, it } from "vitest";
import { ToolRefusal } from "../environment";
import { DEFAULT_TARGET, requireReleased, WITHHELD_OUTPUT_KEYS, WITHHELD_OUTPUTS, writesWithheld } from "./withheld";

describe("the withheld outputs", () => {
  it("name the question of the migration plan that each waits for", () => {
    expect(Object.fromEntries(WITHHELD_OUTPUT_KEYS.map((key) => [key, WITHHELD_OUTPUTS[key].question]))).toEqual({
      candidateStudies: 9,
      replicatedLabels: 7,
      contributorLists: 10,
      demographics: 20,
    });
  });

  it("are written by no run unless an emulator rehearses them", () => {
    for (const output of WITHHELD_OUTPUT_KEYS) {
      expect(writesWithheld(DEFAULT_TARGET, output), output).toBe(false);
      expect(writesWithheld({ production: false, rehearse: [output] }, output), output).toBe(true);
    }
    expect(writesWithheld({ production: false, rehearse: ["candidateStudies"] }, "demographics")).toBe(false);
  });

  it("never reach a real project, whatever the configuration names for rehearsal", () => {
    for (const output of WITHHELD_OUTPUT_KEYS) {
      expect(writesWithheld({ production: true, rehearse: WITHHELD_OUTPUT_KEYS }, output), output).toBe(false);
    }
  });

  it("refuse the apply of an importer whose output is withheld, and say which question it waits for", () => {
    expect(() => requireReleased({ production: false, rehearse: ["contributorLists"] }, "contributorLists", "x")).not.toThrow();
    expect(() => requireReleased(DEFAULT_TARGET, "contributorLists", "ctable-0123")).toThrow(ToolRefusal);
    expect(() => requireReleased(DEFAULT_TARGET, "contributorLists", "ctable-0123")).toThrow(/question 10/);
    expect(() => requireReleased(DEFAULT_TARGET, "contributorLists", "ctable-0123")).toThrow(/"rehearse"/);
    const production = { production: true, rehearse: WITHHELD_OUTPUT_KEYS };
    expect(() => requireReleased(production, "demographics", "g")).toThrow(/question 20/);
    expect(() => requireReleased(production, "demographics", "g")).toThrow(/reviewed change/);
  });
});
