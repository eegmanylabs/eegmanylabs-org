// The order in which the reports of a participation are listed: the latest date first, and of
// one date the latest filed first, with each report that a correction or a withdrawal replaced
// listed beneath the report that replaced it.

export interface OrderedReport {
  readonly id: string;
  readonly asOfDate: string;
  readonly createdAtMillis: number;
  /** The report this one replaces, for a correction or a withdrawal. */
  readonly correctsReportId?: string | undefined;
}

const newestFirst = (a: OrderedReport, b: OrderedReport) =>
  b.asOfDate.localeCompare(a.asOfDate) || b.createdAtMillis - a.createdAtMillis || a.id.localeCompare(b.id);

/** The reports in the order of the list. Every report appears once, a cycle of replacements included. */
export function reportHistoryOrder<T extends OrderedReport>(reports: readonly T[]): T[] {
  const byId = new Map(reports.map((report) => [report.id, report]));
  const replaced = new Set(
    reports.flatMap((report) =>
      report.correctsReportId !== undefined && byId.has(report.correctsReportId) ? [report.correctsReportId] : [],
    ),
  );
  const ordered: T[] = [];
  const placed = new Set<string>();
  const place = (report: T) => {
    // The report, then the chain of the reports it replaced, each beneath the one that replaced it.
    let current: T | undefined = report;
    while (current !== undefined && !placed.has(current.id)) {
      placed.add(current.id);
      ordered.push(current);
      current = current.correctsReportId === undefined ? undefined : byId.get(current.correctsReportId);
    }
  };
  for (const report of [...reports].filter((candidate) => !replaced.has(candidate.id)).sort(newestFirst)) {
    place(report);
  }
  for (const report of [...reports].sort(newestFirst)) place(report);
  return ordered;
}
