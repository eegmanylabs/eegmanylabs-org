// Calendar dates of recruitment. A report holds for a calendar date, an ISO text without a time
// zone (docs/DATA_MODEL.md, section 1), so a date is shown and compared as that text.
import { endOfPreviousMonth, isIsoDate } from "@eegml/shared";
import { todayIso } from "@/views/use-view-data";

const days = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const months = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A calendar date in words, for example "31 March 2026". */
export function formatDay(isoDate: string): string {
  return days.format(new Date(`${isoDate}T00:00:00Z`));
}

/** The month of a calendar date in words, for example "March 2026". */
export function formatMonth(isoDate: string): string {
  return months.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Today in the reader's calendar. */
export function today(): string {
  return todayIso();
}

/** The last day of the previous month, in the reader's calendar. */
export function endOfLastMonth(): string {
  return endOfPreviousMonth(today());
}

/** A date read from an address or a form, or the fallback where it is not a date that exists. */
export function dateOr(value: string | null, fallback: string): string {
  return value !== null && isIsoDate(value) ? value : fallback;
}

/** The first day of the month `months` months before the month of a date. */
export function startOfMonthsBefore(isoDate: string, months: number): string {
  const total = Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1 - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}
