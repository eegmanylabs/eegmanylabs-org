// Names are synthetic.
import { describe, expect, it } from "vitest";
import { byText, type TableSpec, viewOf } from "./table-controls";

interface Row {
  readonly name: string;
  readonly count: number;
}

const rows: Row[] = [
  { name: "Cleo Placeholder", count: 3 },
  { name: "Ádám Example", count: 1 },
  { name: "ben sample", count: 2 },
];

const spec: TableSpec<Row, "name" | "count"> = {
  searchText: (row) => [row.name],
  sorters: { name: (a, b) => byText(a.name, b.name), count: (a, b) => a.count - b.count },
  initialSort: { key: "name", direction: "asc" },
  pageSize: 2,
};

describe("viewOf", () => {
  it("sorts names regardless of case and accents, and pages the result", () => {
    const view = viewOf(rows, spec, { query: "", sortKey: "name", direction: "asc", offset: 0 });
    expect(view.page.map((row) => row.name)).toEqual(["Ádám Example", "ben sample"]);
    expect(view.total).toBe(3);
    expect(viewOf(rows, spec, { query: "", sortKey: "name", direction: "asc", offset: 2 }).page).toHaveLength(1);
  });

  it("sorts either way by any column", () => {
    const view = viewOf(rows, spec, { query: "", sortKey: "count", direction: "desc", offset: 0 });
    expect(view.page.map((row) => row.count)).toEqual([3, 2]);
  });

  it("searches without regard to case or accents, and returns to the first page when the result is shorter", () => {
    const view = viewOf(rows, spec, { query: "ADAM", sortKey: "name", direction: "asc", offset: 2 });
    expect(view.page.map((row) => row.name)).toEqual(["Ádám Example"]);
    expect(view.offset).toBe(0);
    expect(viewOf(rows, spec, { query: "nobody", sortKey: "name", direction: "asc", offset: 0 }).total).toBe(0);
  });

  it("leaves the list it was given as it was", () => {
    const before = rows.map((row) => row.name);
    viewOf(rows, spec, { query: "", sortKey: "name", direction: "desc", offset: 0 });
    expect(rows.map((row) => row.name)).toEqual(before);
  });
});
