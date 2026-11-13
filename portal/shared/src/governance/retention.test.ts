import { describe, expect, it } from "vitest";
import { RETENTION_TARGETS, retentionDecisions, reviewPeriodOf } from "./retention";

const NOW = new Date("2026-11-13T12:00:00Z");

describe("the decisions of a retention sweep", () => {
  it("delete nothing where no period is configured", () => {
    const decisions = retentionDecisions({}, NOW);
    expect(decisions.map((decision) => decision.target)).toEqual([...RETENTION_TARGETS]);
    expect(decisions.every((decision) => decision.cutoff === null && decision.periodDays === null)).toBe(true);
  });

  it("set a cutoff from a configured period and ignore a period out of range", () => {
    const decisions = retentionDecisions({ mail: 30, activity: 3, recents: 12.5, auditEvents: 30 }, NOW);
    const mail = decisions.find((decision) => decision.target === "mail");
    expect(mail?.cutoff?.toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(decisions.find((decision) => decision.target === "activity")?.cutoff).toBeNull();
    expect(decisions.find((decision) => decision.target === "recents")?.cutoff).toBeNull();
    expect(decisions.some((decision) => (decision.target as string) === "auditEvents")).toBe(false);
  });
});

describe("the period of an access review", () => {
  it("is the quarter of the year", () => {
    expect(reviewPeriodOf(NOW)).toBe("2026-Q4");
    expect(reviewPeriodOf(new Date("2027-01-01T00:00:00Z"))).toBe("2027-Q1");
  });
});
