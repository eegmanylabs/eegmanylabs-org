// The list of replications: rows, search, filters, sort and the state in the address.
// Study identifiers, names and titles are synthetic.
import { describe, expect, it } from "vitest";
import {
  buildReplicationRows,
  DEFAULT_REPLICATION_STATE,
  filterOptions,
  filterReplications,
  NO_STATUS,
  parseReplicationState,
  type ReplicationSource,
  type RowInputs,
  serialiseReplicationState,
  sortReplications,
  stageText,
} from "./replication-list";

const replication = (studyKey: string, fields: Partial<ReplicationSource> = {}): ReplicationSource => ({
  id: studyKey,
  studyKey,
  statusKey: null,
  leadPersonIds: [],
  selectionStatus: "selected",
  dataOrigin: "importedHistorical",
  archivedAt: null,
  ...fields,
});

const inputs = (replications: readonly ReplicationSource[], overrides: Partial<RowInputs> = {}): RowInputs => ({
  replications,
  statuses: [
    { key: "planning", label: "Planning", position: 1 },
    { key: "collecting", label: "Collecting", position: 4 },
  ],
  personNames: new Map([["person-a", "Ada Example"]]),
  leadsToReview: new Set(),
  laboratoryCounts: new Map(),
  publicationStatuses: new Map(),
  aliases: new Map(),
  ...overrides,
});

const WORLD = [
  replication("ExampleAlpha2001", {
    shortTitle: "An invented attention study",
    originalAuthors: "Example, A.",
    originalYear: 2001,
    statusKey: "collecting",
    publicStageNumber: 3,
    publicStageName: "Data collection",
    theme: "Attention",
    leadPersonIds: ["person-a"],
  }),
  replication("ExampleBeta2005", {
    originalTitle: "A made-up memory study",
    originalAuthors: "Placeholder, B.",
    originalYear: 2005,
    statusKey: "planning",
    publicStageNumber: 1,
    theme: "Memory",
  }),
  replication("ExampleGamma2010", { selectionStatus: "withdrawn", statusKey: "retiredStatus" }),
  replication("ExampleDelta2015", { archivedAt: new Date() }),
];

const rows = buildReplicationRows(
  inputs(WORLD, {
    leadsToReview: new Set(["ExampleBeta2005"]),
    laboratoryCounts: new Map([["ExampleAlpha2001", 2]]),
    publicationStatuses: new Map([["ExampleAlpha2001", ["published", "planned"]]]),
    aliases: new Map([["ExampleBeta2005", ["Exmpl_Beta", "ExampleBéta"]]]),
  }),
);
const byKey = (key: string) => rows.find((row) => row.studyKey === key);

describe("buildReplicationRows", () => {
  it("leaves archived replications out and says where a value is not recorded", () => {
    expect(rows.map((row) => row.studyKey)).toEqual(["ExampleAlpha2001", "ExampleBeta2005", "ExampleGamma2010"]);
    expect(byKey("ExampleGamma2010")).toMatchObject({
      title: null,
      originalYear: null,
      stageNumber: null,
      theme: null,
    });
  });

  it("names the status by its label, and keeps the key of a status the programme no longer configures", () => {
    expect(byKey("ExampleAlpha2001")).toMatchObject({ statusLabel: "Collecting", statusPosition: 4 });
    expect(byKey("ExampleGamma2010")).toMatchObject({ statusLabel: "retiredStatus", statusPosition: null });
  });

  it("names confirmed leads, and says that a lead needs review only where the caller sees one", () => {
    expect(byKey("ExampleAlpha2001")).toMatchObject({ leadNames: ["Ada Example"], leadState: "confirmed" });
    expect(byKey("ExampleBeta2005")).toMatchObject({ leadNames: [], leadState: "needsReview" });
    expect(byKey("ExampleGamma2010")?.leadState).toBe("none");
  });

  it("counts laboratories and publications, and takes the original title where there is no short title", () => {
    expect(byKey("ExampleAlpha2001")).toMatchObject({ laboratoryCount: 2, publicationCount: 2 });
    expect(byKey("ExampleBeta2005")).toMatchObject({
      laboratoryCount: 0,
      publicationCount: 0,
      title: "A made-up memory study",
    });
  });
});

