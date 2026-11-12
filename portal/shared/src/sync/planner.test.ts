// The planner, cell by cell and row by row: every line of the tables of docs/INTEGRATIONS.md,
// section 3.3, convergence after the engine's own writes, and the ceiling. The laboratories and
// values are synthetic.
import { describe, expect, it } from "vitest";
import {
  type AppRecord,
  type CellBase,
  cellKey,
  decideCell,
  type MappedColumn,
  type PlannerInput,
  type PlannerMapping,
  planSync,
  planWrites,
  type SheetCell,
  type SheetRow,
  type SyncDirection,
  type SyncPlan,
} from "./planner";

const KEY = "Laboratory key";

function mapping(directions: Partial<Record<"city" | "channels" | "rates", SyncDirection>> = {}): PlannerMapping {
  const columns: MappedColumn[] = [];
  if (directions.city !== undefined) {
    columns.push({ field: "city", column: "City", direction: directions.city, spec: { type: "text" } });
  }
  if (directions.channels !== undefined) {
    columns.push({
      field: "channelCount",
      column: "EEG channels",
      direction: directions.channels,
      spec: { type: "number" },
    });
  }
  if (directions.rates !== undefined) {
    columns.push({
      field: "samplingRatesHz",
      column: "Sampling rates",
      direction: directions.rates,
      spec: { type: "numberList" },
    });
  }
  return { keyColumn: KEY, columns, sheetOnly: "propose", appOnly: "append", cellCeiling: 100 };
}

const HEADER = [
  { index: 0, text: KEY, tag: null },
  { index: 1, text: "City", tag: null },
  { index: 2, text: "EEG channels", tag: null },
  { index: 3, text: "Sampling rates", tag: null },
  { index: 4, text: "Notes from the lab", tag: null },
] as const;

type Cells = readonly (SheetCell["value"] | { readonly value: SheetCell["value"]; readonly formula: string })[];

function row(position: number, key: string | null, cells: Cells, anchor: string | null = key): SheetRow {
  return {
    position,
    anchor,
    cells: [key, ...cells].map((cell) =>
      cell !== null && typeof cell === "object" ? { value: cell.value, formula: cell.formula } : { value: cell },
    ),
  };
}

function record(key: string, values: Record<string, unknown>, archived = false): AppRecord {
  return { key, recordId: `id-${key}`, values, archived };
}

function bases(entries: readonly (readonly [string, string, string | null, boolean?])[]): Map<string, CellBase> {
  return new Map(
    entries.map(([rowKey, field, value, unstable]) => [cellKey(rowKey, field), { value, unstable: unstable ?? false }]),
  );
}

function plan(input: Partial<PlannerInput> & Pick<PlannerInput, "mapping">): SyncPlan {
  return planSync({
    sheet: { header: HEADER, rows: [], anchorBudgetExceeded: false },
    records: [],
    bases: new Map(),
    openConflicts: new Set(),
    ...input,
  });
}

