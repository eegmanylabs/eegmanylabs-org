// The view engine over a synthetic database of laboratories and a synthetic collection of
// checklist items: every filter operator, sorting by several keys, grouping, rollups through
// relations and backlinks, formulas with their errors, search and the whole pipeline.
import { describe, expect, it } from "vitest";
import {
  aggregate,
  applyRollup,
  computeView,
  deriveRecords,
  groupedAggregate,
  groupRecords,
  orderedProperties,
  recordMatchesSearch,
  sortRecords,
  visibleProperties,
  withinScope,
} from "./compute";
import { matchesFilter, operandKind, operatorsFor, resolveFilterDate, windowDays } from "./filter";
import {
  type CollectionData,
  type FilterNode,
  type FilterOperator,
  filterNodeSchema,
  type PropertyValue,
  type ViewProperty,
  type ViewRecord,
  viewConfigSchema,
} from "./model";
import { type EngineContext, utcDayOf } from "./values";

const property = (id: string, type: ViewProperty["type"], config: ViewProperty["config"] = {}): ViewProperty => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  type,
  config,
  source: type === "rollup" || type === "formula" ? "computed" : "row",
});

const STATUS = property("status", "status", {
  options: [
    { id: "planned", name: "Planned", group: "toDo" },
    { id: "active", name: "Active", group: "inProgress" },
    { id: "closed", name: "Closed", group: "complete" },
  ],
});
const TAGS = property("tags", "multiSelect", {
  options: [
    { id: "eeg", name: "EEG" },
    { id: "pilot", name: "Pilot" },
  ],
});

const PROPERTIES: ViewProperty[] = [
  { ...property("title", "text"), name: "Name", source: "title" },
  STATUS,
  TAGS,
  property("target", "number"),
  property("recruited", "number"),
  property("due", "date"),
  property("window", "dateRange"),
  property("ready", "checkbox"),
  property("owner", "person"),
  property("site", "relation", { relation: { target: "db:sites" } }),
  property("website", "url"),
  property("items", "rollup", {
    rollup: {
      source: { backlink: { collection: "db:items", property: "parent" } },
      property: "done",
      function: "percentChecked",
    },
  }),
  property("itemCount", "rollup", {
    rollup: {
      source: { backlink: { collection: "db:items", property: "parent" } },
      property: "done",
      function: "count",
    },
  }),
  property("siteCountry", "rollup", {
    rollup: { source: { relation: "site" }, property: "country", function: "showValues" },
  }),
  property("remaining", "formula", { formula: { expression: 'prop("Target") - prop("Recruited")' } }),
  property("progress", "formula", { formula: { expression: 'round(prop("Recruited") / prop("Target") * 100)' } }),
  property("ratio", "formula", { formula: { expression: 'prop("Target") / prop("Recruited")' } }),
  property("daysLeft", "formula", { formula: { expression: 'dateBetween(prop("Due"), today(), "days")' } }),
  property("loopA", "formula", { formula: { expression: 'prop("LoopB")' } }),
  property("loopB", "formula", { formula: { expression: 'prop("LoopA")' } }),
  property("broken", "formula", { formula: { expression: "1 +" } }),
  property("created", "createdTime"),
];

const record = (
  id: string,
  values: Record<string, PropertyValue>,
  createdAt = "2026-01-01T10:00:00.000Z",
): ViewRecord => ({
  id,
  reference: { entityType: "databaseRow", entityId: `labs__${id}` },
  values,
  createdAt,
  updatedAt: createdAt,
  createdBy: "uid-owner",
  updatedBy: "uid-owner",
});

const RECORDS: ViewRecord[] = [
  record("a", {
    title: "Synthetic Laboratory Åland",
    status: "active",
    tags: ["eeg", "pilot"],
    target: 40,
    recruited: 25,
    due: "2026-11-21",
    window: { start: "2026-11-01", end: "2026-11-30" },
    ready: true,
    owner: ["uid-alex"],
    site: [{ entityType: "databaseRow", entityId: "sites__s1" }],
    website: "https://example.org/a",
  }),
  record(
    "b",
    {
      title: "Synthetic Laboratory Berlin",
      status: "planned",
      tags: ["eeg"],
      target: 30,
      recruited: 0,
      due: "2026-11-05",
      ready: false,
      owner: ["uid-blake"],
    },
    "2026-03-01T10:00:00.000Z",
  ),
  record(
    "c",
    {
      title: "Synthetic Laboratory Cork",
      status: "closed",
      target: 20,
      recruited: 0,
      due: "2027-02-01",
    },
    "2026-11-10T10:00:00.000Z",
  ),
  record("d", { title: "Synthetic Laboratory Dundee", recruited: 12 }, "2026-11-11T08:00:00.000Z"),
];

