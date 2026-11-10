// Unit tests of the reader of tab-separated files. The content is invented.
import { describe, expect, it } from "vitest";
import { readTsv, TsvFormatError } from "./tsv";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("readTsv", () => {
  it("returns every field exactly as the file holds it, without trimming or converting", () => {
    const file = readTsv(bytes("Key\tName\tCount\nk1\t  padded  \t007\nk2\t\t0\n"));
    expect(file.header).toEqual(["Key", "Name", "Count"]);
    expect(file.rows).toEqual([
      { lineNumber: 2, cells: ["k1", "  padded  ", "007"] },
      { lineNumber: 3, cells: ["k2", "", "0"] },
    ]);
    expect(file.endsWithNewline).toBe(true);
  });

  it("reads mixed line endings and keeps a carriage return out of the last field", () => {
    const file = readTsv(bytes("A\tB\r\none\ttwo\r\nthree\tfour\nfive\tsix\rseven\teight"));
    expect(file.header).toEqual(["A", "B"]);
    expect(file.rows.map((row) => row.cells)).toEqual([
      ["one", "two"],
      ["three", "four"],
      ["five", "six"],
      ["seven", "eight"],
    ]);
    expect(file.lineEndings).toEqual({ crlf: 2, lf: 1, cr: 1 });
    expect(file.endsWithNewline).toBe(false);
  });

  it("keeps blank lines and lines of another width, so that the importer can account for them", () => {
    const file = readTsv(bytes("A\tB\n\nonly\nx\ty\tz\n"));
    expect(file.rows.map((row) => row.cells)).toEqual([[""], ["only"], ["x", "y", "z"]]);
    expect(file.rows.map((row) => row.lineNumber)).toEqual([2, 3, 4]);
  });

  it("treats a double quote as a character and counts the quotes it meets", () => {
    const file = readTsv(bytes('A\tB\n"quoted\tvalue"\tend\n'));
    expect(file.rows[0]?.cells).toEqual(['"quoted', 'value"', "end"]);
    expect(file.quoteCount).toBe(2);
  });

  it("keeps a byte order mark in the first header, where a header check finds it", () => {
    const file = readTsv(bytes("﻿Key\tName\n"));
    expect(file.hasByteOrderMark).toBe(true);
    expect(file.header[0]).toBe("﻿Key");
  });

  it("keeps text that is not in normal form and characters outside ASCII unchanged", () => {
    const decomposed = "Müller";
    const file = readTsv(bytes(`Name\n${decomposed}\nTürkiye\n`));
    expect(file.rows[0]?.cells[0]).toBe(decomposed);
    expect(file.rows[1]?.cells[0]).toBe("Türkiye");
  });

  it("returns no header and no rows for an empty file", () => {
    expect(readTsv(bytes(""))).toMatchObject({ header: [], rows: [], endsWithNewline: false, quoteCount: 0 });
  });

  it("refuses bytes that are not UTF-8", () => {
    expect(() => readTsv(new Uint8Array([0x41, 0xff, 0xfe]))).toThrow(TsvFormatError);
  });
});
