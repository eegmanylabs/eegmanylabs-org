// Rollups of recruitment (docs/DATA_MODEL.md, section 15): the effective values of each
// participation, summed by laboratory, replication, country, institution or the programme, with
// what each figure is based on and whether it is complete.
//
// | Rule | Where |
// |------|-------|
// | A sum adds the known values of one modality and one category only. Main experiment, resting state and unique participants are never added together | `rollupFigure` |
// | A group in which nobody states a value has an unknown figure, never zero | `rollupFigure` |
// | A figure is complete when every participation expected to report states the value | `rollupFigure` |
// | Completion divides values by targets of the same participations, those that state both | `completionFigure` |
// | Every figure names its bases: reported, verified, imported or projected | `FigureBasis` |
// | Imported historical aggregates are a figure of their own and are never added to live reports | `importedFigure` |
import type { DataOrigin } from "./data-origin";
import {
  monthEnds,
  type ParticipationRecruitment,
  type ReportFact,
  type ResolvedCounts,
  resolveAll,
  resolvedValue,
} from "./recruitment-effective";
import { daysBetween } from "./recurrence";
import type { RecruitmentModality } from "./schemas/replications";

/** What a figure is based on, as the interface labels it. */
export const FIGURE_BASES = ["reported", "verified", "imported", "projected"] as const;
export type FigureBasis = (typeof FIGURE_BASES)[number];

export const FIGURE_BASIS_LABELS: Readonly<Record<FigureBasis, string>> = {
  reported: "Reported",
  verified: "Verified",
  imported: "Imported",
  projected: "Projected",
};

/** Which values a rollup sums: the effective ones, or one basis alone. */
export type RecruitmentLens = "effective" | "reported" | "verified";

export const RECRUITMENT_LENS_LABELS: Readonly<Record<RecruitmentLens, string>> = {
  effective: "Effective (verified where available)",
  reported: "Lab-reported only",
  verified: "Centrally verified only",
};

/** The statuses of a participation in which it is expected to report, whether or not it has. */
export const REPORTING_STATUSES: ReadonlySet<string> = new Set(["collecting", "collectionComplete"]);

/** What a rollup needs to know of a participation beside its reports. */
export interface ParticipationFacts {
  readonly id: string;
  readonly replicationId: string;
  readonly laboratoryId: string;
  readonly status: string;
  readonly countryCode: string | null;
  readonly institutionId: string | null;
  readonly targetNMain: number | null;
  readonly targetNRest: number | null;
}

export const ROLLUP_DIMENSIONS = ["programme", "replication", "laboratory", "country", "institution"] as const;
export type RollupDimension = (typeof ROLLUP_DIMENSIONS)[number];

export const ROLLUP_DIMENSION_LABELS: Readonly<Record<RollupDimension, string>> = {
  programme: "Programme",
  replication: "Replication",
  laboratory: "Laboratory",
  country: "Country",
  institution: "Institution",
};

/** The key that groups a participation in a dimension. A participation whose country or institution is not known is grouped under `UNKNOWN_GROUP`. */
export const UNKNOWN_GROUP = "unknown";

export function groupKeyOf(participation: ParticipationFacts, dimension: RollupDimension): string {
  switch (dimension) {
    case "programme":
      return "programme";
    case "replication":
      return participation.replicationId;
    case "laboratory":
      return participation.laboratoryId;
    case "country":
      return participation.countryCode ?? UNKNOWN_GROUP;
    case "institution":
      return participation.institutionId ?? UNKNOWN_GROUP;
  }
}

/** A summed figure with what it rests on. */
export interface RollupFigure {
  /** The sum of the known values, or null where no participation states one. */
  readonly value: number | null;
  /** How many participations state the value. */
  readonly known: number;
  /** How many participations were expected to state it. */
  readonly expected: number;
  /** Whether every expected participation states the value. */
  readonly complete: boolean;
  readonly bases: readonly FigureBasis[];
  /** Whether a value of the demonstration world is part of the figure. */
  readonly demo: boolean;
  /** The latest date on which a value of the figure holds. */
  readonly latestAsOfDate: string | null;
}

