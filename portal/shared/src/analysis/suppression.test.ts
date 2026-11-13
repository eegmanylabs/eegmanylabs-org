import { describe, expect, it } from "vitest";
import {
  releaseDemographicCounts,
  SMALL_CELL_THRESHOLD,
  SUPPRESSED_GROUP_LABEL,
  suppressSmallCells,
} from "./suppression";

describe("small-cell suppression", () => {
  it("states its threshold", () => {
    expect(SMALL_CELL_THRESHOLD).toBe(5);
  });

  it("shows every count and the total where no group is small", () => {
    expect(suppressSmallCells({ a: 12, b: 7, c: 0 })).toEqual({
      cells: [
        { key: "a", value: { suppressed: false, count: 12 } },
        { key: "b", value: { suppressed: false, count: 7 } },
        { key: "c", value: { suppressed: false, count: 0 } },
      ],
      total: 19,
      suppressedCells: 0,
    });
  });

  it("hides a small group, a second group so that it cannot be worked out, and the total", () => {
    const result = suppressSmallCells({ a: 12, b: 3, c: 7 });
    expect(result.cells.filter((cell) => cell.value.suppressed).map((cell) => cell.key)).toEqual(["b", "c"]);
    expect(result.total).toBeNull();
  });
});

describe("releaseDemographicCounts", () => {
  it("releases nothing for a scope smaller than the threshold", () => {
    expect(releaseDemographicCounts({ b: 1 })).toEqual({ people: null, cells: [], total: null });
    expect(releaseDemographicCounts({ c: SMALL_CELL_THRESHOLD - 1 })).toEqual({ people: null, cells: [], total: null });
  });

  it("never names a value that everyone of a scope shares", () => {
    expect(releaseDemographicCounts({ c: 9 })).toEqual({
      people: null,
      cells: [{ category: SUPPRESSED_GROUP_LABEL, count: null }],
      total: null,
    });
  });

  it("folds suppressed groups into one unnamed cell and withholds the people and the total", () => {
    expect(releaseDemographicCounts({ a: 7, b: 6, c: 6, d: 2 })).toEqual({
      people: null,
      cells: [
        { category: "a", count: 7 },
        { category: "c", count: 6 },
        { category: SUPPRESSED_GROUP_LABEL, count: null },
      ],
      total: null,
    });
  });

  it("shows every group, the people and the total when nothing is suppressed", () => {
    expect(releaseDemographicCounts({ a: 7, b: 6, "Not recorded": 5 }, new Set(["Not recorded"]))).toEqual({
      people: 18,
      cells: [
        { category: "Not recorded", count: 5 },
        { category: "a", count: 7 },
        { category: "b", count: 6 },
      ],
      total: 18,
    });
  });

  it("does not count groups with nothing recorded towards the values named", () => {
    expect(releaseDemographicCounts({ a: 7, "Not recorded": 6 }, new Set(["Not recorded"]))).toEqual({
      people: null,
      cells: [
        { category: "Not recorded", count: 6 },
        { category: SUPPRESSED_GROUP_LABEL, count: null },
      ],
      total: null,
    });
  });
});
