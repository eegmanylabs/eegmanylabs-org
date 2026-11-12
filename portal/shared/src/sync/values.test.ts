// Canonical values: each type read from the portal and from a sheet, written back, and compared.
// The values are synthetic.
import { describe, expect, it } from "vitest";
import {
  appValueOf,
  canonicalFromApp,
  canonicalFromSheet,
  displayCanonical,
  isoDateToSerial,
  type SyncFieldSpec,
  serialToIsoDate,
  sheetValueOf,
} from "./values";

const value = (result: ReturnType<typeof canonicalFromApp>) => (result.ok ? result.value : `refused: ${result.reason}`);

describe("canonical values", () => {
  it("normalise text: Unicode form, line endings and surrounding space, with empty as no value", () => {
    const text: SyncFieldSpec = { type: "text" };
    expect(value(canonicalFromApp(text, "Café\r\nBar "))).toBe("Café\nBar");
    expect(value(canonicalFromSheet(text, "  "))).toBeNull();
    expect(value(canonicalFromSheet(text, ""))).toBeNull();
    expect(value(canonicalFromSheet(text, null))).toBeNull();
    expect(value(canonicalFromApp(text, undefined))).toBeNull();
    expect(value(canonicalFromSheet(text, 42))).toBe("42");
  });

  it("compare numbers as numbers, from a number or a text, and refuse anything else", () => {
    const number: SyncFieldSpec = { type: "number" };
    expect(value(canonicalFromSheet(number, 64))).toBe("64");
    expect(value(canonicalFromSheet(number, " 64.0 "))).toBe("64");
    expect(value(canonicalFromSheet(number, -0))).toBe("0");
    expect(value(canonicalFromSheet(number, "1e3"))).toBe("1000");
    expect(canonicalFromSheet(number, "64 channels").ok).toBe(false);
    expect(canonicalFromSheet(number, true).ok).toBe(false);
    expect(canonicalFromApp(number, "64").ok).toBe(false);
    expect(appValueOf(number, "64")).toBe(64);
    expect(sheetValueOf(number, "64")).toBe(64);
  });

  it("read dates from a serial number or an ISO text, and write the serial so the cell keeps its format", () => {
    const date: SyncFieldSpec = { type: "date" };
    expect(serialToIsoDate(46_337)).toBe("2026-11-11");
    expect(serialToIsoDate(46_337.75)).toBe("2026-11-11");
    expect(isoDateToSerial("2026-11-11")).toBe(46_337);
    expect(value(canonicalFromSheet(date, 46_337))).toBe("2026-11-11");
    expect(value(canonicalFromSheet(date, "2026-11-11"))).toBe("2026-11-11");
    expect(canonicalFromSheet(date, "2026-02-30").ok).toBe(false);
    expect(canonicalFromApp(date, "11/11/2026").ok).toBe(false);
    expect(sheetValueOf(date, "2026-11-11")).toBe(46_337);
  });

  it("read booleans from a checkbox or the words true and false", () => {
    const flag: SyncFieldSpec = { type: "boolean" };
    expect(value(canonicalFromSheet(flag, true))).toBe("true");
    expect(value(canonicalFromSheet(flag, "FALSE"))).toBe("false");
    expect(canonicalFromSheet(flag, "yes").ok).toBe(false);
    expect(appValueOf(flag, "false")).toBe(false);
  });

  it("read lists whatever the separator, and write them with commas", () => {
    const numbers: SyncFieldSpec = { type: "numberList" };
    expect(value(canonicalFromSheet(numbers, "500;1000, 2000"))).toBe("500\u001f1000\u001f2000");
    expect(value(canonicalFromSheet(numbers, 500))).toBe("500");
    expect(canonicalFromSheet(numbers, "500, fast").ok).toBe(false);
    expect(value(canonicalFromApp(numbers, [500, 1000]))).toBe("500\u001f1000");
    expect(value(canonicalFromApp(numbers, []))).toBeNull();
    expect(appValueOf(numbers, "500\u001f1000")).toEqual([500, 1000]);
    expect(sheetValueOf(numbers, "500\u001f1000")).toBe("500, 1000");
    expect(displayCanonical("500\u001f1000")).toBe("500, 1000");
    const texts: SyncFieldSpec = { type: "textList" };
    expect(value(canonicalFromSheet(texts, "Gel cap\nSaline cap"))).toBe("Gel cap\u001fSaline cap");
    expect(appValueOf(texts, "Gel cap\u001fSaline cap")).toEqual(["Gel cap", "Saline cap"]);
  });

  it("accept only web addresses in a link", () => {
    const link: SyncFieldSpec = { type: "link" };
    expect(value(canonicalFromSheet(link, " https://example.org/lab "))).toBe("https://example.org/lab");
    expect(canonicalFromSheet(link, "example.org").ok).toBe(false);
    expect(canonicalFromSheet(link, "javascript:alert(1)").ok).toBe(false);
  });

  it("map an enumeration to its labels, without case, and refuse a label the mapping does not list", () => {
    const status: SyncFieldSpec = { type: "enum", options: { active: "Active", inactive: "Not active" } };
    expect(value(canonicalFromSheet(status, "not ACTIVE "))).toBe("inactive");
    expect(canonicalFromSheet(status, "Retired").ok).toBe(false);
    expect(canonicalFromApp(status, "retired").ok).toBe(false);
    expect(sheetValueOf(status, "inactive")).toBe("Not active");
  });

  it("write no value as an empty string, and never write a formula", () => {
    expect(sheetValueOf({ type: "text" }, null)).toBe("");
    expect(sheetValueOf({ type: "text" }, "=IMPORTRANGE(1)")).toBe("=IMPORTRANGE(1)");
    expect(appValueOf({ type: "text" }, null)).toBeUndefined();
  });
});
