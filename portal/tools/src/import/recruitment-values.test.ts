// Unit tests of the readings of a recruitment and contact workbook. Every value is synthetic:
// the names are invented and every address is on example.org.
import { describe, expect, it } from "vitest";
import {
  addressesIn,
  classifyNameCell,
  doiIn,
  fillBucket,
  isPlainColumnAggregate,
  linksIn,
  nameChecks,
  normaliseLink,
  peopleIn,
  proposeResult,
  readAddress,
  readOutreachDate,
  recomputeAggregate,
  rowFillBucket,
  textOf,
} from "./recruitment-values";

describe("classifyNameCell", () => {
  it.each([
    ["one name", "Ada Example", false, "contact"],
    ["a tentative name", "Bo Fictional?", false, "contact"],
    ["two names with a semicolon", "Cy Invented; Dee Imaginary", true, "contact"],
    ["a name beside its address", "Eli Madeup <eli@example.org>", false, "contact"],
    ["a label of the rows below it", "More invented names:", false, "sectionLabel"],
    ["a name that ends with a colon beside other cells", "More invented names:", true, "contact"],
    ["a name with a role before a second name", "Fay Sample (Supervisor): Gus Mock", true, "severalPeople"],
    ["a pasted list of recipients", "Ada <ada@example.org>; bo@example.org", false, "recipientList"],
    ["a cell with a line break", "Ada Example\nBo Fictional", false, "recipientList"],
    ["more than five words", "check people who work on invented things", false, "freeText"],
    ["more than sixty characters", `${"An-invented-title-without-spaces-".repeat(2)}end`, false, "freeText"],
    ["nothing, beside other cells", "  ", true, "empty"],
  ] as const)("classes %s", (_label, text, others, expected) => {
    expect(classifyNameCell(text, others)).toBe(expected);
  });

  it("counts five words and sixty characters as a name still", () => {
    expect(classifyNameCell("Ada Bea Cy Dee Example", false)).toBe("contact");
    expect(classifyNameCell("x".repeat(60), false)).toBe("contact");
    expect(classifyNameCell(null, true)).toBe("empty");
  });
});

describe("nameChecks and peopleIn", () => {
  it("names what a name cell holds beyond one plain name", () => {
    expect(nameChecks("Ada Example")).toEqual([]);
    expect(nameChecks("Ada Example? ")).toEqual(["tentative"]);
    expect(nameChecks("Cy Invented; Dee Imaginary")).toEqual(["semicolon"]);
    expect(nameChecks("Cy Invented, Dee Imaginary")).toEqual(["comma"]);
    expect(nameChecks("Ada Example (student)")).toEqual(["annotation"]);
    expect(nameChecks("ada.example")).toEqual(["addressForm"]);
    expect(nameChecks("Ada-Bea Example")).toEqual([]);
  });

  it("splits people on semicolons only", () => {
    expect(peopleIn("Cy Invented; Dee Imaginary ;")).toEqual(["Cy Invented", "Dee Imaginary"]);
    expect(peopleIn("Invented, Cy")).toEqual(["Invented, Cy"]);
  });
});

describe("readAddress", () => {
  it("reads exactly one address, in lower case for matching", () => {
    expect(readAddress(" Ada.Example@Example.org ")).toEqual({ status: "valid", canonical: "ada.example@example.org" });
    expect(readAddress(null)).toEqual({ status: "absent" });
    expect(readAddress("   ")).toEqual({ status: "absent" });
  });

  it("offers the reversal of a reversed address as a candidate, and nothing for anything else", () => {
    expect(readAddress(" gro.elpmaxe@ada")).toEqual({ status: "reversed", decoded: "ada@example.org" });
    // Read backwards, an address with a full stop before the at sign is an address as well. No rule can tell.
    const backwards = [..."ada.example@example.org"].reverse().join("");
    expect(readAddress(backwards)).toEqual({ status: "valid", canonical: backwards });
    expect(readAddress("ada at example dot org")).toEqual({ status: "invalid" });
    expect(readAddress("ada@example.org, bo@example.org")).toEqual({ status: "invalid" });
  });

  it("finds every address inside a text", () => {
    expect(addressesIn("Ada <ada@example.org>; bo@example.org and no more")).toEqual([
      "ada@example.org",
      "bo@example.org",
    ]);
    expect(addressesIn("no address here")).toEqual([]);
  });
});

