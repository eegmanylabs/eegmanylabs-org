import { describe, expect, it } from "vitest";
import type { ReportFact } from "./recruitment-effective";
import {
  defaultAssumptions,
  FORECAST_METHOD_VERSION,
  type ForecastAssumptions,
  forecastRecruitment,
  forecastRunMaps,
  readForecastRun,
} from "./recruitment-forecast";
import type { ParticipationFacts } from "./recruitment-rollup";
import { shiftIsoDate } from "./recurrence";

// A synthetic replication: one laboratory that grows by exactly half a participant a day, and
// one that has reported once.
const FAST: ParticipationFacts = {
  id: "StudyF__lab-fast",
  replicationId: "StudyF",
  laboratoryId: "lab-fast",
  status: "collecting",
  countryCode: "GB",
  institutionId: null,
  targetNMain: 100,
  targetNRest: null,
};
const NEW: ParticipationFacts = { ...FAST, id: "StudyF__lab-new", laboratoryId: "lab-new", targetNMain: null };

let clock = 0;
const report = (participationId: string, id: string, asOfDate: string, tested: number): ReportFact => {
  clock += 1;
  return {
    id,
    participationId,
    asOfDate,
    reportKind: "cumulative",
    basis: "labReported",
    entryKind: "new",
    counts: { main: { tested } },
    exclusions: [],
    createdAtMillis: clock,
    dataOrigin: "live",
  };
};

const REPORTS = [
  report(FAST.id, "f1", "2025-12-01", 0),
  report(FAST.id, "f2", "2026-02-01", 30),
  report(FAST.id, "f3", "2026-03-31", 60),
  report(NEW.id, "n1", "2026-03-20", 5),
];

const BASE: ForecastAssumptions = {
  modality: "main",
  category: "tested",
  target: 100,
  exclusionRate: 0,
  windowDays: 120,
  scenarioSpread: 0.25,
  activeParticipationIds: [FAST.id, NEW.id],
  includePlannedPauses: true,
  inputsAsOf: "2026-03-31",
};

describe("forecastRecruitment", () => {
  it("projects completion from the observed rate in each scenario", () => {
    const result = forecastRecruitment([FAST, NEW], REPORTS, [], BASE);
    expect(result.methodVersion).toBe(FORECAST_METHOD_VERSION);
    expect(result.current).toBe(65);
    expect(result.aim).toBe(100);
    const fast = result.laboratories.find((laboratory) => laboratory.participationId === FAST.id);
    expect(fast).toMatchObject({ rate: 0.5, rateFrom: "2025-12-01", rateTo: "2026-03-31", current: 60 });
    // 35 to go: 70 days at 0.5, 56 at 0.625, 94 (93.3) at 0.375.
    expect(result.scenarios.central.completionDate).toBe(shiftIsoDate("2026-03-31", 70));
    expect(result.scenarios.optimistic.completionDate).toBe(shiftIsoDate("2026-03-31", 56));
    expect(result.scenarios.conservative.completionDate).toBe(shiftIsoDate("2026-03-31", 94));
    expect(result.scenarios.central.dailyRate).toBe(0.5);
    expect(result.scenarios.optimistic.rateMultiplier).toBe(1.25);
  });

  it("gives a range from the slower and the faster half of the window", () => {
    const result = forecastRecruitment([FAST], REPORTS, [], { ...BASE, windowDays: 100 });
    const fast = result.laboratories[0];
    // First half: 0 on 1 December to 30 on 1 February. Second half: 30 to 60 by 31 March.
    expect(fast?.rateLow).toBeCloseTo(30 / 62);
    expect(fast?.rateHigh).toBeCloseTo(30 / 58);
    const central = result.scenarios.central;
    const dates = [central.earliestCompletionDate, central.completionDate, central.latestCompletionDate];
    expect(dates.every((date) => date !== null)).toBe(true);
    expect([...dates].sort()).toEqual(dates);
  });

  it("aims higher to make up for expected exclusions", () => {
    const result = forecastRecruitment([FAST], REPORTS, [], { ...BASE, exclusionRate: 0.2 });
    // 125 to count before exclusions, 65 to go at 0.5 a day.
    expect(result.aim).toBe(125);
    expect(result.scenarios.central.completionDate).toBe(shiftIsoDate("2026-03-31", 130));
  });

  it("adds nothing on the days of a planned pause, unless pauses are left out", () => {
    const pause = { participationId: FAST.id, startsOn: "2026-04-01", endsOn: "2026-04-10" };
    const paused = forecastRecruitment([FAST], REPORTS, [pause], BASE);
    expect(paused.scenarios.central.completionDate).toBe(shiftIsoDate("2026-03-31", 90));
    expect(paused.laboratories[0]?.pausedDays).toBe(10);
    const ignored = forecastRecruitment([FAST], REPORTS, [pause], { ...BASE, includePlannedPauses: false });
    expect(ignored.scenarios.central.completionDate).toBe(shiftIsoDate("2026-03-31", 80));
    expect(ignored.laboratories[0]?.pausedDays).toBe(0);
  });

  it("counts only the active participations, and states an unknown rate as unknown, never as zero", () => {
    const result = forecastRecruitment([FAST, NEW], REPORTS, [], { ...BASE, activeParticipationIds: [NEW.id] });
    expect(result.scenarios.central.completionDate).toBeNull();
    expect(result.scenarios.central.dailyRate).toBeNull();
    expect(result.scenarios.optimistic.dailyRate).toBeNull();
    expect(result.scenarios.central.series).toEqual([]);
    expect(result.notes.some((note) => note.includes("fewer than two dated values"))).toBe(true);
    expect(result.notes.some((note) => note.includes("the rate and the completion are unknown"))).toBe(true);
  });

  it("takes the agreed targets where no target is stated, and says when one is missing", () => {
    const result = forecastRecruitment([FAST, NEW], REPORTS, [], { ...BASE, target: null });
    expect(result.target).toBe(100);
    expect(result.targetBasis).toBe("agreedIncomplete");
    expect(forecastRecruitment([FAST], REPORTS, [], { ...BASE, target: null }).targetBasis).toBe("agreed");
  });

  it("projects no completion without a target", () => {
    const result = forecastRecruitment([NEW], REPORTS, [], { ...BASE, target: null });
    expect(result.target).toBeNull();
    expect(result.aim).toBeNull();
    expect(result.scenarios.central.completionDate).toBeNull();
    expect(result.notes).toContain("No target is known, so no completion date can be projected.");
  });

  it("is complete on the day of its inputs when the aim is reached already", () => {
    expect(forecastRecruitment([FAST], REPORTS, [], { ...BASE, target: 50 }).scenarios.central.completionDate).toBe(
      "2026-03-31",
    );
  });

  it("reads the reports as they stood on the date of its inputs, and counts a missing current value as nothing", () => {
    const result = forecastRecruitment([FAST, NEW], REPORTS, [], { ...BASE, inputsAsOf: "2026-02-28" });
    expect(result.current).toBe(30);
    expect(result.currentKnown).toBe(1);
    expect(result.currentExpected).toBe(2);
    expect(result.notes[0]).toContain("1 of 2 participations state no current value");
  });

  it("treats a negative rate as zero", () => {
    const corrected = [...REPORTS, report(FAST.id, "f4", "2026-04-30", 40)];
    const result = forecastRecruitment([FAST], corrected, [], { ...BASE, inputsAsOf: "2026-04-30", windowDays: 29 });
    expect(result.laboratories[0]?.rate).toBeLessThan(0);
    expect(result.scenarios.central.dailyRate).toBe(0);
    expect(result.notes).toContain("A negative rate, which a correction can produce, counts as zero.");
  });

  it("is the same for the same inputs, and its series stays within its cap", () => {
    const first = forecastRecruitment([FAST, NEW], REPORTS, [], BASE);
    const second = forecastRecruitment([FAST, NEW], [...REPORTS].reverse(), [], BASE);
    expect(second).toEqual(first);
    expect(first.scenarios.conservative.series.length).toBeLessThanOrEqual(36);
    expect(first.scenarios.central.series[0]).toMatchObject({ date: "2026-04-30" });
  });
});