const ITEMS: CollectionData = {
  key: "db:items",
  label: "Items",
  titleProperty: "title",
  properties: [property("title", "text"), property("done", "checkbox"), property("parent", "relation")],
  records: [
    record("i1", { title: "Ethics", done: true, parent: [{ entityType: "databaseRow", entityId: "labs__a" }] }),
    record("i2", { title: "Pilot", done: false, parent: [{ entityType: "databaseRow", entityId: "labs__a" }] }),
    record("i3", { title: "Training", done: true, parent: [{ entityType: "databaseRow", entityId: "labs__a" }] }),
    record("i4", { title: "Not applicable", done: null, parent: [{ entityType: "databaseRow", entityId: "labs__a" }] }),
    record("i5", { title: "Ethics", done: false, parent: [{ entityType: "databaseRow", entityId: "labs__b" }] }),
  ],
};

const SITES: CollectionData = {
  key: "db:sites",
  label: "Sites",
  titleProperty: "title",
  properties: [property("title", "text"), property("country", "text")],
  records: [
    {
      ...record("s1", { title: "Site one", country: "Finland" }),
      reference: { entityType: "databaseRow", entityId: "sites__s1" },
    },
  ],
};

const LABS: CollectionData = {
  key: "db:labs",
  label: "Labs",
  titleProperty: "title",
  properties: PROPERTIES,
  records: RECORDS,
};

const CONTEXT: EngineContext = {
  today: "2026-11-11",
  now: new Date("2026-11-11T12:00:00Z"),
  dayOf: utcDayOf,
  personName: (uid) => ({ "uid-alex": "Alex Example", "uid-blake": "Blake Example" })[uid] ?? null,
  collections: new Map([
    ["db:items", ITEMS],
    ["db:sites", SITES],
  ]),
};

const BY_ID = new Map(PROPERTIES.map((candidate) => [candidate.id, candidate]));
const derived = deriveRecords(LABS, CONTEXT);
const derivedValue = (id: string, propertyId: string) =>
  derived.find((candidate) => candidate.id === id)?.values[propertyId];
const errorOf = (id: string, propertyId: string) =>
  derived.find((candidate) => candidate.id === id)?.errors[propertyId];

function ids(filter: FilterNode): string[] {
  return derived
    .filter((candidate) => matchesFilter(filter, candidate, BY_ID, CONTEXT))
    .map((candidate) => candidate.id);
}

const where = (propertyId: string, operator: FilterOperator, value?: unknown): FilterNode =>
  filterNodeSchema.parse({
    kind: "condition",
    property: propertyId,
    operator,
    ...(value === undefined ? {} : { value }),
  });

describe("rollups", () => {
  it("rolls up through a backlink and leaves out what does not apply", () => {
    expect(derivedValue("a", "items")).toBeCloseTo(66.667, 2);
    expect(derivedValue("b", "items")).toBe(0);
    expect(derivedValue("c", "items")).toBeNull();
    expect(derivedValue("a", "itemCount")).toBe(4);
    expect(derivedValue("c", "itemCount")).toBe(0);
  });

  it("rolls up through a relation of the record", () => {
    expect(derivedValue("a", "siteCountry")).toEqual(["Finland"]);
    expect(derivedValue("b", "siteCountry")).toBeNull();
  });

  it("applies every function, and keeps an unknown value unknown", () => {
    const values: PropertyValue[] = [3, null, 7, [5], "2026-01-02", "2025-12-31T23:00:00.000Z", true, false, true];
    expect(applyRollup("count", values, 9)).toBe(9);
    expect(applyRollup("countValues", values, 9)).toBe(8);
    expect(applyRollup("sum", values, 9)).toBe(15);
    expect(applyRollup("average", values, 9)).toBe(5);
    expect(applyRollup("min", values, 9)).toBe(3);
    expect(applyRollup("max", values, 9)).toBe(7);
    expect(applyRollup("percentChecked", values, 9)).toBeCloseTo(66.667, 2);
    expect(applyRollup("earliest", values, 9)).toBe("2025-12-31T23:00:00.000Z");
    expect(applyRollup("latest", values, 9)).toBe("2026-01-02");
    expect(applyRollup("latest", [{ start: "2026-01-01", end: "2026-03-01" }], 1)).toBe("2026-03-01");
    expect(applyRollup("showValues", ["a", null, "b"], 3)).toEqual(["a", "b"]);
    for (const fn of ["sum", "average", "min", "max", "percentChecked", "earliest", "latest", "showValues"] as const) {
      expect(applyRollup(fn, [null, null], 2)).toBeNull();
    }
    expect(applyRollup("countValues", [], 0)).toBe(0);
  });
});

