// The keyboard and the windowing of the table of records. Rows are synthetic.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type RecordColumn, RecordTable, visibleWindow } from "./record-table";

interface Row {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly RecordColumn<Row, "name">[] = [
  { id: "name", header: "Name", sortKey: "name", cell: (row) => row.name },
];
const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `r${index}`, name: `Synthetic ${index}` }));

function table(count: number, onOpen = vi.fn(), virtualise?: { rowHeight: number; viewportHeight: number }) {
  render(
    <RecordTable
      caption="Synthetic records"
      rows={rows(count)}
      columns={COLUMNS}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.name}
      sortKey="name"
      direction="asc"
      onSort={() => undefined}
      onOpen={onOpen}
      openKey={null}
      {...(virtualise === undefined ? {} : { virtualise })}
    />,
  );
  return onOpen;
}

describe("visibleWindow", () => {
  it("renders every row without windowing, and the rows in view with some to spare with it", () => {
    expect(visibleWindow(0, 50, undefined, 8)).toEqual({ first: 0, last: 49 });
    expect(visibleWindow(0, 1_000, { rowHeight: 40, viewportHeight: 400 }, 5)).toEqual({ first: 0, last: 20 });
    expect(visibleWindow(4_000, 1_000, { rowHeight: 40, viewportHeight: 400 }, 5)).toEqual({ first: 95, last: 115 });
    expect(visibleWindow(39_900, 1_000, { rowHeight: 40, viewportHeight: 400 }, 5)).toEqual({ first: 992, last: 999 });
  });
});

describe("RecordTable", () => {
  it("is entered at one row, moves with the arrow keys, Home and End, and opens a row with Enter", () => {
    const onOpen = table(5);
    const first = screen.getByRole("row", { name: "Synthetic 0" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("row", { name: "Synthetic 1" }).getAttribute("tabindex")).toBe("-1");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Synthetic 1" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Synthetic 4" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Synthetic 4" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith({ id: "r0", name: "Synthetic 0" });
  });

  it("renders only the rows in view of a long list, and says how many rows there are", () => {
    table(1_000, vi.fn(), { rowHeight: 40, viewportHeight: 400 });
    expect(screen.getAllByRole("row").length).toBeLessThan(40);
    expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe("1001");
    expect(screen.getByRole("row", { name: "Synthetic 3" }).getAttribute("aria-rowindex")).toBe("5");
  });
});
