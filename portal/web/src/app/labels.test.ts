// How a decision of the programme is named in the interface. The decisions are those recorded in
// shared/src/programme-answers.ts, which hold no personal data.
import { migrationAnswer, programmeAnswer } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { decisionDay, decisionReference } from "./labels";

describe("the words for a decision of the programme", () => {
  it("names the day in full and the question, and no path of the documentation", () => {
    expect(decisionReference(migrationAnswer(1))).toBe("Programme decisions of 13 November 2026, migration question 1");
    expect(decisionReference(programmeAnswer(7))).toBe("Programme decisions of 13 November 2026, decision 7");
    expect(decisionReference(migrationAnswer(1))).not.toContain("docs/");
  });

  it("shows the day as the interface shows days", () => {
    expect(decisionDay(migrationAnswer(3))).toBe("13 Nov 2026");
  });
});
