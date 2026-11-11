import { describe, expect, it } from "vitest";
import { type ReportFact, resolveAll } from "./recruitment-effective";
import {
  attritionPercent,
  completionFigure,
  importedFigures,
  milestoneAchievement,
  monthlyTrend,
  observedRate,
  type ParticipationFacts,
  rollupBy,
  rollupFigure,
  summaryTotals,
  targetFigure,
} from "./recruitment-rollup";

// A synthetic programme of two replications and three laboratories in two countries.
const participations: ParticipationFacts[] = [
  {
    id: "StudyA__lab-1",
    replicationId: "StudyA",
    laboratoryId: "lab-1",
    status: "collecting",
    countryCode: "GB",
    institutionId: "inst-1",
    targetNMain: 40,
    targetNRest: 30,
  },
  {
    id: "StudyA__lab-2",
    replicationId: "StudyA",
    laboratoryId: "lab-2",
    status: "collecting",
    countryCode: "DE",
    institutionId: null,
    targetNMain: 20,
    targetNRest: null,
  },
  {
    id: "StudyB__lab-1",
    replicationId: "StudyB",
    laboratoryId: "lab-1",
    status: "onboarding",
    countryCode: "GB",
    institutionId: "inst-1",
    targetNMain: null,
    targetNRest: null,
  },
];

