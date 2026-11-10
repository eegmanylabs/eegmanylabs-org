// Unit tests of the checks of external codes. The codes with the item number 900001 and above
// are invented for these tests, and the others are well-known public concept identifiers that
// serve as an independent check of the tables.
import { describe, expect, it } from "vitest";
import { hasValidVerhoeffDigit, parseExternalCode } from "./codes";

describe("hasValidVerhoeffDigit", () => {
  it.each(["22298006", "73211009", "404684003", "138875005", "999000011000000103"])(
    "accepts the public identifier %s",
    (code) => {
      expect(hasValidVerhoeffDigit(code)).toBe(true);
    },
  );

  it("refuses a changed digit and two neighbouring digits that have changed places", () => {
    expect(hasValidVerhoeffDigit("22298007")).toBe(false);
    expect(hasValidVerhoeffDigit("22289006")).toBe(false);
    expect(hasValidVerhoeffDigit("73211090")).toBe(false);
  });

  it("refuses anything but digits", () => {
    expect(hasValidVerhoeffDigit("")).toBe(false);
    expect(hasValidVerhoeffDigit("2229800x")).toBe(false);
    expect(hasValidVerhoeffDigit(" 22298006")).toBe(false);
  });
});

describe("parseExternalCode", () => {
  it("accepts the prefix snomed with a code of 6 to 18 digits and a correct check digit", () => {
    expect(parseExternalCode("snomed:900001007")).toEqual({
      status: "accepted",
      system: "snomed",
      code: "900001007",
      extension: false,
    });
    // White space around the cell does not change the reading. The cell itself is stored as written.
    expect(parseExternalCode("  snomed:900002000 ")).toMatchObject({ status: "accepted", code: "900002000" });
  });

  it("tells a code of the long format, which belongs to the extension of one namespace", () => {
    expect(parseExternalCode("snomed:90000501000000106")).toMatchObject({ status: "accepted", extension: true });
    expect(parseExternalCode("snomed:999000011000000103")).toMatchObject({ status: "accepted", extension: true });
    expect(parseExternalCode("snomed:22298006")).toMatchObject({ status: "accepted", extension: false });
  });

  it("refuses a failing check digit, and says that this is what failed", () => {
    expect(parseExternalCode("snomed:900001008")).toEqual({ status: "checkDigit" });
  });

  it("refuses another prefix, whatever its code", () => {
    expect(parseExternalCode("icd10:F32")).toEqual({ status: "unknownPrefix" });
    expect(parseExternalCode("SNOMED:900001007")).toEqual({ status: "unknownPrefix" });
  });

  it.each([
    ["a local identifier", "trm_001"],
    ["a bare code", "900001007"],
    ["a code that is too short", "snomed:12345"],
    ["a code of more than 18 digits", "snomed:1234567890123456789"],
    ["a code with a leading zero", "snomed:0900001007"],
    ["letters in the code", "snomed:9000A1007"],
    ["two codes in one cell", "snomed:900001007, snomed:900002000"],
    ["an empty cell", ""],
  ])("refuses %s as a value of another shape", (_label, cell) => {
    expect(parseExternalCode(cell)).toEqual({ status: "shape" });
  });
});
