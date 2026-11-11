// The recurrence of a task (docs/DATA_MODEL.md, section 8): a subset of the RRULE of RFC 5545,
// stored as its text in `recurrenceRule`. A trigger creates the next occurrence when a task is
// completed, so the rule only ever answers one question: given the date of the occurrence that
// was just completed, and how many occurrences there have been, when is the next one?
//
// | Part         | Values                                                                   |
// |--------------|--------------------------------------------------------------------------|
// | `FREQ`       | `DAILY`, `WEEKLY` or `MONTHLY`                                           |
// | `INTERVAL`   | 1 to 365, every so many days, weeks or months. 1 when absent             |
// | `BYDAY`      | For a weekly rule: the days of the week, as `MO`, `TU`, `WE`, `TH`, `FR`, `SA` and `SU` |
// | `BYMONTHDAY` | For a monthly rule: the day of the month, 1 to 31, or -1 for the last day |
// | `UNTIL`      | The last date an occurrence may fall on, as `YYYYMMDD`                   |
// | `COUNT`      | How many occurrences there are in all, 1 to 1,000                        |
//
// A rule holds at most one of `UNTIL` and `COUNT`, as RFC 5545 requires. Weeks begin on Monday
// (`WKST=MO`, the default of RFC 5545). A month without the day that a monthly rule names is
// skipped, as RFC 5545 skips an invalid date: a rule on the 31st has no occurrence in April.

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** The days of the week in the order of RFC 5545 when the week begins on Monday. */
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const RECURRENCE_MAX_INTERVAL = 365;
export const RECURRENCE_MAX_COUNT = 1_000;

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  /** Weekly rules only: the days of the week, in week order. Empty means the day of the occurrence. */
  readonly weekdays: readonly Weekday[];
  /** Monthly rules only: the day of the month, or -1 for the last. Absent means the day of the occurrence. */
  readonly monthDay: number | null;
  /** The last date an occurrence may fall on, as an ISO date. */
  readonly until: string | null;
  /** How many occurrences there are in all. */
  readonly count: number | null;
}

const FREQUENCY_TEXT: Readonly<Record<string, RecurrenceFrequency>> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a text is an ISO date that names a day that exists. */
export function isIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (match === null) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function integer(text: string, minimum: number, maximum: number): number | null {
  if (!/^-?\d{1,4}$/.test(text)) return null;
  const value = Number(text);
  return value >= minimum && value <= maximum ? value : null;
}

/**
 * Reads the text of a rule, with or without the prefix `RRULE:`. Returns null for a text that
 * is not a rule of the subset: an unknown part, a part given twice, a value out of range, a
 * part that the frequency does not use, or both `UNTIL` and `COUNT`.
 */
export function parseRecurrenceRule(text: string): RecurrenceRule | null {
  const body = text.trim().replace(/^RRULE:/i, "");
  if (body === "" || body.length > 500) return null;
  const parts = new Map<string, string>();
  for (const part of body.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) return null;
    const name = part.slice(0, separator).toUpperCase();
    if (parts.has(name)) return null;
    parts.set(name, part.slice(separator + 1).toUpperCase());
  }
  const frequency = FREQUENCY_TEXT[parts.get("FREQ") ?? ""];
  if (frequency === undefined) return null;
  for (const name of parts.keys()) {
    if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "UNTIL", "COUNT", "WKST"].includes(name)) return null;
  }
  if (parts.has("WKST") && parts.get("WKST") !== "MO") return null;
  const interval = parts.has("INTERVAL") ? integer(parts.get("INTERVAL") ?? "", 1, RECURRENCE_MAX_INTERVAL) : 1;
  if (interval === null) return null;

  let weekdays: Weekday[] = [];
  if (parts.has("BYDAY")) {
    if (frequency !== "weekly") return null;
    const days = (parts.get("BYDAY") ?? "").split(",");
    if (days.some((day) => !(WEEKDAYS as readonly string[]).includes(day))) return null;
    if (new Set(days).size !== days.length) return null;
    weekdays = WEEKDAYS.filter((day) => days.includes(day));
  }

  let monthDay: number | null = null;
  if (parts.has("BYMONTHDAY")) {
    if (frequency !== "monthly") return null;
    monthDay = integer(parts.get("BYMONTHDAY") ?? "", -1, 31);
    if (monthDay === null || monthDay === 0) return null;
  }

  if (parts.has("UNTIL") && parts.has("COUNT")) return null;
  let until: string | null = null;
  if (parts.has("UNTIL")) {
    const match = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(parts.get("UNTIL") ?? "");
    if (match === null) return null;
    until = `${match[1]}-${match[2]}-${match[3]}`;
    if (!isIsoDate(until)) return null;
  }
  const count = parts.has("COUNT") ? integer(parts.get("COUNT") ?? "", 1, RECURRENCE_MAX_COUNT) : null;
  if (parts.has("COUNT") && count === null) return null;

  return { frequency, interval, weekdays, monthDay, until, count };
}