let clock = 0;
function report(fields: Partial<ReportFact> & Pick<ReportFact, "id" | "participationId" | "asOfDate">): ReportFact {
  clock += 1;
  return {
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

const reports: ReportFact[] = [
  report({
    id: "a1",
    participationId: "StudyA__lab-1",
    asOfDate: "2026-02-01",
    counts: { main: { tested: 10, recorded: 10, usable: 8 }, rest: { tested: 9 }, participants: { tested: 12 } },
  }),
  report({
    id: "a1v",
    participationId: "StudyA__lab-1",
    asOfDate: "2026-02-01",
    basis: "centrallyVerified",
    verifiesReportId: "a1",
    counts: { main: { tested: 9 } },
  }),
  report({ id: "a2", participationId: "StudyA__lab-2", asOfDate: "2026-02-10", counts: { rest: { tested: 4 } } }),
];

const states = resolveAll(
  participations.map((participation) => participation.id),
  reports,
  { date: "2026-02-28" },
);

describe("rollupFigure", () => {
  it("sums one modality and one category over the participations that state it, and says it is incomplete", () => {
    const figure = rollupFigure(participations, states, "effective", "main", "tested");
    expect(figure).toMatchObject({ value: 9, known: 1, expected: 2, complete: false, bases: ["verified"] });
  });

  it("keeps the lenses apart: lab-reported alone, verified alone", () => {
    expect(rollupFigure(participations, states, "reported", "main", "tested").value).toBe(10);
    expect(rollupFigure(participations, states, "verified", "main", "tested").value).toBe(9);
    expect(rollupFigure(participations, states, "verified", "rest", "tested").value).toBeNull();
  });

  it("is unknown, never zero, where nobody states the value", () => {
    const figure = rollupFigure(participations, states, "effective", "participants", "usable");
    expect(figure.value).toBeNull();
    expect(figure.bases).toEqual([]);
    expect(figure.complete).toBe(false);
  });

  it("is complete when every expected participation states the value", () => {
    const figure = rollupFigure(participations, states, "reported", "rest", "tested");
    expect(figure).toMatchObject({ value: 13, known: 2, expected: 2, complete: true, latestAsOfDate: "2026-02-10" });
  });

  it("never adds the main experiment to the resting state: unique participants are their own figure", () => {
    const main = rollupFigure(participations, states, "reported", "main", "tested").value;
    const rest = rollupFigure(participations, states, "reported", "rest", "tested").value;
    const unique = rollupFigure(participations, states, "reported", "participants", "tested").value;
    expect([main, rest, unique]).toEqual([10, 13, 12]);
  });

  it("names a mix of bases and marks demonstration values", () => {
    const mixed = [
      ...reports,
      report({
        id: "demo",
        participationId: "StudyA__lab-2",
        asOfDate: "2026-02-11",
        dataOrigin: "demo",
        counts: { main: { tested: 2 } },
      }),
    ];
    const figure = rollupFigure(
      participations,
      resolveAll(["StudyA__lab-1", "StudyA__lab-2"], mixed, { date: "2026-02-28" }),
      "effective",
      "main",
      "tested",
    );
    expect(figure).toMatchObject({ value: 11, bases: ["reported", "verified"], demo: true, complete: true });
  });
});

describe("targets and completion", () => {
  it("sums agreed targets and says where one is missing", () => {
    expect(targetFigure(participations, states, "main")).toMatchObject({
      value: 60,
      known: 2,
      expected: 3,
      complete: false,
    });
    expect(targetFigure(participations, states, "rest")).toMatchObject({ value: 30, known: 1 });
  });

  it("reads the target category where no target is agreed", () => {
    const withTarget = resolveAll(
      ["StudyB__lab-1"],
      [
        report({
          id: "t",
          participationId: "StudyB__lab-1",
          asOfDate: "2026-01-01",
          counts: { participants: { target: 25 } },
        }),
      ],
      { date: "2026-02-28" },
    );
    expect(targetFigure([participations[2] as ParticipationFacts], withTarget, "participants").value).toBe(25);
  });

  it("is a percentage of the target, over the participations that state both", () => {
    const completion = completionFigure(participations, states, "reported", "main", "tested");
    expect(completion.percent).toBeCloseTo((10 / 40) * 100);
    expect(completion).toMatchObject({ pairs: 1, expected: 3 });
  });

  it("is unknown where one participation states only the value and another only the target", () => {
    const onlyActual: ParticipationFacts = {
      id: "StudyC__lab-1",
      replicationId: "StudyC",
      laboratoryId: "lab-1",
      status: "collecting",
      countryCode: null,
      institutionId: null,
      targetNMain: null,
      targetNRest: null,
    };
    const onlyTarget: ParticipationFacts = {
      ...onlyActual,
      id: "StudyC__lab-2",
      laboratoryId: "lab-2",
      targetNMain: 30,
    };
    const apart = resolveAll(
      [onlyActual.id, onlyTarget.id],
      [report({ id: "c1", participationId: onlyActual.id, asOfDate: "2026-01-10", counts: { main: { tested: 28 } } })],
      { date: "2026-02-28" },
    );
    expect(completionFigure([onlyActual, onlyTarget], apart, "reported", "main", "tested")).toEqual({
      percent: null,
      pairs: 0,
      expected: 2,
    });
  });
});

describe("attritionPercent", () => {
  it("takes both values of a participation from one basis, never a verified one against a reported one", () => {
    const mixed = resolveAll(
      ["StudyA__lab-1"],
      [
        report({
          id: "m1",
          participationId: "StudyA__lab-1",
          asOfDate: "2026-03-01",
          counts: { main: { recorded: 25, usable: 22 } },
        }),
        report({
          id: "m1v",
          participationId: "StudyA__lab-1",
          asOfDate: "2026-03-01",
          basis: "centrallyVerified",
          verifiesReportId: "m1",
          counts: { main: { usable: 21 } },
        }),
      ],
      { date: "2026-03-31" },
    );
    const first = participations[0] as ParticipationFacts;
    expect(attritionPercent([first], mixed, "effective", "main", "recorded", "usable")).toMatchObject({
      percent: 12,
      pairs: 1,
      bases: ["reported"],
    });
  });

  it("compares recorded with usable over the participations that state both", () => {
    expect(attritionPercent(participations, states, "reported", "main", "recorded", "usable")).toEqual({
      percent: 20,
      pairs: 1,
      expected: 2,
      bases: ["reported"],
    });
    expect(attritionPercent(participations, states, "reported", "rest", "recorded", "usable").percent).toBeNull();
  });
});

describe("rollupBy", () => {
  it("groups by replication, laboratory, country, institution and the programme", () => {
    const byReplication = rollupBy("replication", participations, states, "reported", "rest", "tested");
    expect(byReplication.map((group) => [group.key, group.figure.value, group.activeSites])).toEqual([
      ["StudyA", 13, 2],
      ["StudyB", null, 0],
    ]);
    const byLaboratory = rollupBy("laboratory", participations, states, "reported", "rest", "tested");
    expect(byLaboratory.map((group) => [group.key, group.figure.value])).toEqual([
      ["lab-1", 9],
      ["lab-2", 4],
    ]);
    expect(rollupBy("country", participations, states, "reported", "rest", "tested").map((group) => group.key)).toEqual(
      ["GB", "DE"],
    );
    expect(
      rollupBy("institution", participations, states, "reported", "rest", "tested").map((group) => group.key),
    ).toEqual(["inst-1", "unknown"]);
    const [programme] = rollupBy("programme", participations, states, "reported", "main", "tested");
    expect(programme?.figure.value).toBe(10);
    expect(programme?.completion.percent).toBeCloseTo((10 / 40) * 100);
  });
});

describe("monthlyTrend", () => {
  it("reconstructs each month end from the reports as they stood, and gives the change only between complete points", () => {
    const series = [
      report({ id: "m1", participationId: "StudyA__lab-1", asOfDate: "2026-01-15", counts: { main: { tested: 2 } } }),
      report({ id: "m2", participationId: "StudyA__lab-1", asOfDate: "2026-02-15", counts: { main: { tested: 6 } } }),
      report({ id: "m3", participationId: "StudyA__lab-1", asOfDate: "2026-03-15", counts: { main: { tested: 9 } } }),
    ];
    const one = [participations[0] as ParticipationFacts];
    const trend = monthlyTrend(one, series, "reported", "main", "tested", "2025-12-01", "2026-03-31");
    expect(trend.map((point) => [point.date, point.figure.value, point.change])).toEqual([
      ["2025-12-31", null, null],
      ["2026-01-31", 2, null],
      ["2026-02-28", 6, 4],
      ["2026-03-31", 9, 3],
    ]);
  });
});

describe("observedRate", () => {
  it("divides the change by the days between the two reports", () => {
    const series = [
      report({ id: "s1", participationId: "StudyA__lab-1", asOfDate: "2026-01-01", counts: { main: { tested: 10 } } }),
      report({ id: "s2", participationId: "StudyA__lab-1", asOfDate: "2026-01-21", counts: { main: { tested: 30 } } }),
    ];
    expect(observedRate("StudyA__lab-1", series, "reported", "main", "tested", "2026-01-10", "2026-01-31")).toEqual({
      participationId: "StudyA__lab-1",
      perDay: 1,
      fromDate: "2026-01-01",
      toDate: "2026-01-21",
      fromValue: 10,
      toValue: 30,
    });
  });

  it("starts from the earliest value within the window where nothing held at its start", () => {
    const series = [
      report({ id: "w1", participationId: "StudyA__lab-1", asOfDate: "2026-07-15", counts: { main: { tested: 4 } } }),
      report({ id: "w2", participationId: "StudyA__lab-1", asOfDate: "2026-09-25", counts: { main: { tested: 14 } } }),
      report({ id: "w3", participationId: "StudyA__lab-1", asOfDate: "2026-11-11", counts: { main: { tested: 28 } } }),
    ];
    const rate = observedRate("StudyA__lab-1", series, "reported", "main", "tested", "2026-07-14", "2026-11-11");
    expect(rate).toMatchObject({ fromDate: "2026-07-15", fromValue: 4, toDate: "2026-11-11", toValue: 28 });
    expect(rate.perDay).toBeCloseTo(24 / 119);
  });

  it("is unknown with one value only", () => {
    const one = [
      report({ id: "s1", participationId: "StudyA__lab-1", asOfDate: "2026-01-21", counts: { main: { tested: 3 } } }),
    ];
    expect(
      observedRate("StudyA__lab-1", one, "reported", "main", "tested", "2026-01-25", "2026-01-31").perDay,
    ).toBeNull();
    expect(
      observedRate("StudyA__lab-1", [], "reported", "main", "tested", "2026-01-01", "2026-01-31").perDay,
    ).toBeNull();
  });
});

describe("summaryTotals", () => {
  it("sums each basis apart and counts who states each value", () => {
    const summary = summaryTotals(
      participations.map((participation) => participation.id),
      reports,
      "2026-02-28",
    );
    expect(summary.totals).toEqual({
      labReported: {
        main: { tested: 10, recorded: 10, usable: 8 },
        rest: { tested: 13 },
        participants: { tested: 12 },
      },
      centrallyVerified: { main: { tested: 9 } },
    });
    expect(summary.reporting.labReported?.rest?.tested).toBe(2);
    expect(summary.reporting.labReported?.main?.tested).toBe(1);
    expect(summary.latestAsOfDate).toBe("2026-02-10");
  });
});

describe("importedFigures", () => {
  it("keeps current figures of the replications asked for, whole, apart from live reports", () => {
    const figures = importedFigures(
      [
        {
          metricKey: "totalNMainCollected",
          valueNumeric: 50,
          valueSource: "50",
          snapshotDate: null,
          replicationIds: ["StudyA", "StudyC"],
          isCurrent: true,
          dataOrigin: "importedHistorical",
        },
        {
          metricKey: "totalNMainCollected",
          valueNumeric: 40,
          valueSource: "40",
          snapshotDate: null,
          replicationIds: ["StudyA"],
          isCurrent: false,
          dataOrigin: "importedHistorical",
        },
        {
          metricKey: "nLabsSigned",
          valueNumeric: 3,
          valueSource: "3",
          snapshotDate: "2024-01-01",
          replicationIds: ["StudyB"],
          isCurrent: true,
          dataOrigin: "importedHistorical",
        },
      ],
      new Set(["StudyA"]),
    );
    expect(figures.map((figure) => [figure.metricKey, figure.valueNumeric, figure.replicationIds])).toEqual([
      ["totalNMainCollected", 50, ["StudyA", "StudyC"]],
    ]);
  });
});

describe("milestoneAchievement", () => {
  it("counts milestones reached on time or late, overdue, ahead and undated", () => {
    expect(
      milestoneAchievement(
        [
          { id: "1", replicationId: "StudyA", dueDate: "2026-01-31", completedDate: "2026-01-30" },
          { id: "2", replicationId: "StudyA", dueDate: "2026-01-31", completedDate: "2026-02-03" },
          { id: "3", replicationId: "StudyA", dueDate: "2026-02-01", completedDate: null },
          { id: "4", replicationId: "StudyA", dueDate: "2026-04-01", completedDate: null },
          { id: "5", replicationId: "StudyA", dueDate: null, completedDate: null },
        ],
        "2026-03-01",
      ),
    ).toEqual({ total: 5, reachedOnTime: 1, reachedLate: 1, overdue: 1, upcoming: 1, undated: 1 });
  });
});
