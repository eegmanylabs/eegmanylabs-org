// The members directory: rows, search, filters, sort and the state in the address.
// Names and affiliations are synthetic.
import { describe, expect, it } from "vitest";
import {
  buildMemberRows,
  countryOptions,
  DEFAULT_MEMBER_STATE,
  filterMembers,
  NO_COUNTRY,
  type PersonSource,
  parseMemberState,
  serialiseMemberState,
  sortMembers,
} from "./member-list";

const person = (id: string, displayName: string, fields: Partial<PersonSource> = {}): PersonSource => ({
  id,
  displayName,
  replicationIds: [],
  laboratoryIds: [],
  isCoreTeam: false,
  coreRoles: [],
  userId: null,
  dataOrigin: "importedHistorical",
  archivedAt: null,
  ...fields,
});

const NAMES: Record<string, string> = { GB: "United Kingdom", DE: "Germany", NL: "Netherlands" };
const rows = buildMemberRows(
  [
    person("p1", "Ada Example", {
      givenName: "Ada",
      familyName: "Example",
      affiliationSummary: "Northfield Example University",
      countryCode: "GB",
      replicationIds: ["ExampleAlpha2001"],
      laboratoryIds: ["lab-a"],
      userId: "uid-1",
    }),
    person("p2", "Zoë Ångström", {
      givenName: "Zoë",
      familyName: "Ångström",
      affiliationSummary: "Harbour Example Institute",
      countryCode: "DE",
      isCoreTeam: true,
      coreRoles: ["Coordinator"],
      replicationIds: ["ExampleAlpha2001", "ExampleBeta2005"],
    }),
    person("p3", "Ben Sample", { givenName: "Ben", familyName: "Sample" }),
    person("p4", "Archived Person", { archivedAt: new Date() }),
  ],
  (code) => NAMES[code] ?? code,
);
const ids = (state: Partial<typeof DEFAULT_MEMBER_STATE>) =>
  filterMembers(rows, { ...DEFAULT_MEMBER_STATE, ...state }).map((row) => row.id);

describe("the members directory", () => {
  it("finds people by names in right-to-left and East Asian scripts, and matches nothing for a query it cannot read", () => {
    const scripts = buildMemberRows(
      [
        person("p-ar", "سارة مثال", { affiliationSummary: "جامعة المثال" }),
        person("p-he", "שרה דוגמה"),
        person("p-zh", "示例 人", { affiliationSummary: "示例大学" }),
        person("p-en", "Sara Example"),
      ],
      (code) => code,
    );
    const found = (query: string) => filterMembers(scripts, { ...DEFAULT_MEMBER_STATE, query }).map((row) => row.id);
    expect(found("سارة")).toEqual(["p-ar"]);
    expect(found("المثال")).toEqual(["p-ar"]);
    expect(found("דוגמה")).toEqual(["p-he"]);
    expect(found("大学")).toEqual(["p-zh"]);
    expect(found("!!")).toEqual([]);
    expect(found("  ")).toHaveLength(4);
  });

  it("leaves archived people out and orders names by family name", () => {
    expect(rows.map((row) => row.id)).toEqual(["p1", "p2", "p3"]);
    expect(sortMembers(rows, "name", "asc").map((row) => row.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("searches the name and the affiliation, every word, without regard to case or accents", () => {
    expect(ids({ query: "zoe" })).toEqual(["p2"]);
    expect(ids({ query: "angstrom HARBOUR" })).toEqual(["p2"]);
    expect(ids({ query: "northfield" })).toEqual(["p1"]);
    expect(ids({ query: "example" })).toEqual(["p1", "p2"]);
    expect(ids({ query: "sample northfield" })).toEqual([]);
  });

  it("filters by country, its absence, replication, laboratory and core team", () => {
    expect(ids({ country: "GB" })).toEqual(["p1"]);
    expect(ids({ country: NO_COUNTRY })).toEqual(["p3"]);
    expect(ids({ replication: "ExampleBeta2005" })).toEqual(["p2"]);
    expect(ids({ replication: "ExampleAlpha2001", coreTeam: true })).toEqual(["p2"]);
    expect(ids({ laboratory: "lab-a" })).toEqual(["p1"]);
  });

  it("sorts with missing values last either way, and by counts and flags", () => {
    expect(sortMembers(rows, "country", "asc").map((row) => row.id)).toEqual(["p2", "p1", "p3"]);
    expect(sortMembers(rows, "country", "desc").map((row) => row.id)).toEqual(["p1", "p2", "p3"]);
    expect(sortMembers(rows, "replications", "desc").map((row) => row.id)).toEqual(["p2", "p1", "p3"]);
    expect(sortMembers(rows, "claimed", "desc").map((row) => row.id)).toEqual(["p1", "p2", "p3"]);
    expect(sortMembers(rows, "core", "desc")[0]?.id).toBe("p2");
  });

  it("offers the countries that occur, by name", () => {
    expect(countryOptions(rows)).toEqual([
      { code: "DE", name: "Germany" },
      { code: "GB", name: "United Kingdom" },
    ]);
  });

  it("keeps its state in the address and reads it back", () => {
    const state = {
      ...DEFAULT_MEMBER_STATE,
      query: "ada",
      country: NO_COUNTRY,
      replication: "ExampleAlpha2001",
      laboratory: "lab-a",
      coreTeam: true,
      sort: "country" as const,
      direction: "desc" as const,
      open: "p1",
    };
    expect(parseMemberState(serialiseMemberState(state))).toEqual(state);
    expect(serialiseMemberState(DEFAULT_MEMBER_STATE).toString()).toBe("");
    expect(parseMemberState(new URLSearchParams("sort=email&core=maybe"))).toEqual(DEFAULT_MEMBER_STATE);
  });

  it("filters and sorts a thousand rows quickly", () => {
    const many = buildMemberRows(
      Array.from({ length: 1_000 }, (_, index) =>
        person(`m${index}`, `Synthetic Person ${index}`, { affiliationSummary: `Example Institute ${index % 37}` }),
      ),
      (code) => code,
    );
    const started = performance.now();
    const found = sortMembers(
      filterMembers(many, { ...DEFAULT_MEMBER_STATE, query: "institute 3" }),
      "affiliation",
      "desc",
    );
    expect(found.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