describe("the decision for one cell", () => {
  const directions: readonly SyncDirection[] = ["appAuthoritative", "sheetAuthoritative", "bidirectional", "generated"];

  it("does nothing when both sides agree with the base, and records a new base when they agree on a new value", () => {
    for (const direction of directions) {
      expect(decideCell(direction, "Bremen", "Bremen", "Bremen")).toEqual({ kind: "none" });
      expect(decideCell(direction, "Bremen", "Bremen", "Munich")).toEqual({ kind: "agree" });
      expect(decideCell(direction, "Bremen", "Bremen", undefined)).toEqual({ kind: "agree" });
    }
  });

  it("writes the portal value for a field the portal owns, and says when that overwrites an edit in the sheet", () => {
    for (const direction of ["appAuthoritative", "generated"] as const) {
      expect(decideCell(direction, "Bremen", "Munich", "Bremen")).toEqual({
        kind: "writeExternal",
        overwroteExternalEdit: true,
      });
      expect(decideCell(direction, "Bremen", "Munich", "Munich")).toEqual({
        kind: "writeExternal",
        overwroteExternalEdit: false,
      });
      expect(decideCell(direction, "Bremen", "Munich", undefined)).toEqual({
        kind: "writeExternal",
        overwroteExternalEdit: false,
      });
    }
  });

  it("writes the sheet value for a field the sheet owns, and says when that overwrites an edit in the portal", () => {
    expect(decideCell("sheetAuthoritative", "Bremen", "Munich", "Munich")).toEqual({
      kind: "writeApp",
      overwroteAppEdit: true,
    });
    expect(decideCell("sheetAuthoritative", "Bremen", "Munich", "Bremen")).toEqual({
      kind: "writeApp",
      overwroteAppEdit: false,
    });
  });

  it("follows the side that changed for a bidirectional field, and raises a conflict when both did", () => {
    expect(decideCell("bidirectional", "Bremen", "Munich", "Munich")).toEqual({
      kind: "writeExternal",
      overwroteExternalEdit: false,
    });
    expect(decideCell("bidirectional", "Bremen", "Munich", "Bremen")).toEqual({
      kind: "writeApp",
      overwroteAppEdit: false,
    });
    expect(decideCell("bidirectional", "Bremen", "Munich", "Leipzig")).toEqual({ kind: "conflict" });
    // A side cleared since the base is a change like any other.
    expect(decideCell("bidirectional", null, "Munich", "Munich")).toEqual({
      kind: "writeExternal",
      overwroteExternalEdit: false,
    });
  });

  it("fills an empty side on first link, and sends two different values to review", () => {
    expect(decideCell("bidirectional", null, "Munich", undefined)).toEqual({
      kind: "writeApp",
      overwroteAppEdit: false,
    });
    expect(decideCell("bidirectional", "Bremen", null, undefined)).toEqual({
      kind: "writeExternal",
      overwroteExternalEdit: false,
    });
    expect(decideCell("bidirectional", "Bremen", "Munich", undefined)).toEqual({ kind: "conflict" });
  });
});

