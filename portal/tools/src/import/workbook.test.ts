// Unit tests of the workbook reader. Every workbook is built here or by the synthetic fixture
// builders: all names are invented and all addresses are on example.org.
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { holdsContent, rawCellOf } from "./cells";
import { awkwardWorkbook, NAMING_FOOTNOTE, namingWorkbook } from "./fixtures/workbooks";
import { readZip, WorkbookFormatError } from "./ooxml";
import {
  cellsByRow,
  columnLetters,
  columnNumber,
  isDateFormat,
  listOptions,
  rangeBounds,
  readWorkbook,
  serialToIsoDate,
  shiftFormula,
  type WorkbookSheet,
} from "./workbook";

/** A ZIP archive with stored members, which is all the reader needs to be handed raw parts. */
function zip(members: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(members)) {
    const data = Buffer.from(text, "utf8");
    const file = Buffer.from(name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, file, data);
    directory.push(central, file);
    offset += 30 + file.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(members).length, 8);
  end.writeUInt16LE(Object.keys(members).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directoryBytes, end]));
}

const NAMESPACES =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A workbook with one sheet whose rows are written by hand, for what a library would not write. */
function handWritten(sheetData: string, sharedStrings = ""): Uint8Array {
  return zip({
    "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NAMESPACES}><sheets><sheet name="Raw" sheetId="7" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet ${NAMESPACES}><dimension ref="A1:Z1000"/><sheetData>${sheetData}</sheetData></worksheet>`,
    ...(sharedStrings === ""
      ? {}
      : { "xl/sharedStrings.xml": `<?xml version="1.0"?><sst ${NAMESPACES}>${sharedStrings}</sst>` }),
  });
}

const cell = (sheet: WorkbookSheet | undefined, ref: string) => sheet?.cells.find((candidate) => candidate.ref === ref);