describe("filterReplications", () => {
  const keys = (state: Partial<typeof DEFAULT_REPLICATION_STATE>) =>
    filterReplications(rows, { ...DEFAULT_REPLICATION_STATE, ...state }).map((row) => row.studyKey);

  it("searches the identifier, the other spellings, the titles, the authors and the year, folding case and accents", () => {
    expect(keys({ query: "alpha" })).toEqual(["ExampleAlpha2001"]);
    expect(keys({ query: "exmpl_beta" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ query: "examplebeta" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ query: "INVENTED attention" })).toEqual(["ExampleAlpha2001"]);
    expect(keys({ query: "placeholder" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ query: "2005" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ query: "nothing like it" })).toEqual([]);
  });

  it("filters by status, by the absence of one, by stage, by theme, by listing and by the status of a publication", () => {
    expect(keys({ status: "planning" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ status: NO_STATUS })).toEqual([]);
    expect(keys({ stage: "3" })).toEqual(["ExampleAlpha2001"]);
    expect(keys({ stage: NO_STATUS })).toEqual(["ExampleGamma2010"]);
    expect(keys({ theme: "Memory" })).toEqual(["ExampleBeta2005"]);
    expect(keys({ listing: "withdrawn" })).toEqual(["ExampleGamma2010"]);
    expect(keys({ listing: "listed" })).toEqual(["ExampleAlpha2001", "ExampleBeta2005"]);
    expect(keys({ publication: "published" })).toEqual(["ExampleAlpha2001"]);
    expect(keys({ publication: "rejected" })).toEqual([]);
  });

  it("combines the search with every filter", () => {
    expect(keys({ query: "example", theme: "Attention", status: "collecting" })).toEqual(["ExampleAlpha2001"]);
    expect(keys({ query: "alpha", theme: "Memory" })).toEqual([]);
  });
});

describe("sortReplications", () => {
  const order = (key: Parameters<typeof sortReplications>[1], direction: "asc" | "desc") =>
    sortReplications(rows, key, direction).map((row) => row.studyKey);

  it("sorts by status in the order the programme gives, with a status it no longer configures after those", () => {
    expect(order("status", "asc")).toEqual(["ExampleBeta2005", "ExampleAlpha2001", "ExampleGamma2010"]);
  });

  it("keeps a missing value last whichever way the column is sorted", () => {
    expect(order("stage", "asc")).toEqual(["ExampleBeta2005", "ExampleAlpha2001", "ExampleGamma2010"]);
    expect(order("stage", "desc")).toEqual(["ExampleAlpha2001", "ExampleBeta2005", "ExampleGamma2010"]);
    expect(order("theme", "desc")).toEqual(["ExampleBeta2005", "ExampleAlpha2001", "ExampleGamma2010"]);
  });

  it("sorts numbers as numbers and breaks ties by the identifier", () => {
    expect(order("laboratories", "desc")).toEqual(["ExampleAlpha2001", "ExampleBeta2005", "ExampleGamma2010"]);
    expect(order("laboratories", "asc")).toEqual(["ExampleBeta2005", "ExampleGamma2010", "ExampleAlpha2001"]);
    expect(order("studyKey", "desc")).toEqual(["ExampleGamma2010", "ExampleBeta2005", "ExampleAlpha2001"]);
  });
});

describe("the state in the address", () => {
  it("reads what it wrote, and leaves the defaults out", () => {
    const state = {
      ...DEFAULT_REPLICATION_STATE,
      query: "alpha beta",
      status: "planning",
      stage: NO_STATUS,
      theme: "Attention & memory",
      listing: "withdrawn" as const,
      publication: "published",
      sort: "laboratories" as const,
      direction: "desc" as const,
      open: "ExampleAlpha2001",
    };
    expect(parseReplicationState(serialiseReplicationState(state))).toEqual(state);
    expect(serialiseReplicationState(DEFAULT_REPLICATION_STATE).toString()).toBe("");
  });

  it("falls back to the defaults for values it does not know", () => {
    expect(parseReplicationState(new URLSearchParams("sort=secret&dir=sideways&listing=hidden&status="))).toEqual(
      DEFAULT_REPLICATION_STATE,
    );
  });
});

describe("filterOptions and stageText", () => {
  it("offers the statuses, stages and themes that occur, in order, and says when some have none", () => {
    expect(filterOptions(rows)).toEqual({
      statuses: [
        { key: "planning", label: "Planning" },
        { key: "collecting", label: "Collecting" },
        { key: "retiredStatus", label: "retiredStatus" },
      ],
      stages: [
        { number: 1, name: null },
        { number: 3, name: "Data collection" },
      ],
      themes: ["Attention", "Memory"],
      hasNoStatus: false,
      hasNoStage: true,
    });
  });

  it("reads a stage with its number and its name, either of which may be missing", () => {
    expect(stageText({ stageNumber: 3, stageName: "Data collection" })).toBe("3. Data collection");
    expect(stageText({ stageNumber: 1, stageName: null })).toBe("Stage 1");
    // A machine value from a source reads as words, and a name written for people stays as it is.
    expect(stageText({ stageNumber: 6, stageName: "data_collection" })).toBe("6. Data collection");
    expect(stageText({ stageNumber: null, stageName: "Stage_1 report" })).toBe("Stage_1 report");
    expect(stageText({ stageNumber: null, stageName: "Planning" })).toBe("Planning");
    expect(stageText({ stageNumber: null, stageName: null })).toBeNull();
  });
});