describe("a run over rows that exist on both sides", () => {
  const records = [
    record("lab-a", { city: "Bremen", channelCount: 64 }),
    record("lab-b", { city: "Munich", channelCount: 32 }),
  ];
  const rows = [row(2, "lab-a", ["Bremen", 64, null]), row(3, "lab-b", ["Munich", 32, null])];
  const agreed = bases([
    ["lab-a", "city", "Bremen"],
    ["lab-a", "channelCount", "64"],
    ["lab-b", "city", "Munich"],
    ["lab-b", "channelCount", "32"],
  ]);

  it("plans nothing when both sides still hold the base: a repeated run is idle", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional" }),
      sheet: { header: HEADER, rows, anchorBudgetExceeded: false },
      records,
      bases: agreed,
    });
    expect(planWrites(result)).toBe(false);
    expect(result.baseUpdates).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.stats.rowsMatched).toBe(2);
  });

  it("takes an edit made in the sheet into the mapped portal field", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen", 128, null]), rows[1] as SheetRow],
        anchorBudgetExceeded: false,
      },
      records,
      bases: agreed,
    });
    expect(result.appWrites).toEqual([
      {
        rowKey: "lab-a",
        recordId: "id-lab-a",
        field: "channelCount",
        canonical: "128",
        expected: "64",
        overwroteAppEdit: false,
      },
    ]);
    expect(result.sheetWrites).toEqual([]);
  });

  it("writes an edit made in the portal to the cell of its row and column, addressed by the row's anchor", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional" }),
      sheet: { header: HEADER, rows, anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen", channelCount: 16 }), records[1] as AppRecord],
      bases: agreed,
    });
    expect(result.sheetWrites).toEqual([
      expect.objectContaining({
        rowKey: "lab-a",
        position: 2,
        byAnchor: true,
        columnIndex: 2,
        field: "channelCount",
        value: 16,
        canonical: "16",
        replaced: "64",
        overwroteExternalEdit: false,
      }),
    ]);
  });

  it("raises a conflict when both sides changed one field, and writes neither while the other fields go on", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Leipzig", 128, null]), rows[1] as SheetRow],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { city: "Bremen", channelCount: 16 }), records[1] as AppRecord],
      bases: agreed,
    });
    expect(result.conflicts).toEqual([
      { rowKey: "lab-a", recordId: "id-lab-a", field: "channelCount", base: "64", app: "16", external: "128" },
    ]);
    expect(result.appWrites.map((write) => write.field)).toEqual(["city"]);
    expect(result.sheetWrites).toEqual([]);
  });

  it("keeps an open conflict closed to writes, refreshes its values, and settles it when both sides come to agree", () => {
    const open = new Set([cellKey("lab-a", "channelCount")]);
    const refreshed = plan({
      mapping: mapping({ channels: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen", 256, null]), rows[1] as SheetRow],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { channelCount: 16 }), records[1] as AppRecord],
      bases: agreed,
      openConflicts: open,
    });
    expect(refreshed.conflicts).toEqual([
      expect.objectContaining({ field: "channelCount", app: "16", external: "256" }),
    ]);
    expect(planWrites(refreshed)).toBe(false);

    const settled = plan({
      mapping: mapping({ channels: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen", 16, null]), rows[1] as SheetRow],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { channelCount: 16 }), records[1] as AppRecord],
      bases: agreed,
      openConflicts: open,
    });
    expect(settled.conflicts).toEqual([]);
    expect(settled.settledConflicts).toEqual([
      { rowKey: "lab-a", recordId: "id-lab-a", field: "channelCount", value: "16" },
    ]);
  });

  it("overwrites the sheet for a field the portal owns and logs that a person's edit was replaced", () => {
    const result = plan({
      mapping: mapping({ city: "appAuthoritative" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Leipzig", 64, null]), rows[1] as SheetRow],
        anchorBudgetExceeded: false,
      },
      records,
      bases: agreed,
    });
    expect(result.sheetWrites).toEqual([
      expect.objectContaining({ field: "city", value: "Bremen", replaced: "Leipzig", overwroteExternalEdit: true }),
    ]);
  });

  it("never writes the portal from a field the portal owns or computes, whatever the sheet says", () => {
    for (const direction of ["appAuthoritative", "generated"] as const) {
      const result = plan({
        mapping: mapping({ city: direction }),
        sheet: {
          header: HEADER,
          rows: [row(2, "lab-a", ["Leipzig", 64, null]), rows[1] as SheetRow],
          anchorBudgetExceeded: false,
        },
        records,
        bases: agreed,
      });
      expect(result.appWrites).toEqual([]);
    }
  });

  it("never writes the sheet for a field the sheet owns, and logs that a portal edit was replaced", () => {
    const result = plan({
      mapping: mapping({ city: "sheetAuthoritative" }),
      sheet: { header: HEADER, rows, anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Leipzig" }), records[1] as AppRecord],
      bases: agreed,
    });
    expect(result.sheetWrites).toEqual([]);
    expect(result.appWrites).toEqual([
      expect.objectContaining({ field: "city", canonical: "Bremen", overwroteAppEdit: true }),
    ]);
  });

  it("compares values in canonical form: spacing, line endings, number formats and list separators", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional", rates: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["  Bremen ", "64", "500; 1000"])],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { city: "Bremen", channelCount: 64, samplingRatesHz: [500, 1000] })],
      bases: bases([
        ["lab-a", "city", "Bremen"],
        ["lab-a", "channelCount", "64"],
        ["lab-a", "samplingRatesHz", "500\u001f1000"],
      ]),
    });
    expect(planWrites(result)).toBe(false);
    expect(result.baseUpdates).toEqual([]);
  });

  it("treats an empty cell, an empty string and an absent value as one value", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["", 64, null])], anchorBudgetExceeded: false },
      records: [record("lab-a", {})],
      bases: bases([["lab-a", "city", null]]),
    });
    expect(planWrites(result)).toBe(false);
  });

  it("leaves a cell alone whose value cannot be read as the field's type, and says why", () => {
    const result = plan({
      mapping: mapping({ channels: "bidirectional" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Bremen", "sixty-four", null])], anchorBudgetExceeded: false },
      records: [record("lab-a", { channelCount: 64 })],
      bases: bases([["lab-a", "channelCount", "64"]]),
    });
    expect(planWrites(result)).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: "invalidValue", rowKey: "lab-a", field: "channelCount" }),
    ]);
  });
});