describe("formulas over records", () => {
  it("computes remaining participants, completion and days to the due date", () => {
    expect(derivedValue("a", "remaining")).toBe(15);
    expect(derivedValue("a", "progress")).toBe(63);
    expect(derivedValue("a", "daysLeft")).toBe(10);
    expect(derivedValue("b", "daysLeft")).toBe(-6);
  });

  it("shows an error in the cell of the record where a formula fails, and nowhere else", () => {
    expect(derivedValue("b", "progress")).toBe(0);
    expect(errorOf("b", "ratio")).toBe("Division by zero.");
    expect(errorOf("a", "ratio")).toBeUndefined();
    expect(errorOf("a", "remaining")).toBeUndefined();
  });

  it("leaves a formula over an empty value empty, with no error", () => {
    expect(errorOf("d", "remaining")).toBeUndefined();
    expect(derivedValue("d", "remaining")).toBeNull();
  });

  it("reports a formula that refers to itself and one that does not parse", () => {
    expect(errorOf("a", "loopA")).toMatch(/refers to itself|has an error/);
    expect(errorOf("a", "loopB")).toMatch(/refers to itself|has an error/);
    expect(errorOf("a", "broken")).toBe("The formula ends too early.");
  });

  it("gives the time of creation", () => {
    expect(derivedValue("c", "created")).toBe("2026-11-10T10:00:00.000Z");
  });

  it("derives nothing for a collection without computed properties", () => {
    expect(deriveRecords(SITES, CONTEXT)[0]?.errors).toEqual({});
  });
});

