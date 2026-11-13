// The status of a record at a past moment. Fixtures are synthetic.
import { describe, expect, it } from "vitest";
import { statusAt } from "./status-on-date";

const at = (iso: string) => new Date(iso);
const entry = (toStatusKey: string, effective: string, recorded = effective) => ({
  toStatusKey,
  effectiveAt: at(effective),
  recordedAt: at(recorded),
});

const HISTORY = [
  entry("planning", "2024-01-10T09:00:00Z"),
  entry("recruiting", "2024-06-01T00:00:00Z"),
  entry("paused", "2025-02-01T12:00:00Z"),
  entry("recruiting", "2025-04-15T08:00:00Z"),
];

describe("statusAt", () => {
  it("gives the status of the last change that took effect before the moment", () => {
    expect(statusAt(HISTORY, at("2025-03-01T00:00:00Z"))).toMatchObject({ kind: "status", statusKey: "paused" });
    expect(statusAt(HISTORY, at("2024-06-01T00:00:01Z"))).toMatchObject({ statusKey: "recruiting" });
    expect(statusAt(HISTORY, at("2026-01-01T00:00:00Z"))).toMatchObject({ statusKey: "recruiting" });
  });

  it("gives no status before the first change, and the order of the entries does not matter", () => {
    expect(statusAt(HISTORY, at("2024-01-10T09:00:00Z"))).toEqual({ kind: "none" });
    expect(statusAt([...HISTORY].reverse(), at("2025-03-01T00:00:00Z"))).toMatchObject({ statusKey: "paused" });
    expect(statusAt([], at("2025-03-01T00:00:00Z"))).toEqual({ kind: "none" });
  });

  it("lets the entry recorded later hold where two took effect together", () => {
    const corrected = [
      entry("paused", "2025-02-01T12:00:00Z", "2025-02-01T12:00:00Z"),
      entry("withdrawn", "2025-02-01T12:00:00Z", "2025-02-03T10:00:00Z"),
    ];
    expect(statusAt(corrected, at("2025-03-01T00:00:00Z"))).toMatchObject({ statusKey: "withdrawn" });
    expect(statusAt([...corrected].reverse(), at("2025-03-01T00:00:00Z"))).toMatchObject({ statusKey: "withdrawn" });
  });

  it("says when the status that held was entered only afterwards", () => {
    const backdated = [...HISTORY, entry("completed", "2025-05-01T00:00:00Z", "2025-07-01T00:00:00Z")];
    expect(statusAt(backdated, at("2025-06-01T00:00:00Z"))).toMatchObject({
      statusKey: "completed",
      recordedLater: true,
    });
    expect(statusAt(backdated, at("2025-08-01T00:00:00Z"))).toMatchObject({ recordedLater: false });
  });
});
