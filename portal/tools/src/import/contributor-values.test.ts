// Unit tests of the readings of a contributor sheet. Every name and value here is invented.
import { CREDIT_ROLES } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import {
  classifyRow,
  contentKindOf,
  FIELD_HEADERS,
  holdsNonAscii,
  mapColumns,
  nearDuplicateAffiliations,
  normaliseHeader,
  readCheckbox,
  readOrder,
  similarity,
  verbatimText,
} from "./contributor-values";

const headed = (texts: readonly string[]) => texts.map((text, index) => ({ label: `C${index + 1}`, text }));
const ROLE_HEADERS = CREDIT_ROLES.map((role) => role.name.replace("\u2013", "-"));

describe("the unified column mapping", () => {
  it("compares headers trimmed, in one case, with runs of white space as one and a dash as a hyphen", () => {
    expect(normaliseHeader("  Writing \u2013  review &  editing ")).toBe("writing - review & editing");
    expect(normaliseHeader("WRITING \u2014 ORIGINAL DRAFT")).toBe("writing - original draft");
    expect(normaliseHeader(" \t ")).toBe("");
  });

  it("maps the columns of both template generations by header text, wherever they stand", () => {
    const columns = mapColumns(
      headed([
        "Surname",
        " firstname ",
        ...[...ROLE_HEADERS].reverse(),
        "Affiliation 3",
        "Primary affiliation",
        "Affiliation 2",
        "Email address",
        "ORCID iD",
        "Order in publication",
      ]),
    );
    expect(columns.missing).toEqual([]);
    expect(columns.duplicated).toEqual([]);
    expect(columns.fields.get("surname")).toBe("C1");
    expect(columns.fields.get("firstName")).toBe("C2");
    expect(columns.roles.size).toBe(14);
    // The last role of the taxonomy stands first here, written with a hyphen.
    expect(columns.roles.get("writingReviewEditing")).toBe("C3");
    expect([...columns.affiliations].sort()).toEqual([
      [1, "C18"],
      [2, "C19"],
      [3, "C17"],
    ]);
    expect(columns.unknown).toEqual([]);
  });

  it("matches whole headers, so that the three funding columns stay three columns", () => {
    const columns = mapColumns(headed(["Firstname", "Surname", ...ROLE_HEADERS, "Funding", "Funding 2", ""]));
    expect(columns.roles.get("fundingAcquisition")).toBe("C6");
    expect(columns.fields.get("funding")).toBe("C17");
    // A header that the mapping does not know is never mapped by a prefix, and a blank one never at all.
    expect(columns.unknown).toEqual([{ label: "C18", text: "Funding 2" }]);
    expect(columns.blank).toEqual(["C19"]);
    expect(columns.fields.has("orcid")).toBe(false);
  });

  it("names every header that a sheet must have and lacks, and every header that stands twice", () => {
    const columns = mapColumns(
      headed(["Firstname", "Firstname", ...ROLE_HEADERS.slice(0, 12), "Primary affiliation", "Affiliation 1"]),
    );
    expect(columns.missing).toEqual([
      FIELD_HEADERS.surname,
      "Writing \u2013 original draft",
      "Writing \u2013 review & editing",
    ]);
    expect(columns.duplicated).toEqual(["affiliation 1", "firstname"]);
  });
});

describe("the reading of a checkbox", () => {
  it("reads a stored boolean and the exact texts of a text export, and nothing else", () => {
    expect(readCheckbox(true)).toEqual({ tick: true, odd: false, blank: false });
    expect(readCheckbox("FALSE")).toEqual({ tick: false, odd: false, blank: false });
    for (const value of ["x", "yes", 1, "true", "Wahr"]) {
      expect(readCheckbox(value), String(value)).toEqual({ tick: null, odd: true, blank: false });
    }
  });

  it("reads a blank cell as unknown and never as false", () => {
    expect(readCheckbox(null)).toEqual({ tick: null, odd: false, blank: true });
    expect(readCheckbox("  ")).toEqual({ tick: null, odd: false, blank: true });
  });

  it("keeps the verbatim value as the sheet shows it", () => {
    expect(verbatimText(true)).toBe("TRUE");
    expect(verbatimText(false)).toBe("FALSE");
    expect(verbatimText(7)).toBe("7");
    expect(verbatimText(" Hal ")).toBe(" Hal ");
    expect(verbatimText(null)).toBeNull();
  });
});

