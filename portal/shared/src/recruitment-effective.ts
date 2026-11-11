// The effective values of recruitment (docs/DATA_MODEL.md, sections 7 and 15; D-009, D-019).
//
// Reports are never edited. A correction names the report it replaces and a void withdraws the
// report it names, so the figures that hold on a date are worked out from the whole series:
//
// | Step | Rule |
// |------|------|
// | Known | With `knownAtMillis`, only the reports created by then count, the corrections and voids among them, which reproduces what the portal knew at that time |
// | Superseded | A report that a known correction or void names no longer counts. A void counts for nothing itself. Withdrawing a correction does not bring back the report it replaced: a figure comes back through a new report |
// | Cumulative | For each participation, basis, modality and category, the value is that of the latest live cumulative report on or before the date that states it. Of two reports with the same date, the one created later holds |
// | Period | A period report feeds rates and trends and is never added to a cumulative value |
// | Effective | A centrally verified value is preferred to the lab-reported value of the same key when it holds for the same or a later date. A newer lab-reported value holds otherwise, so a verification never hides a later report |
// | Unknown | A key that no live report states is absent and never zero |
//
// Main experiment, resting state and unique participants are kept apart throughout: nothing here
// adds one modality to another.
import type { DataOrigin } from "./data-origin";
import type { ReportEntryKind, ReportKind } from "./schemas/recruitment";
import type { RecruitmentBasis, RecruitmentCounts, RecruitmentModality } from "./schemas/replications";

/** The modalities, in the order they are shown. */
export const RECRUITMENT_MODALITIES = [
  "main",
  "rest",
  "participants",
] as const satisfies readonly RecruitmentModality[];

export const RECRUITMENT_MODALITY_LABELS: Readonly<Record<RecruitmentModality, string>> = {
  main: "Main experiment",
  rest: "Resting state",
  participants: "Unique participants",
};

export const RECRUITMENT_BASES = ["labReported", "centrallyVerified"] as const satisfies readonly RecruitmentBasis[];

/** One exclusion of a report: how many were excluded from one modality, and why. */
export interface ReportExclusion {
  readonly modality: RecruitmentModality;
  readonly reasonTermId?: string | undefined;
  readonly reasonSource?: string | undefined;
  readonly count: number;
}

/** What the resolver reads of a report: its stored fields, its identifier and when it was filed. */
export interface ReportFact {
  readonly id: string;
  readonly participationId: string;
  readonly asOfDate: string;
  readonly periodStart?: string | undefined;
  readonly periodEnd?: string | undefined;
  readonly reportKind: ReportKind;
  readonly basis: RecruitmentBasis;
  readonly entryKind: ReportEntryKind;
  readonly correctsReportId?: string | undefined;
  readonly verifiesReportId?: string | undefined;
  readonly counts: RecruitmentCounts;
  readonly exclusions: readonly ReportExclusion[];
  /** When the report was filed, in milliseconds since the epoch. */
  readonly createdAtMillis: number;
  readonly dataOrigin: DataOrigin;
}

/** One value and the report it comes from. */
export interface ResolvedValue {
  readonly value: number;
  readonly basis: RecruitmentBasis;
  readonly reportId: string;
  readonly asOfDate: string;
  readonly dataOrigin: DataOrigin;
}

/** Modality to category key to value. A key that is absent is unknown. */
export type ResolvedCounts = Readonly<Partial<Record<RecruitmentModality, Readonly<Record<string, ResolvedValue>>>>>;

/** The exclusions of the latest live cumulative report of one basis that lists any. */
export interface ResolvedExclusions {
  readonly reportId: string;
  readonly asOfDate: string;
  readonly exclusions: readonly ReportExclusion[];
}

/** The state of recruitment of one participation on one date. */
export interface ParticipationRecruitment {
  readonly participationId: string;
  readonly date: string;
  readonly reported: ResolvedCounts;
  readonly verified: ResolvedCounts;
  /** Verified where it holds for the same or a later date, reported otherwise. */
  readonly effective: ResolvedCounts;
  readonly exclusions: Readonly<Record<RecruitmentBasis, ResolvedExclusions | null>>;
  /** The live period reports whose period ends on or before the date, oldest first. */
  readonly periods: readonly ReportFact[];
  /** The latest `asOfDate` of a live report on or before the date, of either basis and kind. */
  readonly latestAsOfDate: string | null;
}

export interface ResolveOptions {
  /** The calendar date for which the state is wanted. */
  readonly date: string;
  /** Only the reports filed by then count: what the portal knew at that time. */
  readonly knownAtMillis?: number | undefined;
}