describe("defaultAssumptions", () => {
  it("starts from the collecting participations and today", () => {
    expect(defaultAssumptions([FAST, { ...NEW, status: "onboarding" }], "2026-05-01")).toMatchObject({
      activeParticipationIds: [FAST.id],
      inputsAsOf: "2026-05-01",
      target: null,
      category: "tested",
    });
  });
});

describe("stored runs", () => {
  it("reads back what it stored, which holds no figure of a single laboratory", () => {
    const result = forecastRecruitment([FAST, NEW], REPORTS, [], BASE);
    const maps = forecastRunMaps(BASE, result);
    const back = readForecastRun({ methodVersion: FORECAST_METHOD_VERSION, inputsAsOf: BASE.inputsAsOf, ...maps });
    expect(back?.assumptions).toEqual(BASE);
    const { laboratories: _left, ...replicationLevel } = result;
    expect(back?.result).toEqual(replicationLevel);
    for (const field of ["laboratories", "laboratoryId", "rateFrom", "pausedDays"]) {
      expect(JSON.stringify(maps)).not.toContain(`"${field}"`);
    }
  });

  it("counts whole people: the aim rounded up and the projected series rounded down", () => {
    const result = forecastRecruitment([FAST], REPORTS, [], { ...BASE, target: 60, exclusionRate: 0.1 });
    expect(result.aim).toBe(67);
    for (const point of result.scenarios.central.series) {
      expect(Number.isInteger(point.value) && Number.isInteger(point.low) && Number.isInteger(point.high)).toBe(true);
    }
  });

  it("reads nothing from another method or another shape", () => {
    const maps = forecastRunMaps(BASE, forecastRecruitment([FAST], REPORTS, [], BASE));
    expect(readForecastRun({ methodVersion: "other/1", inputsAsOf: BASE.inputsAsOf, ...maps })).toBeNull();
    expect(
      readForecastRun({
        methodVersion: FORECAST_METHOD_VERSION,
        inputsAsOf: BASE.inputsAsOf,
        ...maps,
        assumptions: {},
      }),
    ).toBeNull();
  });
});