describe("filters", () => {
  it("matches texts with every operator, ignoring case and accents", () => {
    expect(ids(where("title", "contains", "aland"))).toEqual(["a"]);
    expect(ids(where("title", "notContains", "Synthetic"))).toEqual([]);
    expect(ids(where("title", "equals", "synthetic laboratory cork"))).toEqual(["c"]);
    expect(ids(where("title", "notEquals", "Synthetic Laboratory Cork"))).toEqual(["a", "b", "d"]);
    expect(ids(where("title", "startsWith", "synthetic laboratory b"))).toEqual(["b"]);
    expect(ids(where("title", "endsWith", "dee"))).toEqual(["d"]);
    expect(ids(where("website", "isEmpty"))).toEqual(["b", "c", "d"]);
    expect(ids(where("website", "isNotEmpty"))).toEqual(["a"]);
  });

  it("matches numbers, and never an unknown number", () => {
    expect(ids(where("target", "greaterThan", 25))).toEqual(["a", "b"]);
    expect(ids(where("target", "greaterThanOrEqual", 30))).toEqual(["a", "b"]);
    expect(ids(where("target", "lessThan", 30))).toEqual(["c"]);
    expect(ids(where("target", "lessThanOrEqual", "30"))).toEqual(["b", "c"]);
    expect(ids(where("target", "equals", 20))).toEqual(["c"]);
    expect(ids(where("target", "notEquals", 20))).toEqual(["a", "b", "d"]);
    expect(ids(where("target", "isEmpty"))).toEqual(["d"]);
    expect(ids(where("target", "greaterThan", "many"))).toEqual([]);
  });

  it("matches checkboxes", () => {
    expect(ids(where("ready", "isChecked"))).toEqual(["a"]);
    expect(ids(where("ready", "isNotChecked"))).toEqual(["b", "c", "d"]);
  });

  it("matches statuses and selects by option, and lists by element", () => {
    expect(ids(where("status", "equals", "active"))).toEqual(["a"]);
    expect(ids(where("status", "notEquals", "active"))).toEqual(["b", "c", "d"]);
    expect(ids(where("status", "isAnyOf", ["planned", "closed"]))).toEqual(["b", "c"]);
    expect(ids(where("status", "isNoneOf", ["planned", "closed"]))).toEqual(["a", "d"]);
    expect(ids(where("tags", "contains", "pilot"))).toEqual(["a"]);
    expect(ids(where("tags", "notContains", "pilot"))).toEqual(["b", "c", "d"]);
    expect(ids(where("tags", "isAnyOf", ["eeg"]))).toEqual(["a", "b"]);
    expect(ids(where("owner", "contains", "uid-blake"))).toEqual(["b"]);
    expect(ids(where("site", "contains", "sites__s1"))).toEqual(["a"]);
    expect(ids(where("site", "isEmpty"))).toEqual(["b", "c", "d"]);
  });

  it("matches dates, ranges and relative dates", () => {
    expect(ids(where("due", "before", { relative: "today" }))).toEqual(["b"]);
    expect(ids(where("due", "after", { date: "2026-12-01" }))).toEqual(["c"]);
    expect(ids(where("due", "on", { daysFromToday: 10 }))).toEqual(["a"]);
    expect(ids(where("due", "onOrBefore", { date: "2026-11-21" }))).toEqual(["a", "b"]);
    expect(ids(where("due", "onOrAfter", { relative: "tomorrow" }))).toEqual(["a", "c"]);
    expect(ids(where("due", "within", { window: "nextMonth" }))).toEqual(["a"]);
    expect(ids(where("due", "within", { window: "pastWeek" }))).toEqual(["b"]);
    expect(ids(where("window", "on", { relative: "today" }))).toEqual(["a"]);
    expect(ids(where("window", "after", { date: "2026-11-29" }))).toEqual(["a"]);
    expect(ids(where("due", "isEmpty"))).toEqual(["d"]);
    expect(ids(where("created", "within", { window: "pastWeek" }))).toEqual(["c", "d"]);
    expect(ids(where("due", "on", "not a date"))).toEqual([]);
  });

  it("filters on computed values", () => {
    expect(ids(where("remaining", "greaterThan", 10))).toEqual(["a", "b", "c"]);
    expect(ids(where("items", "lessThan", 50))).toEqual(["b"]);
    expect(ids(where("daysLeft", "lessThan", 0))).toEqual(["b"]);
  });

  it("joins conditions with and, or and not, at any depth", () => {
    const tree = filterNodeSchema.parse({
      kind: "or",
      children: [
        { kind: "and", children: [where("status", "equals", "active"), where("ready", "isChecked")] },
        {
          kind: "not",
          child: { kind: "or", children: [where("target", "isNotEmpty"), where("recruited", "isEmpty")] },
        },
      ],
    });
    expect(ids(tree)).toEqual(["a", "d"]);
    expect(ids({ kind: "and", children: [] })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ kind: "or", children: [] })).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves out a condition on a property that no longer exists", () => {
    expect(ids(where("removed", "equals", "x"))).toEqual(["a", "b", "c", "d"]);
  });

  it("refuses a tree that nests too deeply or holds too many parts", () => {
    let deep: unknown = { kind: "condition", property: "title", operator: "isEmpty" };
    for (let level = 0; level < 7; level += 1) deep = { kind: "not", child: deep };
    expect(filterNodeSchema.safeParse(deep).success).toBe(false);
    const wide = {
      kind: "and",
      children: Array.from({ length: 61 }, () => ({ kind: "condition", property: "title", operator: "isEmpty" })),
    };
    expect(filterNodeSchema.safeParse(wide).success).toBe(false);
  });

  it("offers the operators that suit each type, with the operand each needs", () => {
    expect(operatorsFor("checkbox")).toEqual(["isChecked", "isNotChecked"]);
    expect(operatorsFor("number")).toContain("greaterThan");
    expect(operatorsFor("date")).toContain("within");
    expect(operatorsFor("multiSelect")).toContain("isAnyOf");
    expect(operatorsFor("text")).toContain("startsWith");
    expect(operatorsFor("file")).toEqual(["contains", "notContains", "isEmpty", "isNotEmpty"]);
    expect(operandKind("isEmpty")).toBe("none");
    expect(operandKind("within")).toBe("window");
    expect(operandKind("onOrAfter")).toBe("date");
    expect(operandKind("isNoneOf")).toBe("list");
    expect(operandKind("lessThan")).toBe("number");
    expect(operandKind("contains")).toBe("text");
  });

  it("resolves relative dates and windows", () => {
    expect(resolveFilterDate({ relative: "yesterday" }, "2026-03-01")).toBe("2026-02-28");
    expect(resolveFilterDate({ daysFromToday: -365 }, "2026-11-11")).toBe("2025-11-11");
    expect(windowDays("pastMonth", "2026-03-31")).toEqual(["2026-02-28", "2026-03-31"]);
    expect(windowDays("nextYear", "2024-02-29")).toEqual(["2024-02-29", "2025-02-28"]);
    expect(windowDays("pastYear", "2026-11-11")[0]).toBe("2025-11-11");
    expect(windowDays("nextWeek", "2026-11-11")[1]).toBe("2026-11-18");
  });
});