describe("formulas, unstable cells and unmapped columns", () => {
  it("never writes a cell that holds a formula, reads its computed value, and raises an issue", () => {
    const result = plan({
      mapping: mapping({ channels: "appAuthoritative" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen", { value: 64, formula: "=32*2" }, null])],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { channelCount: 128 })],
      bases: bases([["lab-a", "channelCount", "64"]]),
    });
    expect(result.sheetWrites).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "formulaCell", field: "channelCount" })]);
  });

  it("takes the computed value of a formula into a field the sheet owns", () => {
    const result = plan({
      mapping: mapping({ channels: "sheetAuthoritative" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen", { value: 96, formula: "=32*3" }, null])],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { channelCount: 64 })],
      bases: bases([["lab-a", "channelCount", "64"]]),
    });
    expect(result.appWrites).toEqual([expect.objectContaining({ field: "channelCount", canonical: "96" })]);
  });

  it("writes no more to a cell marked unstable until a person clears the mark", () => {
    const result = plan({
      mapping: mapping({ city: "appAuthoritative" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["BREMEN", 64, null])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen" })],
      bases: bases([["lab-a", "city", "Bremen", true]]),
    });
    expect(planWrites(result)).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "unstableCell", field: "city" })]);
  });

  it("addresses only mapped columns: the key, a manual column and a formula column are never in a plan", () => {
    const result = plan({
      mapping: mapping({ city: "appAuthoritative", channels: "appAuthoritative" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Munich", 32, "A note"])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen", channelCount: 64 })],
      bases: bases([
        ["lab-a", "city", "Munich"],
        ["lab-a", "channelCount", "32"],
      ]),
    });
    expect(result.sheetWrites.map((write) => write.columnIndex).sort()).toEqual([1, 2]);
  });

  it("finds a column by its metadata tag before its header, so a renamed column keeps its field", () => {
    const header = [
      { index: 0, text: KEY, tag: null },
      { index: 1, text: "Town", tag: "city" },
    ];
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header, rows: [row(2, "lab-a", ["Munich"])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen" })],
      bases: bases([["lab-a", "city", "Bremen"]]),
    });
    expect(result.columns).toEqual([{ field: "city", index: 1 }]);
    expect(result.appWrites).toEqual([expect.objectContaining({ field: "city", canonical: "Munich" })]);
  });

  it("switches a field off for the run when its column cannot be found, and never guesses between two", () => {
    const header = [
      { index: 0, text: KEY, tag: null },
      { index: 1, text: "City", tag: null },
      { index: 2, text: "city ", tag: null },
    ];
    const result = plan({
      mapping: mapping({ city: "bidirectional", channels: "bidirectional" }),
      sheet: { header, rows: [row(2, "lab-a", ["Munich", "Munich"])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen", channelCount: 64 })],
    });
    expect(result.columns).toEqual([]);
    expect(result.issues.map((issue) => [issue.kind, issue.field])).toEqual([
      ["missingColumn", "city"],
      ["missingColumn", "channelCount"],
    ]);
    expect(planWrites(result)).toBe(false);
  });

  it("stops the whole run when the key column has gone", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: [{ index: 0, text: "City", tag: null }], rows: [], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen" })],
    });
    expect(result.halted).toBe("missingKeyColumn");
    expect(planWrites(result)).toBe(false);
  });
});