/** The counts that a lens reads from the state of a participation. */
export function countsFor(state: ParticipationRecruitment, lens: RecruitmentLens): ResolvedCounts {
  return lens === "effective" ? state.effective : lens === "reported" ? state.reported : state.verified;
}

/** Whether a participation is expected to report on a date: it collects, has collected, or has reported. */
export function expectedToReport(
  participation: ParticipationFacts,
  state: ParticipationRecruitment | undefined,
): boolean {
  return REPORTING_STATUSES.has(participation.status) || (state?.latestAsOfDate ?? null) !== null;
}

const sortedBases = (bases: ReadonlySet<FigureBasis>): FigureBasis[] =>
  FIGURE_BASES.filter((basis) => bases.has(basis));

/** The figure of one modality and category over some participations. */
export function rollupFigure(
  participations: readonly ParticipationFacts[],
  states: ReadonlyMap<string, ParticipationRecruitment>,
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  category: string,
): RollupFigure {
  let value: number | null = null;
  let known = 0;
  let expected = 0;
  let demo = false;
  let latest: string | null = null;
  const bases = new Set<FigureBasis>();
  for (const participation of participations) {
    const state = states.get(participation.id);
    const found = state === undefined ? undefined : resolvedValue(countsFor(state, lens), modality, category);
    if (expectedToReport(participation, state) || found !== undefined) expected += 1;
    if (found === undefined) continue;
    known += 1;
    value = (value ?? 0) + found.value;
    bases.add(found.basis === "centrallyVerified" ? "verified" : "reported");
    if (found.dataOrigin === "importedHistorical") bases.add("imported");
    if (found.dataOrigin === "demo") demo = true;
    if (latest === null || found.asOfDate > latest) latest = found.asOfDate;
  }
  return {
    value,
    known,
    expected,
    complete: known === expected,
    bases: sortedBases(bases),
    demo,
    latestAsOfDate: latest,
  };
}

/** The target of one participation for a modality: the agreed target where it is set, or else its effective `target` count. */
export function targetOf(
  participation: ParticipationFacts,
  state: ParticipationRecruitment | undefined,
  modality: RecruitmentModality,
): number | null {
  const agreed =
    modality === "main" ? participation.targetNMain : modality === "rest" ? participation.targetNRest : null;
  if (agreed !== null) return agreed;
  const counted = state === undefined ? undefined : resolvedValue(state.effective, modality, "target");
  return counted?.value ?? null;
}

/** The sum of the targets of some participations. Complete when every participation has one. */
export function targetFigure(
  participations: readonly ParticipationFacts[],
  states: ReadonlyMap<string, ParticipationRecruitment>,
  modality: RecruitmentModality,
): RollupFigure {
  let value: number | null = null;
  let known = 0;
  for (const participation of participations) {
    const target = targetOf(participation, states.get(participation.id), modality);
    if (target === null) continue;
    known += 1;
    value = (value ?? 0) + target;
  }
  return {
    value,
    known,
    expected: participations.length,
    complete: known === participations.length,
    bases: value === null ? [] : ["reported"],
    demo: false,
    latestAsOfDate: null,
  };
}

/** The share of the targets that is reached, over the participations that state both. */
export interface CompletionFigure {
  /** In per cent, or null where no participation states both or their targets sum to zero. */
  readonly percent: number | null;
  /** How many participations state both the value and a target. */
  readonly pairs: number;
  /** How many participations the figure is about. */
  readonly expected: number;
}

/**
 * The share of the target that is reached, in per cent, over the participations that state both
 * the value and a target, as attrition is worked out, so that the value of one participation is
 * never divided by the target of another. Null where no participation states both.
 */