describe("sorting", () => {
  const sorted = (sorts: { property: string; direction: "ascending" | "descending" }[]) =>
    sortRecords(derived, sorts, BY_ID, CONTEXT).map((candidate) => candidate.id);

  it("sorts by status in the order of the options, empty last in both directions", () => {
    expect(sorted([{ property: "status", direction: "ascending" }])).toEqual(["b", "a", "c", "d"]);
    expect(sorted([{ property: "status", direction: "descending" }])).toEqual(["c", "a", "b", "d"]);
  });

  it("sorts by several keys in turn", () => {
    expect(
      sorted([
        { property: "recruited", direction: "ascending" },
        { property: "target", direction: "descending" },
      ]),
    ).toEqual(["b", "c", "d", "a"]);
  });

  it("sorts dates, texts naturally, checkboxes and computed values", () => {
    expect(sorted([{ property: "due", direction: "descending" }])).toEqual(["c", "a", "b", "d"]);
    expect(sorted([{ property: "title", direction: "descending" }])).toEqual(["d", "c", "b", "a"]);
    expect(sorted([{ property: "ready", direction: "descending" }])).toEqual(["a", "b", "c", "d"]);
    expect(sorted([{ property: "remaining", direction: "ascending" }])).toEqual(["a", "c", "b", "d"]);
    expect(sorted([{ property: "owner", direction: "ascending" }])).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the order it was given where no sort applies", () => {
    expect(sorted([])).toEqual(["a", "b", "c", "d"]);
    expect(sorted([{ property: "removed", direction: "ascending" }])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("grouping", () => {
  it("groups by status in option order, with the empty group last and folded groups marked", () => {
    const groups = groupRecords(derived, { property: "status", collapsed: ["closed"] }, STATUS, CONTEXT);
    expect(
      groups.map((group) => [group.key, group.label, group.records.map((candidate) => candidate.id), group.collapsed]),
    ).toEqual([
      ["planned", "Planned", ["b"], false],
      ["active", "Active", ["a"], false],
      ["closed", "Closed", ["c"], true],
      ["", "No status", ["d"], false],
    ]);
  });

  it("lists every option for a board, even those without records", () => {
    const groups = groupRecords(derived.slice(0, 1), { property: "status", collapsed: [] }, STATUS, CONTEXT, true);
    expect(groups.map((group) => group.key)).toEqual(["planned", "active", "closed", ""]);
  });

  it("puts a record with several values into the group of each", () => {
    const groups = groupRecords(derived, { property: "tags", collapsed: [], hideEmpty: true }, TAGS, CONTEXT);
    expect(groups.map((group) => [group.key, group.records.map((candidate) => candidate.id)])).toEqual([
      ["eeg", ["a", "b"]],
      ["pilot", ["a"]],
      ["", ["c", "d"]],
    ]);
  });

  it("groups dates by day, week, month or year", () => {
    const due = BY_ID.get("due") as ViewProperty;
    const labels = (granularity: "day" | "week" | "month" | "year") =>
      groupRecords(derived, { property: "due", collapsed: [], granularity }, due, CONTEXT).map((group) => group.label);
    expect(labels("month")).toEqual(["November 2026", "February 2027", "No due"]);
    expect(labels("year")).toEqual(["2026", "2027", "No due"]);
    expect(labels("day")[0]).toBe("5 November 2026");
    expect(labels("week")[0]).toBe("Week of 2 November 2026");
  });

  it("groups checkboxes, people, relations and numbers", () => {
    const ticked = groupRecords(
      derived,
      { property: "ready", collapsed: [] },
      BY_ID.get("ready") as ViewProperty,
      CONTEXT,
    );
    expect(ticked.map((group) => [group.label, group.records.length])).toEqual([
      ["Ticked", 1],
      ["Not ticked", 3],
    ]);
    const owners = groupRecords(
      derived,
      { property: "owner", collapsed: [] },
      BY_ID.get("owner") as ViewProperty,
      CONTEXT,
    );
    expect(owners.map((group) => group.label)).toEqual(["Alex Example", "Blake Example", "No owner"]);
    const sites = groupRecords(
      derived,
      { property: "site", collapsed: [] },
      BY_ID.get("site") as ViewProperty,
      CONTEXT,
    );
    expect(sites.map((group) => group.label)).toEqual(["Site one", "No site"]);
    const targets = groupRecords(
      derived,
      { property: "target", collapsed: [] },
      BY_ID.get("target") as ViewProperty,
      CONTEXT,
    );
    expect(targets.map((group) => group.key)).toEqual(["20", "30", "40", ""]);
  });
});

describe("the whole view", () => {
  it("scopes, searches, filters, sorts and groups", () => {
    const config = viewConfigSchema.parse({
      search: "laboratory",
      filter: { kind: "condition", property: "target", operator: "isNotEmpty" },
      sorts: [{ property: "target", direction: "ascending" }],
      group: { property: "status", collapsed: [] },
    });
    const result = computeView(LABS, config, null, CONTEXT);
    expect(result.total).toBe(4);
    expect(result.records.map((candidate) => candidate.id)).toEqual(["c", "b", "a"]);
    expect(result.groups?.map((group) => group.key)).toEqual(["planned", "active", "closed"]);
  });

  it("applies a fixed scope before anything else", () => {
    const result = computeView(LABS, {}, { property: "site", value: "sites__s1" }, CONTEXT);
    expect(result.total).toBe(1);
    expect(withinScope(RECORDS[1] as ViewRecord, { property: "status", value: "planned" })).toBe(true);
    expect(withinScope(RECORDS[0] as ViewRecord, { property: "owner", value: "uid-alex" })).toBe(true);
    expect(withinScope(RECORDS[3] as ViewRecord, { property: "status", value: "planned" })).toBe(false);
  });

  it("searches every word across the shown properties", () => {
    expect(recordMatchesSearch(derived[0] as ViewRecord, PROPERTIES, "alex aland", CONTEXT)).toBe(true);
    expect(recordMatchesSearch(derived[0] as ViewRecord, PROPERTIES, "alex berlin", CONTEXT)).toBe(false);
    expect(recordMatchesSearch(derived[0] as ViewRecord, PROPERTIES, "   ", CONTEXT)).toBe(true);
  });

  it("orders and hides properties, and always shows the title", () => {
    const config = { order: ["status", "missing", "title"], hidden: ["title", "tags"] };
    expect(
      orderedProperties(PROPERTIES, config)
        .slice(0, 3)
        .map((candidate) => candidate.id),
    ).toEqual(["status", "title", "tags"]);
    const shown = visibleProperties(LABS, config).map((candidate) => candidate.id);
    expect(shown.slice(0, 2)).toEqual(["status", "title"]);
    expect(shown).not.toContain("tags");
  });

  it("keeps an unknown grouping property from grouping at all", () => {
    expect(computeView(LABS, { group: { property: "removed", collapsed: [] } }, null, CONTEXT).groups).toBeNull();
  });
});

describe("aggregates", () => {
  it("counts and sums, and leaves an unknown sum unknown", () => {
    expect(aggregate(RECORDS, { kind: "count" }, PROPERTIES)).toBe(4);
    expect(aggregate(RECORDS, { kind: "sum", property: "target" }, PROPERTIES)).toBe(90);
    expect(aggregate(RECORDS.slice(3), { kind: "sum", property: "target" }, PROPERTIES)).toBeNull();
    expect(aggregate(RECORDS, { kind: "rollup", property: "recruited", function: "average" }, PROPERTIES)).toBeCloseTo(
      9.25,
    );
    expect(aggregate(RECORDS, { kind: "rollup", property: "due", function: "earliest" }, PROPERTIES)).toBeNull();
  });

  it("groups a count or a sum for a chart, with every option of a status", () => {
    expect(groupedAggregate(RECORDS, STATUS, { kind: "sum", property: "target" }, PROPERTIES, CONTEXT)).toEqual([
      { key: "planned", label: "Planned", value: 30, count: 1 },
      { key: "active", label: "Active", value: 40, count: 1 },
      { key: "closed", label: "Closed", value: 20, count: 1 },
      { key: "", label: "No status", value: null, count: 1 },
    ]);
  });
});