describe("rows that move, appear and disappear", () => {
  const records = [record("lab-a", { city: "Bremen" }), record("lab-b", { city: "Munich" })];
  const agreed = bases([
    ["lab-a", "city", "Bremen"],
    ["lab-b", "city", "Munich"],
  ]);

  it("follows a sort by key: reordered rows change nothing, and their anchors move with them", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-b", ["Munich"]), row(3, "lab-a", ["Bremen"])],
        anchorBudgetExceeded: false,
      },
      records,
      bases: agreed,
    });
    expect(planWrites(result)).toBe(false);
  });

  it("repairs anchors that disagree with the key column, as after a sort that left the metadata behind", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-b", ["Munich"], "lab-a"), row(3, "lab-a", ["Bremen"], "lab-b")],
        anchorBudgetExceeded: false,
      },
      records,
      bases: agreed,
    });
    expect(result.anchorRepairs).toEqual([
      { position: 2, rowKey: "lab-b", previous: "lab-a" },
      { position: 3, rowKey: "lab-a", previous: "lab-b" },
    ]);
    // The values themselves still agree, row by row, because rows are matched by key.
    expect(result.appWrites).toEqual([]);
    expect(result.sheetWrites).toEqual([]);
  });

  it("anchors a row that a person inserted by hand, and leaves an edit in a neighbouring row on its own row", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen"]), row(3, "lab-c", ["Leipzig"], null), row(4, "lab-b", ["Dresden"])],
        anchorBudgetExceeded: false,
      },
      records: [...records, record("lab-c", {})],
      bases: agreed,
    });
    expect(result.anchorRepairs).toEqual([{ position: 3, rowKey: "lab-c", previous: null }]);
    expect(result.appWrites).toEqual([
      expect.objectContaining({ rowKey: "lab-c", field: "city", canonical: "Leipzig" }),
      expect.objectContaining({ rowKey: "lab-b", field: "city", canonical: "Dresden" }),
    ]);
  });

  it("proposes a record for a key that the portal does not know, and creates nothing", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Bremen"]), row(3, "lab-b", ["Munich"]), row(4, "lab-new", ["Graz"])],
        anchorBudgetExceeded: false,
      },
      records,
      bases: agreed,
    });
    expect(result.issues).toEqual([expect.objectContaining({ kind: "unknownRow", rowKey: "lab-new" })]);
    expect(planWrites(result)).toBe(false);
  });

  it("leaves an unknown key alone without a review item when the mapping ignores such rows", () => {
    const result = plan({
      mapping: { ...mapping({ city: "bidirectional" }), sheetOnly: "ignore" },
      sheet: { header: HEADER, rows: [row(2, "lab-new", ["Graz"])], anchorBudgetExceeded: false },
    });
    expect(result.issues).toEqual([]);
  });

  it("appends a row for a record in scope that has no row and no state, with every mapped value", () => {
    const result = plan({
      mapping: mapping({ city: "sheetAuthoritative", channels: "appAuthoritative" }),
      sheet: { header: HEADER, rows: [], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen", channelCount: 64 })],
    });
    expect(result.appends).toEqual([
      {
        rowKey: "lab-a",
        recordId: "id-lab-a",
        cells: ["lab-a", "Bremen", 64],
        bases: [
          { rowKey: "lab-a", recordId: "id-lab-a", field: "city", value: "Bremen" },
          { rowKey: "lab-a", recordId: "id-lab-a", field: "channelCount", value: "64" },
        ],
      },
    ]);
  });

  it("appends nothing when every mapped field belongs to the sheet, or the mapping says not to", () => {
    expect(
      plan({ mapping: mapping({ city: "sheetAuthoritative" }), records: [record("lab-a", { city: "Bremen" })] })
        .appends,
    ).toEqual([]);
    expect(
      plan({
        mapping: { ...mapping({ city: "bidirectional" }), appOnly: "ignore" },
        records: [record("lab-a", { city: "Bremen" })],
      }).appends,
    ).toEqual([]);
  });

  it("raises a review item when a synchronised row has gone, and deletes or archives nothing", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Bremen"])], anchorBudgetExceeded: false },
      records,
      bases: agreed,
    });
    expect(result.issues).toEqual([expect.objectContaining({ kind: "missingRow", rowKey: "lab-b" })]);
    expect(result.appends).toEqual([]);
    expect(result.appWrites).toEqual([]);
  });

  it("leaves the row of an archived record as it is", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Leipzig"])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen" }, true)],
      bases: bases([["lab-a", "city", "Bremen"]]),
    });
    expect(result.issues).toEqual([expect.objectContaining({ kind: "archivedRecord", rowKey: "lab-a" })]);
    expect(planWrites(result)).toBe(false);
  });

  it("leaves out every row of a duplicated key, and ignores a row with no key", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: {
        header: HEADER,
        rows: [row(2, "lab-a", ["Leipzig"]), row(3, "lab-a", ["Graz"]), row(4, null, ["Wien"]), row(5, "  ", ["Linz"])],
        anchorBudgetExceeded: false,
      },
      records: [record("lab-a", { city: "Bremen" })],
      bases: bases([["lab-a", "city", "Bremen"]]),
    });
    expect(result.issues).toEqual([expect.objectContaining({ kind: "duplicateKey", rowKey: "lab-a" })]);
    expect(result.stats.blankKeys).toBe(2);
    expect(planWrites(result)).toBe(false);
  });

  it("addresses rows by position once the metadata budget is spent, and says so", () => {
    const result = plan({
      mapping: mapping({ city: "appAuthoritative" }),
      sheet: { header: HEADER, rows: [row(7, "lab-a", ["Leipzig"], null)], anchorBudgetExceeded: true },
      records: [record("lab-a", { city: "Bremen" })],
      bases: bases([["lab-a", "city", "Leipzig"]]),
    });
    expect(result.anchorRepairs).toEqual([]);
    expect(result.sheetWrites).toEqual([expect.objectContaining({ position: 7, byAnchor: false })]);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "anchorBudgetExceeded" })]);
  });
});

