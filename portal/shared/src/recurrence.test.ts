import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  formatRecurrenceRule,
  isIsoDate,
  nextOccurrence,
  parseRecurrenceRule,
  type RecurrenceRule,
} from "./recurrence";

const rule = (text: string): RecurrenceRule => {
  const parsed = parseRecurrenceRule(text);
  if (parsed === null) throw new Error(`Not a rule: ${text}`);
  return parsed;
};

/** The dates of a series from its first occurrence, until the rule ends or `limit` dates. */
function series(text: string, first: string, limit = 10): string[] {
  const parsed = rule(text);
  const dates = [first];
  for (let occurrence = 1; dates.length < limit; occurrence += 1) {
    const next = nextOccurrence(parsed, dates.at(-1) as string, occurrence);
    if (next === null) break;
    dates.push(next);
  }
  return dates;
}

describe("parseRecurrenceRule", () => {
  it("reads every part of the subset, with or without the RRULE prefix and in any case", () => {
    expect(parseRecurrenceRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;COUNT=6")).toEqual({
      frequency: "weekly",
      interval: 2,
      weekdays: ["MO", "WE"],
      monthDay: null,
      until: null,
      count: 6,
    });
    expect(parseRecurrenceRule("freq=monthly;bymonthday=-1;until=20271231")).toEqual({
      frequency: "monthly",
      interval: 1,
      weekdays: [],
      monthDay: -1,
      until: "2027-12-31",
      count: null,
    });
    expect(parseRecurrenceRule("FREQ=DAILY;UNTIL=20261231T235959Z")?.until).toBe("2026-12-31");
  });

  it("refuses what the subset does not hold", () => {
    for (const text of [
      "",
      "FREQ=YEARLY",
      "FREQ=HOURLY",
      "INTERVAL=2",
      "FREQ=DAILY;INTERVAL=0",
      "FREQ=DAILY;INTERVAL=366",
      "FREQ=DAILY;BYDAY=MO",
      "FREQ=WEEKLY;BYDAY=XX",
      "FREQ=WEEKLY;BYDAY=MO,MO",
      "FREQ=WEEKLY;BYMONTHDAY=3",
      "FREQ=MONTHLY;BYMONTHDAY=0",
      "FREQ=MONTHLY;BYMONTHDAY=32",
      "FREQ=DAILY;COUNT=3;UNTIL=20261231",
      "FREQ=DAILY;COUNT=0",
      "FREQ=DAILY;UNTIL=20260230",
      "FREQ=DAILY;FREQ=WEEKLY",
      "FREQ=DAILY;BYSETPOS=1",
      "FREQ=WEEKLY;WKST=SU",
      "FREQ=DAILY;",
    ]) {
      expect(parseRecurrenceRule(text), text).toBeNull();
    }
  });

  it("writes a rule back as text that reads as the same rule", () => {
    for (const text of [
      "FREQ=DAILY",
      "FREQ=DAILY;INTERVAL=3;COUNT=4",
      "FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20270101",
      "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15",
    ]) {
      expect(formatRecurrenceRule(rule(text))).toBe(text);
      expect(parseRecurrenceRule(formatRecurrenceRule(rule(text)))).toEqual(rule(text));
    }
  });

  it("describes a rule in words", () => {
    expect(describeRecurrence(rule("FREQ=DAILY"))).toBe("Every day");
    expect(describeRecurrence(rule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=5"))).toBe(
      "Every 2 weeks on Monday, Wednesday and Friday, 5 times",
    );
    expect(describeRecurrence(rule("FREQ=MONTHLY;BYMONTHDAY=22;UNTIL=20271231"))).toBe(
      "Every month on the 22nd, until 2027-12-31",
    );
    expect(describeRecurrence(rule("FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=1"))).toBe("Every month on the last day, once");
    expect(describeRecurrence(rule("FREQ=MONTHLY;BYMONTHDAY=11"))).toBe("Every month on the 11th");
  });
});

describe("nextOccurrence", () => {
  it("steps a daily rule by its interval", () => {
    expect(series("FREQ=DAILY;INTERVAL=3;COUNT=4", "2026-12-30")).toEqual([
      "2026-12-30",
      "2027-01-02",
      "2027-01-05",
      "2027-01-08",
    ]);
  });

  it("visits the days of a weekly rule in order, and skips weeks by its interval", () => {
    // 2026-11-09 is a Monday.
    expect(series("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "2026-11-09", 6)).toEqual([
      "2026-11-09",
      "2026-11-12",
      "2026-11-23",
      "2026-11-26",
      "2026-12-07",
      "2026-12-10",
    ]);
    // Without days, a weekly rule keeps the day of the week of the occurrence.
    expect(series("FREQ=WEEKLY;COUNT=3", "2026-11-11")).toEqual(["2026-11-11", "2026-11-18", "2026-11-25"]);
  });

  it("skips months that lack the day of a monthly rule, and takes the last day where asked", () => {
    expect(series("FREQ=MONTHLY;BYMONTHDAY=31", "2027-01-31", 4)).toEqual([
      "2027-01-31",
      "2027-03-31",
      "2027-05-31",
      "2027-07-31",
    ]);
    expect(series("FREQ=MONTHLY;BYMONTHDAY=-1", "2028-01-31", 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    expect(series("FREQ=MONTHLY;INTERVAL=6", "2026-08-15", 3)).toEqual(["2026-08-15", "2027-02-15", "2027-08-15"]);
  });

  it("ends a series at its count and at its last date", () => {
    expect(series("FREQ=DAILY;COUNT=1", "2026-11-11")).toEqual(["2026-11-11"]);
    expect(series("FREQ=DAILY;UNTIL=20261113", "2026-11-11")).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(nextOccurrence(rule("FREQ=DAILY;COUNT=5"), "2026-11-11", 5)).toBeNull();
  });

  it("refuses a date that does not exist", () => {
    expect(() => nextOccurrence(rule("FREQ=DAILY"), "2026-02-30", 1)).toThrow(RangeError);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });
});