describe("readWorkbook on the synthetic workbook of awkward cases", async () => {
  const workbook = readWorkbook(await awkwardWorkbook());
  const [visible, hidden, veryHidden] = workbook.sheets;

  it("returns every sheet with its name verbatim and its visibility, hidden and very hidden ones included", () => {
    expect(workbook.sheets.map((sheet) => [sheet.name, sheet.visibility, sheet.position])).toEqual([
      ["Outreach demo ", "visible", 0],
      ["hidden notes", "hidden", 1],
      ["very hidden", "veryHidden", 2],
    ]);
    expect(new Set(workbook.sheets.map((sheet) => sheet.sheetId)).size).toBe(3);
    expect(cell(veryHidden, "B2")?.value).toBe("kept out of sight");
    expect(cell(hidden, "A3")?.value).toBe("contact name");
  });

  it("keeps a value as it is stored: white space, a stored boolean, a text date and the number behind a true date", () => {
    expect(cell(visible, "C4")?.value).toBe(" no reply ");
    expect(cell(visible, "F3")).toMatchObject({ type: "boolean", value: true, rawValue: "1" });
    expect(cell(visible, "F4")).toMatchObject({ type: "boolean", value: false });
    expect(cell(visible, "G3")).toMatchObject({ type: "string", value: "03.02.24" });
    const date = cell(visible, "H3");
    expect(date).toMatchObject({ type: "number", numberFormat: "dd.mm.yyyy" });
    expect(isDateFormat(date?.numberFormat ?? "")).toBe(true);
    expect(serialToIsoDate(Number(date?.value))).toBe("2024-03-05");
  });

  it("keeps an explicit zero apart from a blank cell", () => {
    expect(cell(visible, "D3")).toMatchObject({ type: "number", value: 0, rawValue: "0" });
    expect(cell(visible, "E3")).toBeUndefined();
    expect(rawCellOf(cell(visible, "D3"))).toEqual({ v: 0, t: "number" });
    expect(rawCellOf(cell(visible, "E3"))).toBeNull();
  });

  it("returns the formula text beside the cached result", () => {
    expect(cell(visible, "D6")).toMatchObject({ type: "number", value: 12, formula: "SUM(D3:D5)" });
    expect(rawCellOf(cell(visible, "E6"))).toEqual({ v: 7, t: "number", f: "SUM(E3:E5)" });
  });

  it("returns the target of a hyperlink, which the text of the cell does not show", () => {
    expect(cell(visible, "B3")).toMatchObject({ value: "write to Ada", hyperlink: "mailto:ada@example.org" });
    expect(cell(visible, "B4")?.hyperlink).toBeNull();
    expect(rawCellOf(cell(visible, "B3"))).toEqual({ v: "write to Ada", t: "string", l: "mailto:ada@example.org" });
  });

  it("returns strike-through, bold and italic, and a fill colour resolved through the theme", () => {
    expect(cell(visible, "A4")).toMatchObject({ strike: true, bold: false });
    expect(cell(visible, "A3")?.strike).toBe(false);
    expect(cell(visible, "A6")?.bold).toBe(true);
    expect(cell(visible, "C5")?.italic).toBe(true);
    expect(cell(visible, "C3")).toMatchObject({ fill: "FF0000", fillSource: "rgb:FFFF0000" });
    // Accent 6 of the default theme, lightened by 40 per cent.
    expect(cell(visible, "C4")).toMatchObject({ fill: "FAC090", fillSource: "theme:9:0.4" });
    expect(cell(visible, "C5")?.fill).toBeNull();
    expect(visible?.tabColour).toBe("00B050");
  });

  it("reads hidden rows and hidden columns as data and says that they are hidden", () => {
    expect(visible?.hiddenRows).toEqual([5]);
    expect(visible?.hiddenColumns).toEqual([2]);
    expect(cell(visible, "A5")).toMatchObject({ value: "Cy Invented", hiddenRow: true, hiddenColumn: false });
    expect(cell(visible, "B5")).toMatchObject({ value: "cy@example.org", hiddenRow: true, hiddenColumn: true });
    expect(cell(visible, "B4")).toMatchObject({ hiddenRow: false, hiddenColumn: true });
  });

  it("returns merged ranges, on the sheet and on each cell they contain", () => {
    expect(visible?.mergedRanges).toEqual(["A8:A9"]);
    expect(cell(visible, "A8")).toMatchObject({ value: "a note that spans two rows", merge: "A8:A9" });
    expect(cell(visible, "A9")).toMatchObject({ type: "empty", value: null, merge: "A8:A9" });
    expect(cell(visible, "A3")?.merge).toBeNull();
  });

  it("reports the used range, whatever grid size the file declares", () => {
    expect([visible?.lastRow, visible?.lastColumn]).toEqual([8, 8]);
    expect([hidden?.lastRow, hidden?.lastColumn]).toEqual([4, 2]);
    expect([...cellsByRow(visible as WorkbookSheet).keys()]).toEqual([1, 2, 3, 4, 5, 6, 8, 9]);
  });

  it("adds formatting to the record of a cell only where an importer asks for it", () => {
    const all = { strike: true, fill: true, font: true, hidden: true, merge: true };
    expect(rawCellOf(cell(visible, "A4"), all)).toEqual({ v: "Bo Fictional", t: "string", strike: true });
    expect(rawCellOf(cell(visible, "C4"), all)).toEqual({
      v: " no reply ",
      t: "string",
      fill: "FAC090",
      fillSource: "theme:9:0.4",
    });
    expect(rawCellOf(cell(visible, "B5"), all)).toMatchObject({ hiddenRow: true, hiddenColumn: true });
    expect(rawCellOf(cell(visible, "H3"))).toEqual({ v: 45356, t: "number", z: "dd.mm.yyyy" });
    // A cell that holds formatting alone is kept only where that formatting was asked for.
    expect(rawCellOf(cell(visible, "A9"))).toBeNull();
    expect(rawCellOf(cell(visible, "A9"), all)).toEqual({ v: null, t: "empty", merge: "A8:A9" });
    expect(holdsContent(rawCellOf(cell(visible, "A9"), all))).toBe(false);
    expect(holdsContent(rawCellOf(cell(visible, "D3")))).toBe(true);
  });
});

