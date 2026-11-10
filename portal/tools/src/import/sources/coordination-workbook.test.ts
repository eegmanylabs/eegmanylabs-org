// Unit tests of the structure check of the importer of the historical replication coordination
// workbook (source A). The workbook is the synthetic fixture, which encodes only what the
// project brief states: every study, person, number and address (on example.org) in it is
// invented, and nothing here is a fact about the real workbook.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CoordinationWorkbookOptions,
  coordinationWorkbook,
  SUMMARY_HEADERS,
} from "../fixtures/coordination-workbook";
import type { SourceReading } from "../model";
import { SOURCE_DEFINITIONS, SYNTHETIC_FIXTURES_ONLY } from "../registry";
import { importer, REVIEWED_TABS, SUMMARY_COLUMNS } from "./coordination-workbook";

const READ_CONTEXT = { secret: "a-synthetic-hash-key-for-the-import-tests" };
const directory = mkdtempSync(path.join(tmpdir(), "eegml-coordination-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

let files = 0;
async function reading(options: CoordinationWorkbookOptions = {}): Promise<SourceReading> {
  files += 1;
  const file = path.join(directory, `coordination-${files}.xlsx`);
  writeFileSync(file, await coordinationWorkbook(options));
  return importer.read({ path: file, observedOn: "2026-11-09" }, READ_CONTEXT);
}

describe("the registry entry of source A", () => {
  it("says that the importer is built against synthetic fixtures only", () => {
    const definition = SOURCE_DEFINITIONS.find((candidate) => candidate.key === importer.sourceKey);
    expect(definition?.notes).toBe(SYNTHETIC_FIXTURES_ONLY);
    expect(importer.summary).toContain("synthetic fixtures only");
    // The seven fields are those that the brief states.
    expect(SUMMARY_COLUMNS.map((column) => column.header)).toEqual([...SUMMARY_HEADERS]);
  });
});

describe("the structure check of source A", () => {
  it("reads a workbook with a summary tab and a tab in the outreach layout, whatever their titles are", async () => {
    const read = await reading();
    expect(read.issues).toEqual([]);
    expect(read.tabs.map((tab) => [tab.name, tab.visibility, tab.headerRow])).toEqual([
      ["Invented summary", "visible", 1],
      ["Invented outreach", "hidden", 2],
    ]);
    const [summary] = read.tabs;
    const classes = (summary?.rows ?? []).filter((row) => row.cellLevel !== true).map((row) => row.rowClass);
    expect(classes).toEqual(["header", ...Array(6).fill("data"), "derived"]);
    expect(summary?.blankRows).toBe(2);
    // A study row is keyed by its folded identifier, and never by its row number.
    expect((summary?.rows ?? []).filter((row) => row.rowClass === "data").map((row) => row.rowKey)).toEqual([
      "alphabeta2001",
      "alphagamma2002",
      "delta1999",
      "epsilonvanzeta2010",
      "iota2004etatheta2005",
      "nosuchstudy1999",
    ]);
  });

  it("stops when no tab holds the summary, and counts what it found in place of it", async () => {
    const read = await reading({ withoutSummary: true });
    expect(read.issues).toEqual([
      expect.objectContaining({
        check: "summary",
        tabKey: null,
        expected: SUMMARY_HEADERS.join(" | "),
        found: "no summary tab",
        message:
          "The workbook holds 0 tabs with the seven summary headers in row 1, each once, where exactly one is expected. 1 tabs were read: " +
          "0 with the layout of a leads tab, 1 with the layout of an outreach tab and 0 with none of the layouts that the importer reads.",
      }),
    ]);
  });

  it("stops on a second summary tab, which would give one study two current figures for one metric", async () => {
    const read = await reading({ secondSummary: true });
    expect(read.issues).toEqual([expect.objectContaining({ check: "summary", tabKey: null, found: "2 summary tabs" })]);
  });

  it("stops on a headed column of the summary that the brief does not name, and names the column in the report", async () => {
    const read = await reading({ extraColumn: { header: "Comments", value: "an invented comment" } });
    expect(read.issues).toEqual([
      expect.objectContaining({ check: "unknownColumn", expected: SUMMARY_HEADERS.join(" | "), found: "H: Comments" }),
    ]);
    // The message, which is printed and logged, quotes no header and no cell.
    expect(read.issues[0]?.message).toContain("1 headed columns that the brief does not name");
    expect(read.issues[0]?.message).not.toMatch(/Comments|invented comment/);
  });

  it("keeps an empty table of reviewed tabs in the module, since no title of the real workbook is known", () => {
    expect(REVIEWED_TABS).toEqual([]);
    expect(importer.after).toEqual(["f"]);
  });

  it("recognises summary headers in another spelling, and names each as found, each missing one and each unknown one", async () => {
    const read = await reading({
      headers: [
        "Study ID",
        "leader",
        "N Labs Signed",
        "TotalNSubjectsToBeRun",
        "NLabsFinished",
        "TotalNMainExpCollected",
      ],
      extraColumn: { header: "Comments", value: "an invented comment" },
    });
    expect(read.issues.map((issue) => issue.check)).toEqual(["summary", "summaryLayout"]);
    const layout = read.issues[1];
    expect(layout?.found).toBe(
      "A: Study ID (read as StudyID) | B: leader (read as Leader) | C: N Labs Signed (read as NLabsSigned) | " +
        "missing: TotalNRest | G: Comments (not recognised)",
    );
    expect(layout?.message).toContain(
      "Row 1 of a tab holds 6 of the seven summary headers under tolerant matching: 3 are spelt otherwise than the brief states, " +
        "1 are missing and 1 columns are not recognised.",
    );
    // The message, which is printed and logged, quotes no header and no cell.
    expect(layout?.message).not.toMatch(/Study ID|Comments|invented comment/);
  });

  it("recognises a summary whose header stands below a title line, and says in which row", async () => {
    const read = await reading({ headerRow: 3 });
    expect(read.issues.map((issue) => [issue.check, issue.found])).toEqual([
      ["summary", "no summary tab"],
      ["summaryLayout", "header in row 3"],
    ]);
  });

  it("stops on a tab that has none of the layouts it reads, and names the tab in the report", async () => {
    const read = await reading({ unknownTab: true });
    expect(read.issues).toEqual([
      expect.objectContaining({ check: "unknownTab", expected: "summary | leads | outreach", found: "Invented notes" }),
    ]);
    expect(read.issues[0]?.message).not.toContain("Invented notes");
  });
});
