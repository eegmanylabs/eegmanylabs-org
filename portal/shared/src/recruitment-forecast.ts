// The recruitment forecast (docs/DATA_MODEL.md, section 15): a projection of when a replication
// reaches its target, from the rates its laboratories have shown in their recent reports. It is a
// deterministic extrapolation from stated assumptions, not a statistical model, and every figure it
// produces is labelled projected.
//
// | Step | What it does |
// |------|--------------|
// | Current value | The effective cumulative value of the chosen modality and category of each participation on `inputsAsOf`. A participation that states none adds nothing, and the forecast says how many did |
// | Target | The stated target, or else the sum of the agreed targets of the participations. To end with that many after exclusions, the projection aims at `target / (1 - exclusionRate)` |
// | Rate | For each active participation, the change between the value that held at the start of the window, or the earliest value within it where none held, and the value at its end, divided by the days between the dates of the two reports. A participation with fewer than two dated values in the window has no rate and adds nothing. A negative rate, which only a correction can produce, counts as zero. Where no active participation has a rate, the rate of a scenario and its completion are unknown, never zero |
// | Range | The window is split in two halves. The slower and the faster of the two half-window rates give the range around each scenario. With fewer than two half-window rates the range is the rate itself. The range is not a confidence interval |
// | Pauses | A day inside a planned pause of a participation adds nothing for that participation |
// | Scenarios | Optimistic, central and conservative multiply every rate by `1 + spread`, 1 and `1 - spread` |
// | Completion | The first day on which the current value and the projected gains reach the aim, within five years of `inputsAsOf`, or none |
// | Rounding | The aim is a whole number of people, rounded up, and the projected series counts whole people, rounded down |

import { monthEnds, type ReportFact, resolveAll, resolvedValue } from "./recruitment-effective";
import {
  FIGURE_BASES,
  type FigureBasis,
  observedRate,
  type ParticipationFacts,
  REPORTING_STATUSES,
  targetFigure,
} from "./recruitment-rollup";
import { daysBetween, shiftIsoDate } from "./recurrence";
import { idSchema, isoDateSchema, keySchema } from "./schemas/base";
import { z } from "./zod";

/** The version of the method below. A change to the method changes it, so a stored run says which method made it. */
export const FORECAST_METHOD_VERSION = "recruitment-forecast/2";

/** How far ahead the projection looks: five years. */
export const FORECAST_HORIZON_DAYS = 1_826;

/** The most points of the projected series that a run keeps: three years of month ends. */
export const FORECAST_SERIES_MAX = 36;

export const FORECAST_SCENARIOS = ["optimistic", "central", "conservative"] as const;
export type ForecastScenario = (typeof FORECAST_SCENARIOS)[number];

export const FORECAST_SCENARIO_LABELS: Readonly<Record<ForecastScenario, string>> = {
  optimistic: "Optimistic",
  central: "Central",
  conservative: "Conservative",
};

/** The assumptions a person states. Everything else the forecast reads from the reports. */
export const forecastAssumptionsSchema = z.strictObject({
  /** The modality projected. Unique participants have no agreed target, so they are not offered. */
  modality: z.enum(["main", "rest"]),
  /** The count category whose growth is projected, for example `tested`. */
  category: keySchema,
  /** The number to reach after exclusions, or null for the sum of the agreed targets. */
  target: z.number().int().min(1).max(1_000_000).nullable(),
  /** The share of those counted that is expected to be lost to exclusions, from 0 to 0.95. */
  exclusionRate: z.number().min(0).max(0.95),
  /** The days of reports before `inputsAsOf` from which each rate is taken. */
  windowDays: z.number().int().min(14).max(730),
  /** How far the optimistic and the conservative scenarios move every rate, from 0 to 0.9. */
  scenarioSpread: z.number().min(0).max(0.9),
  /** The participations that go on collecting. */
  activeParticipationIds: z.array(idSchema).max(500),
  /** Whether the planned pauses stop a participation's gains while they last. */
  includePlannedPauses: z.boolean(),
  /** The date up to which reports are taken into account. */
  inputsAsOf: isoDateSchema,
});
export type ForecastAssumptions = z.output<typeof forecastAssumptionsSchema>;