/** The text of a rule, in the order of its parts that RFC 5545 examples use. */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.frequency === "weekly" && rule.weekdays.length > 0) parts.push(`BYDAY=${rule.weekdays.join(",")}`);
  if (rule.frequency === "monthly" && rule.monthDay !== null) parts.push(`BYMONTHDAY=${rule.monthDay}`);
  if (rule.until !== null) parts.push(`UNTIL=${rule.until.replaceAll("-", "")}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

function ordinal(day: number): string {
  if (day === -1) return "last day";
  const tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${suffix}`;
}

function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** A rule in words, for the interface: "Every 2 weeks on Monday and Wednesday, 5 times". */
export function describeRecurrence(rule: RecurrenceRule): string {
  const unit = { daily: "day", weekly: "week", monthly: "month" }[rule.frequency];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.frequency === "weekly" && rule.weekdays.length > 0) {
    text += ` on ${listOf(rule.weekdays.map((day) => WEEKDAY_NAMES[day]))}`;
  }
  if (rule.frequency === "monthly" && rule.monthDay !== null) text += ` on the ${ordinal(rule.monthDay)}`;
  if (rule.until !== null) text += `, until ${rule.until}`;
  if (rule.count !== null) text += rule.count === 1 ? ", once" : `, ${rule.count} times`;
  return text;
}

// ===== Dates =====

function toDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = toDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** The day of the week of a date, 0 for Monday to 6 for Sunday. */
function weekdayIndex(isoDate: string): number {
  return (toDate(isoDate).getUTCDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The date of the next occurrence of a monthly rule after `current`. */
function nextMonthly(rule: RecurrenceRule, current: string): string | null {
  const start = toDate(current);
  const wanted = rule.monthDay ?? start.getUTCDate();
  // Within 12 intervals of a month that has the day, which every rule meets within a year.
  for (let step = 1; step <= 12 * 31; step += 1) {
    const monthIndex = start.getUTCMonth() + step * rule.interval;
    const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const length = daysInMonth(year, month);
    const day = wanted === -1 ? length : wanted;
    if (day <= length) return toIso(new Date(Date.UTC(year, month, day)));
  }
  return null;
}

/** The date of the next occurrence of a weekly rule after `current`, which is itself an occurrence. */
function nextWeekly(rule: RecurrenceRule, current: string): string {
  const days = rule.weekdays.length === 0 ? [WEEKDAYS[weekdayIndex(current)] as Weekday] : rule.weekdays;
  const indices = days.map((day) => WEEKDAYS.indexOf(day));
  const today = weekdayIndex(current);
  const later = indices.filter((index) => index > today);
  if (later.length > 0) return addDays(current, Math.min(...later) - today);
  // The first day of the rule in the week `interval` weeks after the week of `current`.
  const monday = addDays(current, -today);
  return addDays(monday, rule.interval * 7 + Math.min(...indices));
}

/**
 * The date of the occurrence that follows `current`, which is the date of occurrence number
 * `occurrence` (counted from 1), or null where the rule has ended: its count is reached, or
 * the next date falls after its last date.
 */
export function nextOccurrence(rule: RecurrenceRule, current: string, occurrence: number): string | null {
  if (!isIsoDate(current)) throw new RangeError(`"${current}" is not an ISO date.`);
  if (rule.count !== null && occurrence >= rule.count) return null;
  let next: string | null;
  switch (rule.frequency) {
    case "daily":
      next = addDays(current, rule.interval);
      break;
    case "weekly":
      next = nextWeekly(rule, current);
      break;
    case "monthly":
      next = nextMonthly(rule, current);
      break;
  }
  if (next === null) return null;
  if (rule.until !== null && next > rule.until) return null;
  return next;
}

/** The number of whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

/** An ISO date moved by a number of days. */
export function shiftIsoDate(isoDate: string, days: number): string {
  return addDays(isoDate, days);
}