describe("readOutreachDate", () => {
  it("reads both text forms day first", () => {
    expect(readOutreachDate({ v: "05.03.21", t: "string" })).toEqual({
      status: "parsed",
      iso: "2021-03-05",
      form: "text",
    });
    expect(readOutreachDate({ v: " 19.04.2021 ", t: "string" })).toEqual({
      status: "parsed",
      iso: "2021-04-19",
      form: "text",
    });
  });

  it("reads a true date from its day number, and leaves it open where day and month could have changed places", () => {
    // Day 44278 is 23 March 2021, which can only be day first.
    expect(readOutreachDate({ v: 44278, t: "number", z: "d/m/yy" })).toEqual({
      status: "parsed",
      iso: "2021-03-23",
      form: "trueDate",
    });
    // Day 44264 is 9 March 2021, which a person may have typed as the third of September.
    expect(readOutreachDate({ v: 44264, t: "number", z: "d/m/yy" })).toEqual({
      status: "ambiguous",
      iso: "2021-03-09",
      form: "trueDate",
    });
    // The third of March reads the same either way.
    expect(readOutreachDate({ v: 44258, t: "number", z: "d/m" })).toMatchObject({
      status: "parsed",
      iso: "2021-03-03",
    });
    expect(readOutreachDate({ v: "2021-03-23T00:00:00.000Z", t: "isoDate" })).toMatchObject({ status: "parsed" });
  });

  it("reads nothing out of any other content", () => {
    expect(readOutreachDate(null)).toEqual({ status: "absent" });
    expect(readOutreachDate({ v: "", t: "string" })).toEqual({ status: "absent" });
    expect(readOutreachDate({ v: "31.02.22", t: "string" })).toEqual({ status: "unreadable" });
    expect(readOutreachDate({ v: "March 2021", t: "string" })).toEqual({ status: "unreadable" });
    expect(readOutreachDate({ v: "2021-03-05", t: "string" })).toEqual({ status: "unreadable" });
    // A number that the file does not show as a date is no date.
    expect(readOutreachDate({ v: 44278, t: "number" })).toEqual({ status: "unreadable" });
  });
});

describe("fillBucket", () => {
  it.each([
    ["FF0000", "red"],
    ["D00000", "red"],
    ["E04030", "red"],
    ["00FF00", "green"],
    ["8FCB7A", "green"],
    ["70A850", "green"],
    ["FFFFFF", "none"],
    ["FFFF00", "other"],
    ["4080E0", "other"],
    ["808080", "other"],
  ] as const)("buckets %s as %s", (rgb, expected) => {
    expect(fillBucket(rgb)).toBe(expected);
  });

  it("reads no fill as none, and a colour it cannot resolve as other", () => {
    expect(fillBucket(null)).toBe("none");
    expect(fillBucket("indexed")).toBe("other");
  });

  it("gives a row the colour of its name cell or of its result cell, and other where the two differ", () => {
    expect(rowFillBucket("none", "red")).toBe("red");
    expect(rowFillBucket("green", "none")).toBe("green");
    expect(rowFillBucket("red", "red")).toBe("red");
    expect(rowFillBucket("green", "red")).toBe("other");
    expect(rowFillBucket("none", "none")).toBe("none");
  });
});

describe("proposeResult", () => {
  it("reads a short result by everyday words", () => {
    expect(proposeResult("Agreed to take part")).toBe("accepted");
    expect(proposeResult(" accepted ")).toBe("accepted");
    expect(proposeResult("declined")).toBe("declined");
    expect(proposeResult("rejected by reply")).toBe("declined");
    expect(proposeResult("no reply")).toBe("noReply");
    expect(proposeResult("didn't answer")).toBe("noReply");
  });

  it("leaves a result to a reviewer when no word reads it, when two readings meet, or when it is a narrative", () => {
    expect(proposeResult("?")).toBeNull();
    expect(proposeResult("busy with another invented project")).toBeNull();
    expect(proposeResult("accepted, then declined")).toBeNull();
    expect(proposeResult("")).toBeNull();
    expect(
      proposeResult("wrote back after a while that the invented group had agreed in principle but would not confirm"),
    ).toBeNull();
    // A word inside another word is no reading.
    expect(proposeResult("disagreed")).toBeNull();
  });
});