describe("readWorkbook on the synthetic naming conventions", async () => {
  const [sheet] = readWorkbook(await namingWorkbook()).sheets;

  it("expands a shared formula for every cell that depends on it", () => {
    expect(cell(sheet, "E2")).toMatchObject({ type: "formulaString", value: "Alp", formula: "LEFT(A2, 3)" });
    expect(cell(sheet, "E5")).toMatchObject({ value: "Eps", formula: "LEFT(A5, 3)" });
    expect(cell(sheet, "F9")).toMatchObject({ value: "b", formula: "MID(A9,4,1)" });
    expect(cell(sheet, "G7")).toMatchObject({ value: "Iota", formula: "CONCATENATE(E7,F7)" });
  });

  it("tells a typed literal from a formula in one column, and keeps a footnote marker in the value", () => {
    expect(cell(sheet, "F2")).toMatchObject({ type: "string", value: "A", formula: null });
    expect(cell(sheet, "G2")).toMatchObject({ type: "string", value: "Alph*", formula: null });
    expect(cell(sheet, "G6")).toMatchObject({ value: "EThe", formula: "CONCATENATE(E6,F6)" });
    expect(cell(sheet, "J2")?.value).toBe(NAMING_FOOTNOTE);
  });

  it("returns no cell for a spacer column", () => {
    expect(sheet?.cells.filter((candidate) => candidate.column === 4 || candidate.column === 9)).toEqual([]);
  });
});

