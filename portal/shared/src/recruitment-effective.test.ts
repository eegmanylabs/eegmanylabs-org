import { describe, expect, it } from "vitest";
import {
  endOfPreviousMonth,
  liveReports,
  monthEnds,
  type ReportFact,
  reportStanding,
  resolveAll,
  resolvedValue,
  resolveParticipation,
  supersededIds,
} from "./recruitment-effective";

// Synthetic reports of one invented participation and its neighbour.
const P = "SyntheticStudy2001__lab-a";
const Q = "SyntheticStudy2001__lab-b";

let clock = 0;
/** A report filed after every report made before it, unless a time is given. */
function report(fields: Partial<ReportFact> & Pick<ReportFact, "id" | "asOfDate">): ReportFact {
  clock += 1000;
  return {
    participationId: P,
    reportKind: "cumulative",
    basis: "labReported",
    entryKind: "new",
    counts: {},
    exclusions: [],
    createdAtMillis: clock,
    dataOrigin: "live",
    ...fields,
  };
}

const value = (
  state: ReturnType<typeof resolveParticipation>,
  lens: "reported" | "verified" | "effective",
  modality: "main" | "rest" | "participants",
  category: string,
) => resolvedValue(state[lens], modality, category)?.value;

describe("liveReports", () => {
  it("drops the report that a correction names and keeps the correction", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01", counts: { main: { tested: 10 } } });
    const correction = report({
      id: "r2",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r1",
      counts: { main: { tested: 9 } },
    });
    expect(liveReports([first, correction]).map((item) => item.id)).toEqual(["r2"]);
  });

  it("drops a void and the report it withdraws", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01", counts: { main: { tested: 10 } } });
    const voided = report({ id: "r2", asOfDate: "2026-03-01", entryKind: "void", correctsReportId: "r1" });
    expect(liveReports([first, voided])).toEqual([]);
  });

  it("follows a chain of corrections to the last one", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01", counts: { main: { tested: 10 } } });
    const second = report({
      id: "r2",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r1",
      counts: { main: { tested: 9 } },
    });
    const third = report({
      id: "r3",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r2",
      counts: { main: { tested: 8 } },
    });
    expect(liveReports([third, first, second]).map((item) => item.id)).toEqual(["r3"]);
    expect([...supersededIds([first, second, third])].sort()).toEqual(["r1", "r2"]);
  });

  it("does not bring a corrected report back when its correction is withdrawn", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01", counts: { main: { tested: 10 } } });
    const correction = report({
      id: "r2",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r1",
      counts: { main: { tested: 9 } },
    });
    const voided = report({ id: "r3", asOfDate: "2026-03-01", entryKind: "void", correctsReportId: "r2" });
    expect(liveReports([first, correction, voided])).toEqual([]);
  });

  it("orders by date, then by the time of filing, then by identifier, whatever the input order", () => {
    const a = report({ id: "b", asOfDate: "2026-03-02", createdAtMillis: 5 });
    const b = report({ id: "a", asOfDate: "2026-03-02", createdAtMillis: 5 });
    const c = report({ id: "c", asOfDate: "2026-03-01", createdAtMillis: 9 });
    const d = report({ id: "d", asOfDate: "2026-03-02", createdAtMillis: 1 });
    expect(liveReports([a, b, c, d]).map((item) => item.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("counts only what was known at a time, corrections included", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01", createdAtMillis: 100 });
    const correction = report({
      id: "r2",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r1",
      createdAtMillis: 200,
    });
    expect(liveReports([first, correction], 150).map((item) => item.id)).toEqual(["r1"]);
    expect(liveReports([first, correction], 200).map((item) => item.id)).toEqual(["r2"]);
  });
});

describe("resolveParticipation", () => {
  it("keeps main experiment, resting state and unique participants apart and adds none of them", () => {
    const state = resolveParticipation(
      P,
      [
        report({
          id: "r1",
          asOfDate: "2026-03-01",
          counts: { main: { tested: 12 }, rest: { tested: 10 }, participants: { tested: 14 } },
        }),
      ],
      { date: "2026-03-31" },
    );
    expect(value(state, "reported", "main", "tested")).toBe(12);
    expect(value(state, "reported", "rest", "tested")).toBe(10);
    expect(value(state, "reported", "participants", "tested")).toBe(14);
    expect(Object.keys(state.reported).sort()).toEqual(["main", "participants", "rest"]);
  });

  it("leaves a key that no report states unknown, never zero", () => {
    const state = resolveParticipation(
      P,
      [report({ id: "r1", asOfDate: "2026-03-01", counts: { main: { tested: 0 } } })],
      {
        date: "2026-03-31",
      },
    );
    expect(value(state, "reported", "main", "tested")).toBe(0);
    expect(value(state, "reported", "main", "usable")).toBeUndefined();
    expect(value(state, "reported", "rest", "tested")).toBeUndefined();
    expect(state.verified).toEqual({});
  });

  it("is entirely unknown for a participation without reports", () => {
    const state = resolveParticipation(P, [], { date: "2026-03-31" });
    expect(state.reported).toEqual({});
    expect(state.effective).toEqual({});
    expect(state.latestAsOfDate).toBeNull();
    expect(state.exclusions).toEqual({ labReported: null, centrallyVerified: null });
  });

  it("takes each key from the latest report that states it, so a partial report keeps older values", () => {
    const reports = [
      report({ id: "r1", asOfDate: "2026-02-01", counts: { main: { tested: 5, recorded: 4 } } }),
      report({ id: "r2", asOfDate: "2026-03-01", counts: { main: { tested: 8 } } }),
    ];
    const state = resolveParticipation(P, reports, { date: "2026-03-31" });
    expect(resolvedValue(state.reported, "main", "tested")).toMatchObject({
      value: 8,
      reportId: "r2",
      asOfDate: "2026-03-01",
    });
    expect(resolvedValue(state.reported, "main", "recorded")).toMatchObject({
      value: 4,
      reportId: "r1",
      asOfDate: "2026-02-01",
    });
  });

  it("prefers the report filed later where two hold for the same date", () => {
    const reports = [
      report({ id: "late", asOfDate: "2026-03-01", createdAtMillis: 20, counts: { main: { tested: 7 } } }),
      report({ id: "early", asOfDate: "2026-03-01", createdAtMillis: 10, counts: { main: { tested: 6 } } }),
    ];
    expect(value(resolveParticipation(P, reports, { date: "2026-03-01" }), "reported", "main", "tested")).toBe(7);
  });

  it("reconstructs the state at a past date from the reports dated on or before it", () => {
    const reports = [
      report({ id: "jan", asOfDate: "2026-01-20", counts: { main: { tested: 3 } } }),
      report({ id: "feb", asOfDate: "2026-02-20", counts: { main: { tested: 9 } } }),
      report({ id: "mar", asOfDate: "2026-03-20", counts: { main: { tested: 15 } } }),
    ];
    expect(
      value(resolveParticipation(P, reports, { date: "2026-01-19" }), "reported", "main", "tested"),
    ).toBeUndefined();
    expect(value(resolveParticipation(P, reports, { date: "2026-01-31" }), "reported", "main", "tested")).toBe(3);
    expect(value(resolveParticipation(P, reports, { date: "2026-02-28" }), "reported", "main", "tested")).toBe(9);
    expect(value(resolveParticipation(P, reports, { date: "2026-02-20" }), "reported", "main", "tested")).toBe(9);
    expect(value(resolveParticipation(P, reports, { date: "2026-12-31" }), "reported", "main", "tested")).toBe(15);
  });

  it("applies a later correction to a past date, and reproduces the uncorrected value with knownAt", () => {
    const original = report({
      id: "feb",
      asOfDate: "2026-02-20",
      createdAtMillis: 100,
      counts: { main: { tested: 9 } },
    });
    const correction = report({
      id: "feb-fix",
      asOfDate: "2026-02-20",
      createdAtMillis: 500,
      entryKind: "correction",
      correctsReportId: "feb",
      counts: { main: { tested: 8 } },
    });
    const reports = [original, correction];
    expect(value(resolveParticipation(P, reports, { date: "2026-02-28" }), "reported", "main", "tested")).toBe(8);
    expect(
      value(resolveParticipation(P, reports, { date: "2026-02-28", knownAtMillis: 300 }), "reported", "main", "tested"),
    ).toBe(9);
  });

  it("uses the date of a correction, so a correction that moves a report to a later date removes it from earlier dates", () => {
    const original = report({ id: "r1", asOfDate: "2026-02-01", counts: { main: { tested: 4 } } });
    const moved = report({
      id: "r2",
      asOfDate: "2026-03-01",
      entryKind: "correction",
      correctsReportId: "r1",
      counts: { main: { tested: 4 } },
    });
    expect(
      value(resolveParticipation(P, [original, moved], { date: "2026-02-15" }), "reported", "main", "tested"),
    ).toBeUndefined();
    expect(
      value(resolveParticipation(P, [original, moved], { date: "2026-03-15" }), "reported", "main", "tested"),
    ).toBe(4);
  });

  it("falls back to the previous report when the latest is withdrawn", () => {
    const reports = [
      report({ id: "r1", asOfDate: "2026-02-01", counts: { main: { tested: 4 } } }),
      report({ id: "r2", asOfDate: "2026-03-01", counts: { main: { tested: 40 } } }),
      report({ id: "r3", asOfDate: "2026-03-02", entryKind: "void", correctsReportId: "r2" }),
    ];
    const state = resolveParticipation(P, reports, { date: "2026-03-31" });
    expect(resolvedValue(state.reported, "main", "tested")).toMatchObject({ value: 4, reportId: "r1" });
    expect(state.latestAsOfDate).toBe("2026-02-01");
  });

  it("keeps lab-reported and centrally verified values apart and shows both", () => {
    const reports = [
      report({ id: "lab", asOfDate: "2026-03-01", counts: { main: { tested: 12 } } }),
      report({
        id: "check",
        asOfDate: "2026-03-01",
        basis: "centrallyVerified",
        verifiesReportId: "lab",
        counts: { main: { tested: 11 } },
      }),
    ];
    const state = resolveParticipation(P, reports, { date: "2026-03-31" });
    expect(value(state, "reported", "main", "tested")).toBe(12);
    expect(value(state, "verified", "main", "tested")).toBe(11);
    expect(resolvedValue(state.effective, "main", "tested")).toMatchObject({ value: 11, basis: "centrallyVerified" });
  });

  it("prefers a verified value only while it holds for the same or a later date than the lab's", () => {
    const reports = [
      report({ id: "lab-1", asOfDate: "2026-03-01", counts: { main: { tested: 12, recorded: 10 } } }),
      report({
        id: "check",
        asOfDate: "2026-03-01",
        basis: "centrallyVerified",
        verifiesReportId: "lab-1",
        counts: { main: { tested: 11 } },
      }),
      report({ id: "lab-2", asOfDate: "2026-04-01", counts: { main: { tested: 20 } } }),
    ];
    const march = resolveParticipation(P, reports, { date: "2026-03-31" });
    expect(resolvedValue(march.effective, "main", "tested")).toMatchObject({ value: 11, basis: "centrallyVerified" });
    // A key the verification does not state stays lab-reported.
    expect(resolvedValue(march.effective, "main", "recorded")).toMatchObject({ value: 10, basis: "labReported" });
    const april = resolveParticipation(P, reports, { date: "2026-04-30" });
    expect(resolvedValue(april.effective, "main", "tested")).toMatchObject({ value: 20, basis: "labReported" });
    expect(value(april, "verified", "main", "tested")).toBe(11);
  });

  it("lets a correction of a verification replace it and a void withdraw it", () => {
    const lab = report({ id: "lab", asOfDate: "2026-03-01", counts: { main: { tested: 12 } } });
    const check = report({
      id: "check",
      asOfDate: "2026-03-01",
      basis: "centrallyVerified",
      verifiesReportId: "lab",
      counts: { main: { tested: 11 } },
    });
    const recheck = report({
      id: "recheck",
      asOfDate: "2026-03-01",
      basis: "centrallyVerified",
      entryKind: "correction",
      correctsReportId: "check",
      counts: { main: { tested: 10 } },
    });
    expect(
      value(resolveParticipation(P, [lab, check, recheck], { date: "2026-03-31" }), "effective", "main", "tested"),
    ).toBe(10);
    const withdrawn = report({
      id: "withdrawn",
      asOfDate: "2026-03-01",
      basis: "centrallyVerified",
      entryKind: "void",
      correctsReportId: "recheck",
    });
    const state = resolveParticipation(P, [lab, check, recheck, withdrawn], { date: "2026-03-31" });
    expect(state.verified).toEqual({});
    expect(resolvedValue(state.effective, "main", "tested")).toMatchObject({ value: 12, basis: "labReported" });
  });

  it("never adds a period report to a cumulative value, and lists it apart", () => {
    const reports = [
      report({ id: "cumulative", asOfDate: "2026-03-01", counts: { main: { tested: 12 } } }),
      report({
        id: "march",
        asOfDate: "2026-03-31",
        reportKind: "period",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        counts: { main: { tested: 5 } },
      }),
    ];
    const state = resolveParticipation(P, reports, { date: "2026-04-30" });
    expect(value(state, "reported", "main", "tested")).toBe(12);
    expect(state.periods.map((item) => item.id)).toEqual(["march"]);
    expect(state.latestAsOfDate).toBe("2026-03-31");
    expect(resolveParticipation(P, reports, { date: "2026-03-15" }).periods).toEqual([]);
  });

  it("takes the exclusions of the latest live cumulative report of each basis that lists any", () => {
    const reports = [
      report({
        id: "r1",
        asOfDate: "2026-02-01",
        counts: { main: { excluded: 2 } },
        exclusions: [{ modality: "main", reasonTermId: "exclusionReason__artefacts", count: 2 }],
      }),
      report({ id: "r2", asOfDate: "2026-03-01", counts: { main: { tested: 9 } } }),
    ];
    const state = resolveParticipation(P, reports, { date: "2026-03-31" });
    expect(state.exclusions.labReported).toMatchObject({ reportId: "r1", asOfDate: "2026-02-01" });
    expect(state.exclusions.centrallyVerified).toBeNull();
  });

  it("ignores the reports of other participations", () => {
    const reports = [
      report({ id: "own", asOfDate: "2026-03-01", counts: { main: { tested: 3 } } }),
      report({ id: "other", participationId: Q, asOfDate: "2026-03-01", counts: { main: { tested: 30 } } }),
    ];
    const states = resolveAll([P, Q, "SyntheticStudy2001__lab-c"], reports, { date: "2026-03-31" });
    expect(resolvedValue(states.get(P)?.reported ?? {}, "main", "tested")?.value).toBe(3);
    expect(resolvedValue(states.get(Q)?.reported ?? {}, "main", "tested")?.value).toBe(30);
    expect(states.get("SyntheticStudy2001__lab-c")?.reported).toEqual({});
  });

  it("carries the origin of each value", () => {
    const reports = [
      report({ id: "demo", asOfDate: "2026-03-01", dataOrigin: "demo", counts: { rest: { usable: 1 } } }),
    ];
    expect(
      resolvedValue(resolveParticipation(P, reports, { date: "2026-03-01" }).reported, "rest", "usable")?.dataOrigin,
    ).toBe("demo");
  });
});

describe("reportStanding", () => {
  it("names the report that corrected or withdrew another", () => {
    const first = report({ id: "r1", asOfDate: "2026-03-01" });
    const fix = report({ id: "r2", asOfDate: "2026-03-01", entryKind: "correction", correctsReportId: "r1" });
    const voided = report({ id: "r3", asOfDate: "2026-03-01", entryKind: "void", correctsReportId: "r2" });
    const all = [first, fix, voided];
    expect(reportStanding(first, all)).toEqual({ kind: "corrected", byReportId: "r2" });
    expect(reportStanding(fix, all)).toEqual({ kind: "voided", byReportId: "r3" });
    expect(reportStanding(voided, all)).toEqual({ kind: "live" });
  });
});

describe("month ends", () => {
  it("lists the last day of every month, with the end date for its own month", () => {
    expect(monthEnds("2026-01-15", "2026-04-10")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-10"]);
    expect(monthEnds("2027-12-01", "2028-02-29")).toEqual(["2027-12-31", "2028-01-31", "2028-02-29"]);
    expect(monthEnds("2026-05-01", "2026-04-01")).toEqual([]);
  });

  it("finds the end of the previous month", () => {
    expect(endOfPreviousMonth("2026-03-15")).toBe("2026-02-28");
    expect(endOfPreviousMonth("2028-03-01")).toBe("2028-02-29");
    expect(endOfPreviousMonth("2026-01-10")).toBe("2025-12-31");
  });
});