describe("links", () => {
  it("stores an address without access tokens, session parameters and an empty fragment", () => {
    expect(normaliseLink("https://papers.example.org/article?casa_token=INVENTED&page=2")).toEqual({
      url: "https://papers.example.org/article?page=2",
      carriedSession: true,
    });
    expect(normaliseLink("https://papers.example.org/article?login=false")).toEqual({
      url: "https://papers.example.org/article",
      carriedSession: true,
    });
    // One publisher writes the name and the value as one encoded name.
    expect(normaliseLink("https://papers.example.org/article?via%3Dihub")).toEqual({
      url: "https://papers.example.org/article",
      carriedSession: true,
    });
    expect(normaliseLink("https://papers.example.org/article#")).toEqual({
      url: "https://papers.example.org/article",
      carriedSession: false,
    });
    expect(normaliseLink("https://papers.example.org/article?page=2#section")).toEqual({
      url: "https://papers.example.org/article?page=2#section",
      carriedSession: false,
    });
  });

  it("refuses what is no address that the portal may link to", () => {
    expect(normaliseLink("javascript:alert(1)")).toEqual({ url: null, carriedSession: false });
    expect(normaliseLink("mailto:ada@example.org")).toEqual({ url: null, carriedSession: false });
    expect(normaliseLink("see the page")).toEqual({ url: null, carriedSession: false });
  });

  it("prefers the target of a hyperlink over the text, and finds an address that is text only", () => {
    expect(linksIn("https://papers.example.org/article#", "https://papers.example.org/article")).toEqual([
      {
        urlSource: "https://papers.example.org/article",
        url: "https://papers.example.org/article",
        carriedSession: false,
      },
    ]);
    expect(linksIn("an invented page (https://staff.example.org/ada).", null)).toEqual([
      { urlSource: "https://staff.example.org/ada", url: "https://staff.example.org/ada", carriedSession: false },
    ]);
    expect(linksIn("first https://a.example.org/x then https://b.example.org/y", null).map((link) => link.url)).toEqual(
      ["https://a.example.org/x", "https://b.example.org/y"],
    );
    // An address in a mail link is no web address.
    expect(linksIn("ada@example.org", "mailto:ada@example.org")).toEqual([]);
    expect(linksIn(null, null)).toEqual([]);
  });

  it("finds the DOI of a study line, in lower case and without a final full stop", () => {
    expect(doiIn("Study: Invented, A. (2001). A title. https://doi.org/10.1000/Invented(01)00001-2.", null)).toBe(
      "10.1000/invented(01)00001-2",
    );
    expect(doiIn("Study: Invented, A. (2001). A title.", "https://doi.org/10.1000/invented.2001.01")).toBe(
      "10.1000/invented.2001.01",
    );
    expect(doiIn("Study: Invented", null)).toBeNull();
  });
});

describe("recomputeAggregate", () => {
  const grid: Readonly<Record<string, number | null>> = { C2: 4, C3: null, C4: 7, C5: 0, D2: 100, D4: 55 };
  const numberAt = (row: number, column: number) => grid[`${String.fromCharCode(64 + column)}${row}`] ?? null;

  it("recomputes a total and a median, where a cell without a number counts for nothing", () => {
    expect(recomputeAggregate("SUM(C2:C5)", numberAt)).toBe(11);
    expect(recomputeAggregate("=MEDIAN(C2:C5)", numberAt)).toBe(4);
    expect(recomputeAggregate("MEDIAN(D2:D5)", numberAt)).toBe(77.5);
    expect(recomputeAggregate("SUM(D4,D2,C4)", numberAt)).toBe(162);
    expect(recomputeAggregate("SUM(E2:E5)", numberAt)).toBe(0);
    expect(recomputeAggregate("MEDIAN(E2:E5)", numberAt)).toBeNull();
  });

  it("returns null for a formula it does not read", () => {
    expect(recomputeAggregate("AVERAGE(C2:C5)", numberAt)).toBeNull();
    expect(recomputeAggregate("SUM(C2:C5)+1", numberAt)).toBeNull();
    expect(recomputeAggregate("SUM(Sheet2!C2:C5)", numberAt)).toBeNull();
  });

  it("tells a plain total of one column from one that is put together by hand", () => {
    expect(isPlainColumnAggregate("SUM(C2:C27)")).toBe(true);
    expect(isPlainColumnAggregate("MEDIAN(D2:D27)")).toBe(true);
    expect(isPlainColumnAggregate("SUM(D26,D20,F16)")).toBe(false);
    expect(isPlainColumnAggregate("SUM(C2:D27)")).toBe(false);
  });
});

describe("textOf", () => {
  it("gives a number in the characters that the file holds", () => {
    expect(textOf({ v: 8, t: "number", r: "8.0" })).toBe("8.0");
    expect(textOf({ v: 0, t: "number" })).toBe("0");
    expect(textOf({ v: " kept as written ", t: "string" })).toBe(" kept as written ");
    expect(textOf(null)).toBeNull();
    expect(textOf({ v: null, t: "empty", merge: "C4:C5" })).toBeNull();
  });
});