/** A planned pause as the forecast reads it. */
export interface PauseFact {
  readonly participationId: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** The assumptions a forecast starts with, before a person changes any. */
export function defaultAssumptions(participations: readonly ParticipationFacts[], today: string): ForecastAssumptions {
  return {
    modality: "main",
    category: "tested",
    target: null,
    exclusionRate: 0.1,
    windowDays: 90,
    scenarioSpread: 0.25,
    activeParticipationIds: participations
      .filter((participation) => participation.status === "collecting")
      .map((participation) => participation.id)
      .sort(),
    includePlannedPauses: true,
    inputsAsOf: today,
  };
}

/** What the forecast found for one participation. */
export interface ForecastLaboratory {
  readonly participationId: string;
  readonly laboratoryId: string;
  readonly active: boolean;
  /** The value on `inputsAsOf`, or null where it is unknown. */
  readonly current: number | null;
  /** Participants a day over the window, or null where it cannot be worked out. */
  readonly rate: number | null;
  readonly rateLow: number | null;
  readonly rateHigh: number | null;
  readonly rateFrom: string | null;
  readonly rateTo: string | null;
  /** Days of planned pause within the horizon, where pauses are included. */
  readonly pausedDays: number;
}

/** One point of a projected series. */
export interface ProjectionPoint {
  readonly date: string;
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

export interface ScenarioResult {
  readonly rateMultiplier: number;
  /**
   * The participants a day of all active participations together, outside pauses, or null where
   * no active participation has a rate, so that an unknown rate is never shown as zero.
   */
  readonly dailyRate: number | null;
  readonly completionDate: string | null;
  /** The completion with the faster half-window rates. */
  readonly earliestCompletionDate: string | null;
  /** The completion with the slower half-window rates. */
  readonly latestCompletionDate: string | null;
  readonly series: readonly ProjectionPoint[];
}

export interface ForecastResult {
  readonly methodVersion: string;
  readonly inputsAsOf: string;
  /** The number to reach after exclusions, or null where no target is known. */
  readonly target: number | null;
  /** Whether the target is the sum of agreed targets of every participation, or was stated. */
  readonly targetBasis: "stated" | "agreed" | "agreedIncomplete" | "unknown";
  /** The number to count before exclusions: `target / (1 - exclusionRate)`. */
  readonly aim: number | null;
  readonly current: number;
  /** What the current value rests on: reported values, verified values or both. */
  readonly currentBases: readonly FigureBasis[];
  /** How many participations state a current value, of those expected to. */
  readonly currentKnown: number;
  readonly currentExpected: number;
  readonly laboratories: readonly ForecastLaboratory[];
  readonly scenarios: Readonly<Record<ForecastScenario, ScenarioResult>>;
  /** Plain statements of what limits the result. */
  readonly notes: readonly string[];
}

function pausedOn(pauses: readonly PauseFact[], date: string): boolean {
  return pauses.some((pause) => pause.startsOn <= date && date <= pause.endsOn);
}

const positive = (rate: number | null): number => (rate === null || rate < 0 ? 0 : rate);

interface ProjectionLab {
  readonly rate: number;
  readonly pauses: readonly PauseFact[];
}

/** The day-by-day projection of one set of rates: the value on each day after `start`, up to the horizon. */
function project(start: string, current: number, labs: readonly ProjectionLab[], aim: number | null) {
  const values = new Map<string, number>();
  let total = current;
  let completion: string | null = aim !== null && current >= aim ? start : null;
  for (let day = 1; day <= FORECAST_HORIZON_DAYS; day += 1) {
    const date = shiftIsoDate(start, day);
    for (const lab of labs) if (!pausedOn(lab.pauses, date)) total += lab.rate;
    values.set(date, total);
    if (completion === null && aim !== null && total >= aim) completion = date;
  }
  return { values, completion };
}

/**
 * The forecast of one replication from its participations, their reports and their planned
 * pauses, under stated assumptions. Pure: the same inputs give the same result.
 */
export function forecastRecruitment(
  participations: readonly ParticipationFacts[],
  reports: readonly ReportFact[],
  pauses: readonly PauseFact[],
  assumptions: ForecastAssumptions,
): ForecastResult {
  const { modality, category, inputsAsOf } = assumptions;
  const notes: string[] = [];
  const ids = participations.map((participation) => participation.id);
  const states = resolveAll(ids, reports, { date: inputsAsOf });

  let current = 0;
  let currentKnown = 0;
  let currentExpected = 0;
  const bases = new Set<FigureBasis>();
  for (const participation of participations) {
    const state = states.get(participation.id);
    const value = state === undefined ? undefined : resolvedValue(state.effective, modality, category);
    const expected = REPORTING_STATUSES.has(participation.status) || state?.latestAsOfDate != null;
    if (expected || value !== undefined) currentExpected += 1;
    if (value === undefined) continue;
    currentKnown += 1;
    current += value.value;
    bases.add(value.basis === "centrallyVerified" ? "verified" : "reported");
  }
  if (currentKnown < currentExpected) {
    notes.push(
      `${currentExpected - currentKnown} of ${currentExpected} participations state no current value, which counts as nothing here.`,
    );
  }

  let target: number | null;
  let targetBasis: ForecastResult["targetBasis"];
  if (assumptions.target !== null) {
    target = assumptions.target;
    targetBasis = "stated";
  } else {
    const agreed = targetFigure(participations, states, modality);
    target = agreed.value;
    targetBasis = agreed.value === null ? "unknown" : agreed.complete ? "agreed" : "agreedIncomplete";
    if (targetBasis === "agreedIncomplete") {
      notes.push(
        `${agreed.expected - agreed.known} participations have no agreed target, so the target is a lower bound.`,
      );
    }
  }
  if (target === null) notes.push("No target is known, so no completion date can be projected.");
  // A whole number of people, rounded up so that the aim is never short of the target.
  const aim = target === null ? null : Math.ceil(target / (1 - assumptions.exclusionRate) - 1e-9);

  const windowStart = shiftIsoDate(inputsAsOf, -assumptions.windowDays);
  const windowMiddle = shiftIsoDate(inputsAsOf, -Math.floor(assumptions.windowDays / 2));
  const active = new Set(assumptions.activeParticipationIds);
  const horizonEnd = shiftIsoDate(inputsAsOf, FORECAST_HORIZON_DAYS);
  const laboratories: ForecastLaboratory[] = participations.map((participation) => {
    const rate = observedRate(participation.id, reports, "effective", modality, category, windowStart, inputsAsOf);
    const halves = [
      observedRate(participation.id, reports, "effective", modality, category, windowStart, windowMiddle).perDay,
      observedRate(participation.id, reports, "effective", modality, category, windowMiddle, inputsAsOf).perDay,
    ].filter((value): value is number => value !== null);
    const own = assumptions.includePlannedPauses
      ? pauses.filter((pause) => pause.participationId === participation.id)
      : [];
    let pausedDays = 0;
    for (const pause of own) {
      // Only the days after the inputs and within the horizon count. ISO dates sort as dates.
      const [from = pause.startsOn] = [pause.startsOn, shiftIsoDate(inputsAsOf, 1)].sort().reverse();
      const [to = pause.endsOn] = [pause.endsOn, horizonEnd].sort();
      if (from <= to) pausedDays += daysBetween(from, to) + 1;
    }
    const state = states.get(participation.id);
    const value = state === undefined ? undefined : resolvedValue(state.effective, modality, category);
    return {
      participationId: participation.id,
      laboratoryId: participation.laboratoryId,
      active: active.has(participation.id),
      current: value?.value ?? null,
      rate: rate.perDay,
      rateLow: rate.perDay === null ? null : halves.length === 2 ? Math.min(...halves) : rate.perDay,
      rateHigh: rate.perDay === null ? null : halves.length === 2 ? Math.max(...halves) : rate.perDay,
      rateFrom: rate.fromDate,
      rateTo: rate.toDate,
      pausedDays,
    };
  });
  const withoutRate = laboratories.filter((laboratory) => laboratory.active && laboratory.rate === null).length;
  if (withoutRate > 0) {
    notes.push(
      `${withoutRate} active participations have fewer than two dated values in the window, so they add nothing to the projection.`,
    );
  }
  if (laboratories.some((laboratory) => laboratory.active && laboratory.rate !== null && laboratory.rate < 0)) {
    notes.push("A negative rate, which a correction can produce, counts as zero.");
  }

  const pausesOf = (participationId: string) =>
    assumptions.includePlannedPauses ? pauses.filter((pause) => pause.participationId === participationId) : [];
  const counted = laboratories.filter((laboratory) => laboratory.active);
  const ends = monthEnds(shiftIsoDate(inputsAsOf, 1), horizonEnd).slice(0, FORECAST_SERIES_MAX);

  const anyRate = counted.some((laboratory) => laboratory.rate !== null);
  if (counted.length > 0 && !anyRate) {
    notes.push("No active laboratory has two dated values in the window, so the rate and the completion are unknown.");
  }

  const scenario = (multiplier: number): ScenarioResult => {
    if (!anyRate) {
      return {
        rateMultiplier: multiplier,
        dailyRate: null,
        completionDate: aim !== null && current >= aim ? inputsAsOf : null,
        earliestCompletionDate: aim !== null && current >= aim ? inputsAsOf : null,
        latestCompletionDate: aim !== null && current >= aim ? inputsAsOf : null,
        series: [],
      };
    }
    const labs = (pick: (laboratory: ForecastLaboratory) => number | null): ProjectionLab[] =>
      counted.map((laboratory) => ({
        rate: positive(pick(laboratory)) * multiplier,
        pauses: pausesOf(laboratory.participationId),
      }));
    const central = project(
      inputsAsOf,
      current,
      labs((laboratory) => laboratory.rate),
      aim,
    );
    const slow = project(
      inputsAsOf,
      current,
      labs((laboratory) => laboratory.rateLow),
      aim,
    );
    const fast = project(
      inputsAsOf,
      current,
      labs((laboratory) => laboratory.rateHigh),
      aim,
    );
    // The series runs to the first month end on or after the slowest completion, or to its cap.
    const last = slow.completion ?? central.completion;
    const reached = last === null ? -1 : ends.findIndex((date) => date >= last);
    // Whole people, rounded down: a projection never counts someone who has not come.
    const whole = (value: number | undefined) => Math.floor((value ?? current) + 1e-9);
    const series = ends.slice(0, reached === -1 ? ends.length : reached + 1).map((date) => ({
      date,
      value: whole(central.values.get(date)),
      low: whole(slow.values.get(date)),
      high: whole(fast.values.get(date)),
    }));
    return {
      rateMultiplier: multiplier,
      dailyRate: round(counted.reduce((sum, laboratory) => sum + positive(laboratory.rate) * multiplier, 0)),
      completionDate: central.completion,
      earliestCompletionDate: fast.completion,
      latestCompletionDate: slow.completion,
      series,
    };
  };

  return {
    methodVersion: FORECAST_METHOD_VERSION,
    inputsAsOf,
    target,
    targetBasis,
    aim,
    current,
    currentBases: FIGURE_BASES.filter((basis) => bases.has(basis)),
    currentKnown,
    currentExpected,
    laboratories,
    scenarios: {
      optimistic: scenario(1 + assumptions.scenarioSpread),
      central: scenario(1),
      conservative: scenario(1 - assumptions.scenarioSpread),
    },
    notes,
  };
}

/** Four decimal places of a rate a day, so that a rate a month read from it keeps its first decimal. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

const nullableNumber = z.number().nullable();
const nullableDate = isoDateSchema.nullable();

const scenarioResultSchema = z.strictObject({
  rateMultiplier: z.number(),
  dailyRate: z.number().nullable(),
  completionDate: nullableDate,
  earliestCompletionDate: nullableDate,
  latestCompletionDate: nullableDate,
  series: z
    .array(z.strictObject({ date: isoDateSchema, value: z.number(), low: z.number(), high: z.number() }))
    .max(FORECAST_SERIES_MAX),
});

/**
 * What a stored run keeps beside the stated assumptions: the inputs the forecast derived from the
 * reports, for the replication as a whole. Every member reads a run, so it keeps no figure of a
 * single laboratory, whose reports only its scope reads; the forecast page works out the figures
 * of each laboratory again from the reports its viewer may read.
 */
const derivedInputsSchema = z.strictObject({
  target: nullableNumber,
  targetBasis: z.enum(["stated", "agreed", "agreedIncomplete", "unknown"]),
  aim: nullableNumber,
  current: z.number(),
  currentBases: z.array(z.enum(FIGURE_BASES)).max(FIGURE_BASES.length),
  currentKnown: z.number().int().min(0),
  currentExpected: z.number().int().min(0),
  notes: z.array(z.string().max(500)).max(20),
});

/** A stored run read back: the result of the replication as a whole, without the laboratories. */
export type StoredForecastResult = Omit<ForecastResult, "laboratories">;

/** The `assumptions` and `scenarios` maps of a `forecastRuns` document for a result. */
export function forecastRunMaps(
  assumptions: ForecastAssumptions,
  result: ForecastResult,
): {
  readonly assumptions: Record<string, unknown>;
  readonly scenarios: Record<ForecastScenario, Record<string, unknown>>;
} {
  const derived: z.output<typeof derivedInputsSchema> = {
    target: result.target,
    targetBasis: result.targetBasis,
    aim: result.aim,
    current: result.current,
    currentBases: [...result.currentBases],
    currentKnown: result.currentKnown,
    currentExpected: result.currentExpected,
    notes: [...result.notes],
  };
  const scenario = (key: ForecastScenario): Record<string, unknown> => ({ ...result.scenarios[key] });
  return {
    assumptions: { stated: { ...assumptions }, derived },
    scenarios: {
      optimistic: scenario("optimistic"),
      central: scenario("central"),
      conservative: scenario("conservative"),
    },
  };
}

/** A stored run read back as the result it records, or null where its maps do not have the shape of this method. */
export function readForecastRun(run: {
  readonly methodVersion: string;
  readonly inputsAsOf: string;
  readonly assumptions: Readonly<Record<string, unknown>>;
  readonly scenarios: Readonly<Record<ForecastScenario, Readonly<Record<string, unknown>>>>;
}): { readonly assumptions: ForecastAssumptions; readonly result: StoredForecastResult } | null {
  if (run.methodVersion !== FORECAST_METHOD_VERSION) return null;
  const stated = forecastAssumptionsSchema.safeParse(run.assumptions.stated);
  const derived = derivedInputsSchema.safeParse(run.assumptions.derived);
  const optimistic = scenarioResultSchema.safeParse(run.scenarios.optimistic);
  const central = scenarioResultSchema.safeParse(run.scenarios.central);
  const conservative = scenarioResultSchema.safeParse(run.scenarios.conservative);
  if (!stated.success || !derived.success || !optimistic.success || !central.success || !conservative.success) {
    return null;
  }
  return {
    assumptions: stated.data,
    result: {
      methodVersion: run.methodVersion,
      inputsAsOf: run.inputsAsOf,
      ...derived.data,
      scenarios: { optimistic: optimistic.data, central: central.data, conservative: conservative.data },
    },
  };
}