describe("readWorkbook on parts written by hand", () => {
  it("keeps leading and trailing white space, inline strings, rich text and error tokens", () => {
    const [sheet] = readWorkbook(
      handWritten(
        '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t xml:space="preserve"> inline </t></is></c>' +
          '<c r="C2" t="e"><f>A2/0</f><v>#DIV/0!</v></c><c r="D2" t="s"><v>1</v></c><c r="E2" t="str"><f>A2&amp;"x"</f><v></v></c></row>',
        '<si><t xml:space="preserve">  two leading, one trailing </t></si>' +
          '<si><r><t>plain </t></r><r><rPr><strike/><b val="0"/></rPr><t>struck</t></r></si>',
      ),
    ).sheets;
    expect(sheet).toMatchObject({ name: "Raw", sheetId: "7", visibility: "visible", lastRow: 2, lastColumn: 5 });
    expect(cell(sheet, "A2")?.value).toBe("  two leading, one trailing ");
    expect(cell(sheet, "B2")).toMatchObject({ type: "string", value: " inline " });
    expect(cell(sheet, "C2")).toMatchObject({ type: "error", value: "#DIV/0!", formula: "A2/0" });
    expect(cell(sheet, "D2")).toMatchObject({
      value: "plain struck",
      richText: [
        { text: "plain ", strike: false, bold: false, italic: false },
        { text: "struck", strike: true, bold: false, italic: false },
      ],
    });
    // A formula whose cached text is empty is still a formula cell with an empty text.
    expect(cell(sheet, "E2")).toMatchObject({ type: "formulaString", value: "", formula: 'A2&"x"' });
  });

  it("places cells that carry no address after one another", () => {
    const [sheet] = readWorkbook(
      handWritten("<row><c><v>1</v></c><c><v>2.50</v></c></row><row><c><v>3</v></c></row>"),
    ).sheets;
    expect(sheet?.cells.map((candidate) => [candidate.ref, candidate.value, candidate.rawValue])).toEqual([
      ["A1", 1, "1"],
      ["B1", 2.5, "2.50"],
      ["A2", 3, "3"],
    ]);
  });

  it("joins the part of a link after the hash sign to its address, which the file keeps apart", () => {
    const relationship = (id: string, target: string) =>
      `<Relationship Id="${id}" Type="t" Target="${target}" TargetMode="External"/>`;
    const [sheet] = readWorkbook(
      zip({
        "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NAMESPACES}><sheets><sheet name="Links" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`,
        "xl/worksheets/sheet1.xml":
          `<?xml version="1.0"?><worksheet ${NAMESPACES}><sheetData><row r="1">` +
          '<c r="A1" t="inlineStr"><is><t>a calculator</t></is></c><c r="B1" t="inlineStr"><is><t>a page</t></is></c>' +
          '<c r="C1" t="inlineStr"><is><t>a place in this file</t></is></c><c r="D1" t="inlineStr"><is><t>an empty fragment</t></is></c>' +
          "</row></sheetData><hyperlinks>" +
          '<hyperlink r:id="rId1" ref="A1" location="section-2)"/><hyperlink r:id="rId2" ref="B1"/>' +
          '<hyperlink ref="C1" location="Sheet2!A1"/><hyperlink r:id="rId2" ref="D1" location=""/>' +
          "</hyperlinks></worksheet>",
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          relationship("rId1", "https://calculator.example.org/tool") +
          relationship("rId2", "https://pages.example.org/one") +
          "</Relationships>",
      }),
    ).sheets;
    expect(cell(sheet, "A1")?.hyperlink).toBe("https://calculator.example.org/tool#section-2)");
    expect(cell(sheet, "B1")?.hyperlink).toBe("https://pages.example.org/one");
    expect(cell(sheet, "C1")?.hyperlink).toBe("#Sheet2!A1");
    expect(cell(sheet, "D1")?.hyperlink).toBe("https://pages.example.org/one");
  });

  it("returns the notes of cells with their text as written, in the order of the sheet", () => {
    const [sheet, second] = readWorkbook(
      zip({
        "xl/workbook.xml":
          `<?xml version="1.0"?><workbook ${NAMESPACES}><sheets>` +
          '<sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="Plain" sheetId="2" r:id="rId2"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml":
          `<?xml version="1.0"?><worksheet ${NAMESPACES}><sheetData><row r="1">` +
          '<c r="A1" t="inlineStr"><is><t>Role one</t></is></c><c r="B1" t="inlineStr"><is><t>Role two</t></is></c>' +
          "</row></sheetData></worksheet>",
        "xl/worksheets/sheet2.xml": `<?xml version="1.0"?><worksheet ${NAMESPACES}><sheetData/></worksheet>`,
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>' +
          "</Relationships>",
        "xl/comments1.xml":
          `<?xml version="1.0"?><comments ${NAMESPACES}><authors><author/></authors><commentList>` +
          // The second note comes first in the file, holds two runs and begins with an invisible character.
          '<comment ref="B1" authorId="0"><text><r><t xml:space="preserve">\u200bAn invented </t></r><r><t>definition \u2013 in two runs.</t></r></text></comment>' +
          '<comment ref="A1" authorId="0"><text><t xml:space="preserve"> A plain note with a space at each end </t></text></comment>' +
          "</commentList></comments>",
      }),
    ).sheets;
    expect(sheet?.notes).toEqual([
      { ref: "A1", text: " A plain note with a space at each end " },
      { ref: "B1", text: "\u200bAn invented definition \u2013 in two runs." },
    ]);
    expect(second?.notes).toEqual([]);
  });

  it("returns the lists that a sheet validates cells against, with every option verbatim", () => {
    const [sheet] = readWorkbook(
      zip({
        "xl/workbook.xml": `<?xml version="1.0"?><workbook ${NAMESPACES}><sheets><sheet name="Lists" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`,
        "xl/worksheets/sheet1.xml":
          `<?xml version="1.0"?><worksheet ${NAMESPACES}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>` +
          '<dataValidations count="3">' +
          '<dataValidation type="list" allowBlank="1" sqref="W3:W9 W11:W13"><formula1>"Stage one (stage 1),Stage two (stage 2) ,null"</formula1></dataValidation>' +
          '<dataValidation type="list" sqref="B2:B5"><formula1>$Z$1:$Z$4</formula1></dataValidation>' +
          '<dataValidation type="whole" sqref="C2"><formula1>1</formula1></dataValidation>' +
          "</dataValidations></worksheet>",
      }),
    ).sheets;
    expect(sheet?.validations).toEqual([
      // A trailing space is part of an option, and the text `null` is an option like any other.
      {
        ranges: ["W3:W9", "W11:W13"],
        type: "list",
        options: ["Stage one (stage 1)", "Stage two (stage 2) ", "null"],
      },
      // A list that names a range states no options itself.
      { ranges: ["B2:B5"], type: "list", options: null },
      { ranges: ["C2"], type: "whole", options: null },
    ]);
    expect(readWorkbook(handWritten('<row r="1"><c r="A1"><v>1</v></c></row>')).sheets[0]?.validations).toEqual([]);
  });

  it("refuses a file that is no workbook, and a sheet that depends on a shared formula it does not define", () => {
    expect(() => readWorkbook(new TextEncoder().encode("<html>Sign in</html>"))).toThrow(WorkbookFormatError);
    expect(() => readWorkbook(zip({ "readme.txt": "no workbook part" }))).toThrow(WorkbookFormatError);
    expect(() => readWorkbook(handWritten('<row r="1"><c r="A1"><f t="shared" si="3"/><v>1</v></c></row>'))).toThrow(
      WorkbookFormatError,
    );
    expect(
      readZip(zip({ "a.txt": "kept" }))
        .get("a.txt")
        ?.toString(),
    ).toBe("kept");
  });
});