export function completionFigure(
  participations: readonly ParticipationFacts[],
  states: ReadonlyMap<string, ParticipationRecruitment>,
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  category: string,
): CompletionFigure {
  let actualSum = 0;
  let targetSum = 0;
  let pairs = 0;
  for (const participation of participations) {
    const state = states.get(participation.id);
    const target = targetOf(participation, state, modality);
    const actual = state === undefined ? undefined : resolvedValue(countsFor(state, lens), modality, category);
    if (target === null || actual === undefined) continue;
    pairs += 1;
    actualSum += actual.value;
    targetSum += target;
  }
  return {
    percent: pairs === 0 || targetSum === 0 ? null : (actualSum / targetSum) * 100,
    pairs,
    expected: participations.length,
  };
}

/**
 * The attrition between two categories, in per cent: how many of those counted in `from` are
 * not counted in `to`, over the participations that state both, so that a laboratory that
 * reports one alone never distorts the share. Both values of a participation come from one
 * basis: with the effective lens, its verified pair where it states both verified, or else its
 * reported pair, so that a verified value is never set against a reported one. Null where no
 * participation states both, or where the first sum is zero.
 */
export function attritionPercent(
  participations: readonly ParticipationFacts[],
  states: ReadonlyMap<string, ParticipationRecruitment>,
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  from: string,
  to: string,
): {
  readonly percent: number | null;
  readonly pairs: number;
  readonly expected: number;
  readonly bases: readonly FigureBasis[];
} {
  let fromSum = 0;
  let toSum = 0;
  let pairs = 0;
  let expected = 0;
  const bases = new Set<FigureBasis>();
  const pairOf = (counts: ResolvedCounts) => {
    const before = resolvedValue(counts, modality, from);
    const after = resolvedValue(counts, modality, to);
    return before === undefined || after === undefined ? null : { before, after };
  };
  for (const participation of participations) {
    const state = states.get(participation.id);
    if (expectedToReport(participation, state)) expected += 1;
    if (state === undefined) continue;
    const pair =
      lens === "effective" ? (pairOf(state.verified) ?? pairOf(state.reported)) : pairOf(countsFor(state, lens));
    if (pair === null) continue;
    pairs += 1;
    fromSum += pair.before.value;
    toSum += pair.after.value;
    bases.add(pair.before.basis === "centrallyVerified" ? "verified" : "reported");
  }
  return {
    percent: pairs === 0 || fromSum === 0 ? null : ((fromSum - toSum) / fromSum) * 100,
    pairs,
    expected,
    bases: sortedBases(bases),
  };
}

/** One group of a rollup. */
export interface RollupGroup {
  readonly key: string;
  readonly participations: readonly ParticipationFacts[];
  readonly figure: RollupFigure;
  readonly target: RollupFigure;
  readonly completion: CompletionFigure;
  /** Participations in the status `collecting`. */
  readonly activeSites: number;
}

