// Unit tests of the structure check for workbooks whose layout is known from a description
// only. Every header and value here is invented, and every address is on example.org.
import { describe, expect, it } from "vitest";
import type { RawScalar } from "./model";
import { type ExpectedColumn, listedValues, matchHeader, spreadsheetIdentifierIn } from "./workbook-structure";

const EXPECTED: readonly ExpectedColumn[] = [
  { field: "name", header: "name" },
  { field: "secondaryEmail", header: "secondary_email" },
  { field: "eegSystem", header: "EEG_system" },
  { field: "replications", header: "whichReplication (Tags)", alternatives: ["whichReplication"] },
];

function match(rows: readonly (readonly RawScalar[])[], minimum = 2) {
  const width = Math.max(...rows.map((row) => row.length));
  const labels = Array.from({ length: width }, (_unused, index) => String.fromCharCode(65 + index));
  return matchHeader(labels, (row) => rows[row - 1] ?? [], rows.length, EXPECTED, minimum);
}

describe("the tolerant header match", () => {
  it("finds the header below a title line and accepts another case, spacing and punctuation", () => {
    const found = match([
      ["An invented title"],
      [],
      ["Name", "Secondary Email", "eeg-system", "whichReplication(Tags)"],
      ["Ada", "ada@example.org", "ExampleAmp", "AlphaBeta2001"],
    ]);
    expect(found.headerRow).toBe(3);
    expect([...found.columns]).toEqual([
      ["name", "A"],
      ["secondaryEmail", "B"],
      ["eegSystem", "C"],
      ["replications", "D"],
    ]);
    expect(found.missing).toEqual([]);
    // Every header that is spelt unlike the description is named, although it is accepted.
    expect(found.variants.map((variant) => [variant.expected, variant.found.text])).toEqual([
      ["name", "Name"],
      ["secondary_email", "Secondary Email"],
      ["EEG_system", "eeg-system"],
      ["whichReplication (Tags)", "whichReplication(Tags)"],
    ]);
  });

  it("accepts a stated alternative, and names every column that it does not recognise", () => {
    const found = match([["name", "whichReplication", "", "Timestamp", "secondary_email", "EEG_system", "name"]]);
    expect(found.columns.get("replications")).toBe("B");
    expect(found.unknown).toEqual([{ label: "D", text: "Timestamp" }]);
    expect(found.blank).toEqual(["C"]);
    expect(found.duplicated).toEqual(["name"]);
    expect(found.variants.map((variant) => variant.field)).toEqual(["replications"]);
  });

  it("names the expected headers that a row lacks, and matches nothing by a part of a header", () => {
    const found = match([["name", "email", "EEG_system_notes", "secondary_email"]]);
    expect(found.headerRow).toBe(1);
    expect(found.missing).toEqual(["EEG_system", "whichReplication (Tags)"]);
    expect(found.unknown.map((header) => header.text)).toEqual(["email", "EEG_system_notes"]);
  });

  it("finds no header where no row of the first ten holds enough of the expected ones", () => {
    const filler: RawScalar[][] = Array.from({ length: 10 }, () => ["an invented remark"]);
    const found = match([...filler, ["name", "secondary_email", "EEG_system"]]);
    expect(found.headerRow).toBeNull();
    expect(found.missing).toEqual(EXPECTED.map((column) => column.header));
    expect(match([["name", "something else"]]).headerRow).toBeNull();
  });
});

describe("the identifier of a spreadsheet in an address", () => {
  it("is read out of the two forms of address, whatever follows it", () => {
    const identifier = "an-invented-identifier_0123456789";
    expect(spreadsheetIdentifierIn(`https://sheets.example.org/spreadsheets/d/${identifier}/edit#gid=0`)).toBe(
      identifier,
    );
    expect(spreadsheetIdentifierIn(` https://sheets.example.org/spreadsheets/u/1/d/${identifier} `)).toBe(identifier);
    expect(spreadsheetIdentifierIn(`https://drive.example.org/open?id=${identifier}`)).toBe(identifier);
  });

  it("is never guessed out of a remark, a title or another kind of address", () => {
    expect(spreadsheetIdentifierIn("see the shared folder")).toBeNull();
    expect(spreadsheetIdentifierIn("https://sheets.example.org/document/d/an-invented-identifier/edit")).toBeNull();
    expect(spreadsheetIdentifierIn("mailto:someone@example.org")).toBeNull();
    expect(spreadsheetIdentifierIn("https://sheets.example.org/spreadsheets/d/short/edit")).toBeNull();
  });
});

describe("a cell that lists several values", () => {
  it("is split on commas, semicolons and line breaks, and on nothing else", () => {
    expect(listedValues("AlphaBeta2001, AlphaGamma2002;Delta1999\n Iota2004 ")).toEqual([
      "AlphaBeta2001",
      "AlphaGamma2002",
      "Delta1999",
      "Iota2004",
    ]);
    expect(listedValues("Epsilon Van Zeta 2010")).toEqual(["Epsilon Van Zeta 2010"]);
    expect(listedValues(" , ; ")).toEqual([]);
    expect(listedValues(null)).toEqual([]);
  });
});