describe("loops and convergence", () => {
  it("finds nothing to do after its own writes: the echo of a write is ignored", () => {
    const columns = mapping({ city: "bidirectional", channels: "bidirectional" });
    const first = plan({
      mapping: columns,
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Leipzig", 64, null])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Bremen", channelCount: 128 })],
      bases: bases([
        ["lab-a", "city", "Bremen"],
        ["lab-a", "channelCount", "64"],
      ]),
    });
    expect(first.appWrites.map((write) => write.field)).toEqual(["city"]);
    expect(first.sheetWrites.map((write) => write.field)).toEqual(["channelCount"]);

    // The engine wrote both sides and then the base. The sheet edit it caused comes back as a
    // notification, and the run it starts compares again and finds three equal values.
    const second = plan({
      mapping: columns,
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Leipzig", 128, null])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Leipzig", channelCount: 128 })],
      bases: bases([
        ["lab-a", "city", "Leipzig"],
        ["lab-a", "channelCount", "128"],
      ]),
    });
    expect(planWrites(second)).toBe(false);
    expect(second.baseUpdates).toEqual([]);
  });

  it("repairs a stale base without writing, as after a run that died between the write and the base", () => {
    const result = plan({
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: HEADER, rows: [row(2, "lab-a", ["Leipzig"])], anchorBudgetExceeded: false },
      records: [record("lab-a", { city: "Leipzig" })],
      bases: bases([["lab-a", "city", "Bremen"]]),
    });
    expect(planWrites(result)).toBe(false);
    expect(result.baseUpdates).toEqual([{ rowKey: "lab-a", recordId: "id-lab-a", field: "city", value: "Leipzig" }]);
  });

  it("gives the same plan for the same input, whatever the order of the records", () => {
    const input = {
      mapping: mapping({ city: "bidirectional" }),
      sheet: { header: HEADER, rows: [], anchorBudgetExceeded: false },
      records: [record("lab-b", { city: "Munich" }), record("lab-a", { city: "Bremen" })],
    };
    const reversed = { ...input, records: [...input.records].reverse() };
    expect(plan(input)).toEqual(plan(reversed));
    expect(plan(input).appends.map((append) => append.rowKey)).toEqual(["lab-a", "lab-b"]);
  });
});

describe("the ceiling on cells written in one run", () => {
  it("turns a mass change into one review item and writes nothing", () => {
    const records = Array.from({ length: 30 }, (_, index) => record(`lab-${index}`, { city: `City ${index}` }));
    const rows = records.map((item, index) => row(index + 2, item.key, ["Pasted value"]));
    const result = plan({
      mapping: { ...mapping({ city: "bidirectional" }), cellCeiling: 10 },
      sheet: { header: HEADER, rows, anchorBudgetExceeded: false },
      records,
      bases: bases(records.map((item) => [item.key, "city", String(item.values.city)] as const)),
    });
    expect(result.halted).toBe("ceilingExceeded");
    expect(planWrites(result)).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "ceilingExceeded" })]);
  });

  it("allows a plan of exactly the ceiling", () => {
    const records = Array.from({ length: 10 }, (_, index) => record(`lab-${index}`, { city: `City ${index}` }));
    const rows = records.map((item, index) => row(index + 2, item.key, ["Changed"]));
    const result = plan({
      mapping: { ...mapping({ city: "bidirectional" }), cellCeiling: 10 },
      sheet: { header: HEADER, rows, anchorBudgetExceeded: false },
      records,
      bases: bases(records.map((item) => [item.key, "city", String(item.values.city)] as const)),
    });
    expect(result.halted).toBeNull();
    expect(result.appWrites).toHaveLength(10);
  });
});
