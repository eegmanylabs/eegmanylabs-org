// Unit tests of the hashes and the parsed copies of source values. The values are invented.
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { byCodePoint, canonicalJson, contentRowKey, distinct, positionFree, rowHash, wholeNumberOf } from "./values";

describe("rowHash", () => {
  it("is the first 12 hexadecimal characters of SHA-256 over the compact JSON of the cells", () => {
    // sha256('["a",null,0]') starts with these characters.
    expect(rowHash(["a", null, 0], 2)).toBe("177fb051abad");
    expect(rowHash(["a", null, 0], 2)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("tells an empty cell from an empty text and from zero", () => {
    const hashes = new Set([[null], [""], [0], ["0"], [false]].map((cells) => rowHash(cells, 2)));
    expect(hashes.size).toBe(5);
  });

  it("does not depend on the order in which the keys of a cell record were written", () => {
    expect(rowHash([{ v: "x", t: "string", f: "A1" }], 2)).toBe(rowHash([{ f: "A1", t: "string", v: "x" }], 2));
  });

  it("changes when one cell changes, and when two cells swap places", () => {
    expect(rowHash(["a", "b"], 2)).not.toBe(rowHash(["a", "c"], 2));
    expect(rowHash(["a", "b"], 2)).not.toBe(rowHash(["b", "a"], 2));
  });

  it("does not depend on the row of a cell without a formula or a merged range", () => {
    expect(rowHash(["a", { v: 1, t: "number" }], 2)).toBe(rowHash(["a", { v: 1, t: "number" }], 40));
  });

  it("stays the same when a line is inserted above a row with a formula or a merged cell", () => {
    // The same row, first in row 7 and then, after one line was inserted above the tab, in row 8.
    const before = [
      { v: 12, t: "number", f: "SUM(B2:B6)+$C$7*Sheet2!D7" },
      { v: null, t: "empty", merge: "B7:C8" },
    ];
    const after = [
      { v: 12, t: "number", f: "SUM(B3:B7)+$C$8*Sheet2!D8" },
      { v: null, t: "empty", merge: "B8:C9" },
    ];
    expect(rowHash(after, 8)).toBe(rowHash(before, 7));
    // A formula that sums one row more is another formula, and a wider range is another range.
    expect(rowHash([{ ...after[0], f: "SUM(B2:B7)+$C$8*Sheet2!D8" }, after[1]], 8)).not.toBe(rowHash(before, 7));
    expect(rowHash([after[0], { ...after[1], merge: "B8:C10" }], 8)).not.toBe(rowHash(before, 7));
  });

  it("leaves the name of a function alone that ends in digits, and what the stored record holds", () => {
    const cells = [{ v: 2, t: "number", f: "LOG10(A3)+ATAN2(B3,1)" }];
    expect(positionFree(cells, 3)).toEqual([{ v: 2, t: "number", f: "LOG10(A{0})+ATAN2(B{0},1)" }]);
    expect(cells).toEqual([{ v: 2, t: "number", f: "LOG10(A3)+ATAN2(B3,1)" }]);
  });
});

describe("canonicalJson", () => {
  it("writes a timestamp by its instant and refuses an undefined value", () => {
    expect(canonicalJson({ at: Timestamp.fromMillis(1_000) })).toBe('{"at":{"timestamp":1000}}');
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}');
    expect(() => canonicalJson(undefined)).toThrow(RangeError);
  });
});

describe("contentRowKey", () => {
  it("gives equal rows of one tab different keys by their ordinal, never by their row number", () => {
    const seen = new Map<string, number>();
    const first = contentRowKey(["same"], 4, seen);
    const second = contentRowKey(["same"], 9, seen);
    const other = contentRowKey(["other"], 5, seen);
    expect(first).toBe(`row__${rowHash(["same"], 4)}__1`);
    expect(second).toBe(`row__${rowHash(["same"], 9)}__2`);
    expect(other).toBe(`row__${rowHash(["other"], 5)}__1`);
  });

  it("gives a row with a formula the same key after a line was inserted above it", () => {
    expect(contentRowKey([{ v: 3, t: "number", f: "COUNTA(C12:Z12)" }], 12, new Map())).toBe(
      contentRowKey([{ v: 3, t: "number", f: "COUNTA(C13:Z13)" }], 13, new Map()),
    );
  });
});

describe("parsed copies", () => {
  it("reads a whole number only from digits", () => {
    expect(wholeNumberOf(" 7 ")).toBe(7);
    expect(wholeNumberOf("2005a")).toBeNull();
    expect(wholeNumberOf("7.0")).toBeNull();
    expect(wholeNumberOf("")).toBeNull();
  });

  it("keeps the first of equal members", () => {
    expect(distinct([{ a: 1 }, { a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("orders texts by code point, so that a list comes out the same under every locale", () => {
    expect(["b", "a", "B", "ä", "a"].sort(byCodePoint)).toEqual(["B", "a", "a", "b", "ä"]);
  });
});