describe("the classes of a row", () => {
  const unticked = [false, false, "FALSE", null];

  it("needs both names for a contributor, and sends a row with one of them to review", () => {
    expect(classifyRow("Ada", "Example", unticked)).toBe("contributor");
    expect(classifyRow(" Ada ", "Example", [])).toBe("contributor");
    expect(classifyRow("Ada", null, unticked)).toBe("halfNamed");
    expect(classifyRow("  ", "Example", unticked)).toBe("halfNamed");
  });

  it("tells a reserved position, a stray tick, a row of unticked boxes and a blank row apart", () => {
    expect(classifyRow(null, null, [12, ...unticked])).toBe("placeholder");
    expect(classifyRow(null, null, ["someone to be named", false])).toBe("placeholder");
    expect(classifyRow(null, null, [false, true, false])).toBe("strayTick");
    expect(classifyRow(null, "", unticked)).toBe("filler");
    expect(classifyRow(null, null, [null, "", "  "])).toBe("blank");
  });
});

describe("the reading of the order in publication", () => {
  it("accepts a number only when its stored value is whole", () => {
    expect(readOrder(3)).toEqual({ kind: "number", order: 3 });
    expect(readOrder(3.5)).toEqual({ kind: "unread" });
    expect(readOrder(-1)).toEqual({ kind: "unread" });
    // A number typed as text is no number: nothing is converted.
    expect(readOrder("3")).toEqual({ kind: "unread" });
  });

  it("stores the two words as a rule without an order, and leaves a blank absent", () => {
    expect(readOrder(" Alphabetical ")).toEqual({ kind: "rule", rule: "alphabetical" });
    expect(readOrder("last")).toEqual({ kind: "rule", rule: "last" });
    expect(readOrder("second to last")).toEqual({ kind: "unread" });
    expect(readOrder(null)).toEqual({ kind: "absent" });
    expect(readOrder("")).toEqual({ kind: "absent" });
  });
});

describe("the check of a column against its content", () => {
  it("says what the cells of a column hold, whatever its header says", () => {
    expect(contentKindOf([null, "", " "])).toBe("empty");
    expect(contentKindOf([1, 2, null, 34])).toBe("integers");
    expect(contentKindOf([1, "alphabetical", "last"])).toBe("order");
    expect(contentKindOf([false, "TRUE", null])).toBe("booleans");
    expect(contentKindOf(["0000-0009-0000-0011", " https://orcid.org/0000-0009-0000-001X "])).toBe("orcid");
    expect(contentKindOf(["one@example.org", "two@example.org "])).toBe("email");
    expect(contentKindOf(["one@example.org", "an invented funding statement"])).toBe("text");
    expect(contentKindOf([1, 2.5])).toBe("text");
  });

  it("finds a letter outside ASCII, which an address used for matching never holds", () => {
    expect(holdsNonAscii("pía@example.org")).toBe(true);
    expect(holdsNonAscii("pia@example.org")).toBe(false);
  });
});

describe("the screen for affiliation strings that may name one institution", () => {
  it("measures the share of common character pairs", () => {
    expect(similarity("examplecollege", "examplecollege")).toBe(1);
    expect(similarity("ab", "cd")).toBe(0);
    expect(similarity("a", "a b")).toBe(0);
    expect(similarity("night", "nacht")).toBeCloseTo(0.25);
  });

  it("proposes a pair where one string contains the other or the two are nearly alike, and never equal folds", () => {
    expect(nearDuplicateAffiliations("Mockup Institute", "Mockup Institute, Department of Models")).toBe(true);
    expect(nearDuplicateAffiliations("University of Nowhere", "Universty of Nowhere")).toBe(true);
    // The same string in another case is one candidate already, and no pair.
    expect(nearDuplicateAffiliations("Sample College", "SAMPLE  COLLEGE")).toBe(false);
    expect(nearDuplicateAffiliations("Sample College", "Imaginary Academy")).toBe(false);
    // A short string inside a longer one is no evidence.
    expect(nearDuplicateAffiliations("Lab", "Example Laboratory of Samples")).toBe(false);
  });
});
