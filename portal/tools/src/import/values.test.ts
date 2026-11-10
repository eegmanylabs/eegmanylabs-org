// Unit tests of the hashes and the parsed copies of source values. The values are invented.
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentRowKey, distinct, rowHash, wholeNumberOf } from "./values";

describe("rowHash", () => {
  it("is the first 12 hexadecimal characters of SHA-256 over the compact JSON of the cells", () => {
    // sha256('["a",null,0]') starts with these characters.
    expect(rowHash(["a", null, 0])).toBe("177fb051abad");
    expect(rowHash(["a", null, 0])).toMatch(/^[0-9a-f]{12}$/);
  });

  it("tells an empty cell from an empty text and from zero", () => {
    const hashes = new Set([rowHash([null]), rowHash([""]), rowHash([0]), rowHash(["0"]), rowHash([false])]);
    expect(hashes.size).toBe(5);
  });

  it("does not depend on the order in which the keys of a cell record were written", () => {
    expect(rowHash([{ v: "x", t: "string", f: "A1" }])).toBe(rowHash([{ f: "A1", t: "string", v: "x" }]));
  });

  it("changes when one cell changes, and when two cells swap places", () => {
    expect(rowHash(["a", "b"])).not.toBe(rowHash(["a", "c"]));
    expect(rowHash(["a", "b"])).not.toBe(rowHash(["b", "a"]));
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
    const first = contentRowKey(["same"], seen);
    const second = contentRowKey(["same"], seen);
    const other = contentRowKey(["other"], seen);
    expect(first).toBe(`row__${rowHash(["same"])}__1`);
    expect(second).toBe(`row__${rowHash(["same"])}__2`);
    expect(other).toBe(`row__${rowHash(["other"])}__1`);
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
});