/** Later reports last: by date, then by the time of filing, then by identifier so the order never depends on input order. */
export function compareReports(a: ReportFact, b: ReportFact): number {
  if (a.asOfDate !== b.asOfDate) return a.asOfDate < b.asOfDate ? -1 : 1;
  if (a.createdAtMillis !== b.createdAtMillis) return a.createdAtMillis - b.createdAtMillis;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The reports that were known at a time: all of them without a time. */
export function knownReports<R extends ReportFact>(reports: readonly R[], knownAtMillis?: number): R[] {
  return knownAtMillis === undefined
    ? [...reports]
    : reports.filter((report) => report.createdAtMillis <= knownAtMillis);
}

/** The identifiers of the reports that a known correction or void replaces. */
export function supersededIds(reports: readonly ReportFact[]): ReadonlySet<string> {
  const superseded = new Set<string>();
  for (const report of reports) {
    if (report.entryKind !== "new" && report.correctsReportId !== undefined) superseded.add(report.correctsReportId);
  }
  return superseded;
}

/**
 * The reports that still count: known, not replaced by a correction or a void, and not
 * themselves a void. The order is that of `compareReports`.
 */
export function liveReports<R extends ReportFact>(reports: readonly R[], knownAtMillis?: number): R[] {
  const known = knownReports(reports, knownAtMillis);
  const superseded = supersededIds(known);
  return known.filter((report) => report.entryKind !== "void" && !superseded.has(report.id)).sort(compareReports);
}

function resolveBasis(cumulative: readonly ReportFact[], basis: RecruitmentBasis): ResolvedCounts {
  const resolved: Partial<Record<RecruitmentModality, Record<string, ResolvedValue>>> = {};
  // The reports are in ascending order, so a later report overwrites an earlier one key by key.
  for (const report of cumulative) {
    if (report.basis !== basis) continue;
    for (const modality of RECRUITMENT_MODALITIES) {
      const counts = report.counts[modality];
      if (counts === undefined) continue;
      for (const [category, value] of Object.entries(counts)) {
        const target = resolved[modality] ?? {};
        target[category] = {
          value,
          basis,
          reportId: report.id,
          asOfDate: report.asOfDate,
          dataOrigin: report.dataOrigin,
        };
        resolved[modality] = target;
      }
    }
  }
  return resolved;
}

function preferVerified(reported: ResolvedCounts, verified: ResolvedCounts): ResolvedCounts {
  const effective: Partial<Record<RecruitmentModality, Record<string, ResolvedValue>>> = {};
  for (const modality of RECRUITMENT_MODALITIES) {
    const keys = new Set([...Object.keys(reported[modality] ?? {}), ...Object.keys(verified[modality] ?? {})]);
    for (const category of keys) {
      const lab = reported[modality]?.[category];
      const central = verified[modality]?.[category];
      const chosen = central !== undefined && (lab === undefined || central.asOfDate >= lab.asOfDate) ? central : lab;
      if (chosen === undefined) continue;
      const target = effective[modality] ?? {};
      target[category] = chosen;
      effective[modality] = target;
    }
  }
  return effective;
}

function latestExclusions(cumulative: readonly ReportFact[], basis: RecruitmentBasis): ResolvedExclusions | null {
  for (let index = cumulative.length - 1; index >= 0; index -= 1) {
    const report = cumulative[index];
    if (report === undefined || report.basis !== basis || report.exclusions.length === 0) continue;
    return { reportId: report.id, asOfDate: report.asOfDate, exclusions: report.exclusions };
  }
  return null;
}

/**
 * The state of recruitment of one participation on a date, from the reports of that
 * participation. Reports of other participations are ignored.
 */
export function resolveParticipation(
  participationId: string,
  reports: readonly ReportFact[],
  options: ResolveOptions,
): ParticipationRecruitment {
  const live = liveReports(
    reports.filter((report) => report.participationId === participationId),
    options.knownAtMillis,
  );
  const upToDate = live.filter((report) => report.asOfDate <= options.date);
  const cumulative = upToDate.filter((report) => report.reportKind === "cumulative");
  const reported = resolveBasis(cumulative, "labReported");
  const verified = resolveBasis(cumulative, "centrallyVerified");
  return {
    participationId,
    date: options.date,
    reported,
    verified,
    effective: preferVerified(reported, verified),
    exclusions: {
      labReported: latestExclusions(cumulative, "labReported"),
      centrallyVerified: latestExclusions(cumulative, "centrallyVerified"),
    },
    periods: upToDate.filter((report) => report.reportKind === "period"),
    latestAsOfDate: upToDate.at(-1)?.asOfDate ?? null,
  };
}

/** The states of many participations on one date, by participation. */
export function resolveAll(
  participationIds: readonly string[],
  reports: readonly ReportFact[],
  options: ResolveOptions,
): Map<string, ParticipationRecruitment> {
  const byParticipation = new Map<string, ReportFact[]>();
  for (const report of reports) {
    const list = byParticipation.get(report.participationId) ?? [];
    list.push(report);
    byParticipation.set(report.participationId, list);
  }
  return new Map(
    participationIds.map((id) => [id, resolveParticipation(id, byParticipation.get(id) ?? [], options)] as const),
  );
}

/** One value of a resolved set, or undefined where it is unknown. */
export function resolvedValue(
  counts: ResolvedCounts,
  modality: RecruitmentModality,
  category: string,
): ResolvedValue | undefined {
  return counts[modality]?.[category];
}

/**
 * Whether a report still counts, and if not, what replaced it: the report that names it as
 * corrected or void, among the reports known now.
 */
export function reportStanding(
  report: ReportFact,
  reports: readonly ReportFact[],
): { readonly kind: "live" } | { readonly kind: "corrected" | "voided"; readonly byReportId: string } {
  const replacement = reports.find((other) => other.entryKind !== "new" && other.correctsReportId === report.id);
  if (replacement === undefined) return { kind: "live" };
  return { kind: replacement.entryKind === "void" ? "voided" : "corrected", byReportId: replacement.id };
}

/** The last day of each month from the month of `from` to the month of `to`, with `to` itself for its own month. */
export function monthEnds(from: string, to: string): string[] {
  const ends: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const lastYear = Number(to.slice(0, 4));
  const lastMonth = Number(to.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    ends.push(end > to ? to : end);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return ends;
}

/** The last day of the month before the month of a date. */
export function endOfPreviousMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const end = new Date(Date.UTC(year, month - 1, 0));
  return end.toISOString().slice(0, 10);
}