describe("the helpers of the reader", () => {
  it("converts between column numbers and letters", () => {
    expect([1, 26, 27, 702, 703].map(columnLetters)).toEqual(["A", "Z", "AA", "ZZ", "AAA"]);
    expect(["A", "Z", "AA", "ZZ", "AAA"].map(columnNumber)).toEqual([1, 26, 27, 702, 703]);
    expect(() => columnLetters(0)).toThrow(RangeError);
  });

  it("moves the relative references of a shared formula and leaves fixed ones and quoted text alone", () => {
    expect(shiftFormula("LEFT(A2, 3)", 5, 0)).toBe("LEFT(A7, 3)");
    expect(shiftFormula("CONCATENATE(E4,F4)", 1, 0)).toBe("CONCATENATE(E5,F5)");
    expect(shiftFormula('IF($A$1="A1",B1,$C1)', 2, 1)).toBe('IF($A$1="A1",C3,$C3)');
    expect(shiftFormula('COUNTIF(D2:AA2,"x")', 1, 0)).toBe('COUNTIF(D3:AA3,"x")');
    expect(shiftFormula("LOG10(A1)", 1, 0)).toBe("LOG10(A2)");
  });

  it("reads the options of a quoted list and the corners of a range", () => {
    expect(listOptions('"sig,null"')).toEqual(["sig", "null"]);
    expect(listOptions('"said ""yes"",no"')).toEqual(['said "yes"', "no"]);
    // A long list is split into quoted texts joined by an ampersand, in the middle of an option if need be.
    expect(listOptions('"Stage one,Stage two "&"(stage 2) ,Done"')).toEqual([
      "Stage one",
      "Stage two (stage 2) ",
      "Done",
    ]);
    expect(listOptions('"a,b" & "c"')).toEqual(["a", "bc"]);
    expect(listOptions("$A$1:$A$3")).toBeNull();
    expect(listOptions('"')).toBeNull();
    expect(listOptions('"a,b"+"c"')).toBeNull();
    expect(listOptions('"a,b"&')).toBeNull();
    expect(rangeBounds("F2:G39")).toEqual({ top: 2, left: 6, bottom: 39, right: 7 });
    expect(rangeBounds("C7")).toEqual({ top: 7, left: 3, bottom: 7, right: 3 });
  });

  it("tells a date format from a number format and converts a day number", () => {
    expect(["dd.mm.yyyy", "mm-dd-yy", "h:mm", "[$-409]d-mmm-yy"].map(isDateFormat)).toEqual([true, true, true, true]);
    expect(["General", "0.00", "#,##0", '0" days"', "@"].map(isDateFormat)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(serialToIsoDate(45356)).toBe("2024-03-05");
    expect(serialToIsoDate(43863.75)).toBe("2020-02-02");
    expect(serialToIsoDate(0, true)).toBe("1904-01-01");
  });
});
