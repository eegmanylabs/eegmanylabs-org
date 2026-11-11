import { describe, expect, it } from "vitest";
import { reportHistoryOrder } from "./report-order";

describe("the order of the reports of a participation", () => {
  it("lists the latest date first, the latest filed first, and a replaced report beneath its replacement", () => {
    const ordered = reportHistoryOrder([
      { id: "july", asOfDate: "2026-07-15", createdAtMillis: 1 },
      { id: "september", asOfDate: "2026-09-25", createdAtMillis: 1 },
      { id: "november", asOfDate: "2026-11-11", createdAtMillis: 5 },
      { id: "novemberCorrection", asOfDate: "2026-11-11", createdAtMillis: 9, correctsReportId: "november" },
      { id: "septemberWithdrawal", asOfDate: "2026-09-25", createdAtMillis: 8, correctsReportId: "september" },
      { id: "octoberNew", asOfDate: "2026-10-28", createdAtMillis: 7 },
    ]);
    expect(ordered.map((report) => report.id)).toEqual([
      "novemberCorrection",
      "november",
      "octoberNew",
      "septemberWithdrawal",
      "september",
      "july",
    ]);
  });

  it("lists every report once, even where replacements form a cycle", () => {
    const ordered = reportHistoryOrder([
      { id: "a", asOfDate: "2026-01-01", createdAtMillis: 1, correctsReportId: "b" },
      { id: "b", asOfDate: "2026-01-01", createdAtMillis: 2, correctsReportId: "a" },
    ]);
    expect(ordered.map((report) => report.id).sort()).toEqual(["a", "b"]);
  });
});
