// Synthetic tables: the values are invented.
import { describe, expect, it } from "vitest";
import { crc32, exportFileStem, storedZip, tableToCsv, tableToXlsx, utf8Encode } from "./table-export";

/** The text of bytes that hold ASCII alone, as every part of these synthetic workbooks does. */
const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/** Reads the files of a ZIP archive stored without compression, from its local headers. */
function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = ascii(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength;
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 14, true));
    files.set(name, ascii(data));
    at = start + size;
  }
  return files;
}

const table = {
  title: "Participations: synthetic",
  columns: ["Participation", "Target", "Note"],
  rows: [
    ["Synthetic2001 at Lab One", 40, '=HYPERLINK("http://example.org")'],
    ["Synthetic2001 at Lab Two", null, 'Says "hello", then <stops>'],
  ],
};

describe("CSV", () => {
  it("quotes what needs quoting, leaves unknown values empty and keeps a formula from running", () => {
    expect(tableToCsv(table)).toBe(
      '\uFEFFParticipation,Target,Note\r\nSynthetic2001 at Lab One,40,"\'=HYPERLINK(""http://example.org"")"\r\nSynthetic2001 at Lab Two,,"Says ""hello"", then <stops>"\r\n',
    );
  });

  it("names the file from the title and the day", () => {
    expect(exportFileStem("Participations: synthétique", "2026-11-12")).toBe("participations-synthetique-2026-11-12");
  });
});

describe("Excel", () => {
  it("encodes text as UTF-8", () => {
    expect([...utf8Encode("a\u00e9\u20ac\u{1f600}")]).toEqual([
      0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80,
    ]);
  });

  it("computes the standard check value of CRC-32", () => {
    expect(crc32(utf8Encode("123456789"))).toBe(0xcbf43926);
  });

  it("writes a workbook of inline strings and numbers, with no formula and escaped markup", () => {
    const files = readStoredZip(tableToXlsx(table));
    expect([...files.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<c r="B2"><v>40</v></c>');
    expect(sheet).toContain("&#60;stops&#62;");
    expect(sheet).not.toContain("<f>");
    expect(files.get("xl/workbook.xml")).toContain('name="Participations  synthetic"');
  });

  it("ends the archive with a central directory that counts every file", () => {
    const zip = storedZip([{ name: "a.txt", data: utf8Encode("a") }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(1);
  });
});