/** A rollup of one modality and category by a dimension, largest groups first, then by key. */
export function rollupBy(
  dimension: RollupDimension,
  participations: readonly ParticipationFacts[],
  states: ReadonlyMap<string, ParticipationRecruitment>,
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  category: string,
): RollupGroup[] {
  const groups = new Map<string, ParticipationFacts[]>();
  for (const participation of participations) {
    const key = groupKeyOf(participation, dimension);
    const list = groups.get(key) ?? [];
    list.push(participation);
    groups.set(key, list);
  }
  return [...groups]
    .map(([key, members]): RollupGroup => {
      const figure = rollupFigure(members, states, lens, modality, category);
      const target = targetFigure(members, states, modality);
      return {
        key,
        participations: members,
        figure,
        target,
        completion: completionFigure(members, states, lens, modality, category),
        activeSites: members.filter((member) => member.status === "collecting").length,
      };
    })
    .sort((a, b) => (b.figure.value ?? -1) - (a.figure.value ?? -1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One point of a trend: the figure at the end of a month, and its change since the month before. */
export interface TrendPoint {
  readonly date: string;
  readonly figure: RollupFigure;
  /** The change since the previous point, where both are complete; null otherwise. */
  readonly change: number | null;
}

/**
 * The figure at the end of each month from `from` to `to`, each reconstructed from the reports
 * as they stood, so a trend shows what held at each date and not what holds today.
 */
export function monthlyTrend(
  participations: readonly ParticipationFacts[],
  reports: readonly ReportFact[],
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  category: string,
  from: string,
  to: string,
): TrendPoint[] {
  const ids = participations.map((participation) => participation.id);
  const points: TrendPoint[] = [];
  let previous: RollupFigure | null = null;
  for (const date of monthEnds(from, to)) {
    const states = resolveAll(ids, reports, { date });
    const figure = rollupFigure(participations, states, lens, modality, category);
    const change =
      previous?.complete && figure.complete && previous.value !== null && figure.value !== null
        ? figure.value - previous.value
        : null;
    points.push({ date, figure, change });
    previous = figure;
  }
  return points;
}

/** The rate of one participation over a window, in participants a day, from two cumulative values. */
export interface ObservedRate {
  readonly participationId: string;
  /** Participants a day, or null where the window holds fewer than two dated values. */
  readonly perDay: number | null;
  readonly fromDate: string | null;
  readonly toDate: string | null;
  readonly fromValue: number | null;
  readonly toValue: number | null;
}

/**
 * The rate of a participation between the value that held at the start of a window and the
 * value at its end, each at the date of the report it comes from. Where no value held at the
 * start, because the participation began to report within the window, the rate starts from the
 * earliest value within it. The rate is unknown where the two values come from the same report
 * or the window holds no value at all.
 */
export function observedRate(
  participationId: string,
  reports: readonly ReportFact[],
  lens: RecruitmentLens,
  modality: RecruitmentModality,
  category: string,
  windowStart: string,
  windowEnd: string,
): ObservedRate {
  const ids = [participationId];
  const start = resolveAll(ids, reports, { date: windowStart }).get(participationId);
  const end = resolveAll(ids, reports, { date: windowEnd }).get(participationId);
  let before = start === undefined ? undefined : resolvedValue(countsFor(start, lens), modality, category);
  const after = end === undefined ? undefined : resolvedValue(countsFor(end, lens), modality, category);
  if (after === undefined) {
    return { participationId, perDay: null, fromDate: null, toDate: null, fromValue: null, toValue: null };
  }
  if (before === undefined) {
    const dates = [
      ...new Set(
        reports
          .filter(
            (report) =>
              report.participationId === participationId &&
              report.asOfDate > windowStart &&
              report.asOfDate < after.asOfDate,
          )
          .map((report) => report.asOfDate),
      ),
    ].sort();
    for (const date of dates) {
      const state = resolveAll(ids, reports, { date }).get(participationId);
      const found = state === undefined ? undefined : resolvedValue(countsFor(state, lens), modality, category);
      if (found !== undefined && found.asOfDate > windowStart) {
        before = found;
        break;
      }
    }
  }
  if (before === undefined || before.asOfDate >= after.asOfDate) {
    return {
      participationId,
      perDay: null,
      fromDate: before?.asOfDate ?? null,
      toDate: after.asOfDate,
      fromValue: before?.value ?? null,
      toValue: after.value,
    };
  }
  const days = daysBetween(before.asOfDate, after.asOfDate);
  return {
    participationId,
    perDay: (after.value - before.value) / days,
    fromDate: before.asOfDate,
    toDate: after.asOfDate,
    fromValue: before.value,
    toValue: after.value,
  };
}

/** A historical aggregate as a rollup shows it. */
export interface ImportedAggregate {
  readonly metricKey: string;
  readonly valueNumeric: number | null;
  readonly valueSource: string;
  readonly snapshotDate: string | null;
  readonly replicationIds: readonly string[];
  readonly isCurrent: boolean;
  readonly dataOrigin: Extract<DataOrigin, "importedHistorical" | "demo">;
}

/**
 * The current imported figures of a metric for some replications. A figure that describes several
 * replications together is kept whole and listed once, never apportioned or added to anything.
 */
export function importedFigures(
  aggregates: readonly ImportedAggregate[],
  replicationIds: ReadonlySet<string>,
): ImportedAggregate[] {
  return aggregates
    .filter((aggregate) => aggregate.isCurrent && aggregate.replicationIds.some((id) => replicationIds.has(id)))
    .sort(
      (a, b) =>
        (a.metricKey < b.metricKey ? -1 : a.metricKey > b.metricKey ? 1 : 0) ||
        (a.replicationIds.join() < b.replicationIds.join() ? -1 : 1),
    );
}

/** A milestone as the achievement summary reads it: a task of the kind `milestone`. */
export interface MilestoneFact {
  readonly id: string;
  readonly replicationId: string | null;
  /** The planned date. */
  readonly dueDate: string | null;
  /** The date on which it was reached. */
  readonly completedDate: string | null;
}

export interface MilestoneAchievement {
  readonly total: number;
  readonly reachedOnTime: number;
  readonly reachedLate: number;
  readonly overdue: number;
  readonly upcoming: number;
  /** Milestones without a planned date, which are neither on time nor late. */
  readonly undated: number;
}

/** How many milestones were reached on time or late, are overdue or are still ahead, on a date. */
export function milestoneAchievement(milestones: readonly MilestoneFact[], today: string): MilestoneAchievement {
  let reachedOnTime = 0;
  let reachedLate = 0;
  let overdue = 0;
  let upcoming = 0;
  let undated = 0;
  for (const milestone of milestones) {
    if (milestone.completedDate !== null) {
      if (milestone.dueDate === null || milestone.completedDate <= milestone.dueDate) reachedOnTime += 1;
      else reachedLate += 1;
    } else if (milestone.dueDate === null) undated += 1;
    else if (milestone.dueDate < today) overdue += 1;
    else upcoming += 1;
  }
  return { total: milestones.length, reachedOnTime, reachedLate, overdue, upcoming, undated };
}

/** Basis to modality to category to a number, as a summary document stores it. */
export type BasisCounts = Partial<
  Record<"labReported" | "centrallyVerified", Partial<Record<RecruitmentModality, Record<string, number>>>>
>;

/**
 * The totals of a replication summary on a date: for each basis apart, the sum of the values that
 * the participations state, and how many participations state each value. The bases are never
 * mixed and an unknown value stays absent.
 */
export function summaryTotals(
  participationIds: readonly string[],
  reports: readonly ReportFact[],
  date: string,
): { readonly totals: BasisCounts; readonly reporting: BasisCounts; readonly latestAsOfDate: string | null } {
  const totals: BasisCounts = {};
  const reporting: BasisCounts = {};
  let latest: string | null = null;
  for (const state of resolveAll(participationIds, reports, { date }).values()) {
    if (state.latestAsOfDate !== null && (latest === null || state.latestAsOfDate > latest)) {
      latest = state.latestAsOfDate;
    }
    for (const [basis, counts] of [
      ["labReported", state.reported],
      ["centrallyVerified", state.verified],
    ] as const) {
      for (const [modality, categories] of Object.entries(counts) as [
        RecruitmentModality,
        Record<string, { value: number }>,
      ][]) {
        for (const [category, resolved] of Object.entries(categories)) {
          const sums = totals[basis] ?? {};
          const counted = reporting[basis] ?? {};
          const sumRow = sums[modality] ?? {};
          const countRow = counted[modality] ?? {};
          sumRow[category] = (sumRow[category] ?? 0) + resolved.value;
          countRow[category] = (countRow[category] ?? 0) + 1;
          sums[modality] = sumRow;
          counted[modality] = countRow;
          totals[basis] = sums;
          reporting[basis] = counted;
        }
      }
    }
  }
  return { totals, reporting, latestAsOfDate: latest };
}
