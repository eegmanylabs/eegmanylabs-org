// Values of properties, the core sources and the layout of dashboards. Every name, address and
// study here is synthetic, on the example.org domain.
import { describe, expect, it } from "vitest";
import {
  compactLayout,
  dashboardWidgetInputSchema,
  moveWidget,
  nextPlacement,
  placeWidget,
  resizeWidget,
} from "./dashboard";
import { type ViewProperty, viewConfigSchema } from "./model";
import { CORE_SOURCES, coreCollection, databaseCollection, type SourceLookups, sentenceLabel } from "./sources";
import {
  addMonths,
  checkPropertyValue,
  displayText,
  type EngineContext,
  foldText,
  formatDate,
  utcDayOf,
} from "./values";

const property = (type: ViewProperty["type"], config: ViewProperty["config"] = {}): ViewProperty => ({
  id: "p",
  name: "Value",
  type,
  config,
  source: "row",
});

const CONTEXT: EngineContext = {
  today: "2026-11-11",
  now: new Date("2026-11-11T12:00:00Z"),
  dayOf: utcDayOf,
  personName: (uid) => (uid === "uid-alex" ? "Alex Example" : null),
  collections: new Map(),
};

describe("checking a value before it is stored", () => {
  it("accepts each type in its stored form and clears with null", () => {
    expect(checkPropertyValue(property("text"), "x")).toEqual({ ok: true, value: "x" });
    expect(checkPropertyValue(property("text"), "")).toEqual({ ok: true, value: null });
    expect(checkPropertyValue(property("number"), 4.5)).toEqual({ ok: true, value: 4.5 });
    expect(checkPropertyValue(property("checkbox"), false)).toEqual({ ok: true, value: false });
    expect(checkPropertyValue(property("email"), "someone@example.org")).toEqual({
      ok: true,
      value: "someone@example.org",
    });
    expect(checkPropertyValue(property("url"), "https://example.org/x")).toEqual({
      ok: true,
      value: "https://example.org/x",
    });
    expect(checkPropertyValue(property("date"), "2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
    expect(checkPropertyValue(property("date"), "2026-11-11T10:00:00+01:00")).toEqual({
      ok: true,
      value: "2026-11-11T09:00:00.000Z",
    });
    expect(checkPropertyValue(property("dateRange"), { start: "2026-01-01", end: "2026-02-01" })).toEqual({
      ok: true,
      value: { start: "2026-01-01", end: "2026-02-01" },
    });
    expect(checkPropertyValue(property("dateRange"), { start: null, end: null })).toEqual({ ok: true, value: null });
    const options = {
      options: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    };
    expect(checkPropertyValue(property("select", options), "a")).toEqual({ ok: true, value: "a" });
    expect(checkPropertyValue(property("multiSelect", options), ["a", "b", "a"])).toEqual({
      ok: true,
      value: ["a", "b"],
    });
    expect(checkPropertyValue(property("person"), ["uid-alex"])).toEqual({ ok: true, value: ["uid-alex"] });
    expect(
      checkPropertyValue(property("relation"), [
        { entityType: "replication", entityId: "SyntheticStudy2001" },
        { entityType: "replication", entityId: "SyntheticStudy2001" },
      ]),
    ).toEqual({ ok: true, value: [{ entityType: "replication", entityId: "SyntheticStudy2001" }] });
    expect(checkPropertyValue(property("file"), [{ name: "Protocol", url: "https://example.org/p.pdf" }])).toEqual({
      ok: true,
      value: [{ name: "Protocol", url: "https://example.org/p.pdf" }],
    });
    expect(checkPropertyValue(property("number"), null)).toEqual({ ok: true, value: null });
  });

  it("refuses what does not fit, in words", () => {
    const refused = (type: ViewProperty["type"], raw: unknown, config: ViewProperty["config"] = {}) => {
      const result = checkPropertyValue(property(type, config), raw);
      return result.ok ? null : result.error;
    };
    expect(refused("number", "4")).toBe("Value takes a number.");
    expect(refused("number", Number.POSITIVE_INFINITY)).toBe("Value takes a number.");
    expect(refused("checkbox", "yes")).toMatch(/ticked/);
    expect(refused("email", "not an address")).toMatch(/email address/);
    expect(refused("url", "javascript:alert(1)")).toMatch(/web address/);
    expect(refused("date", "2026-02-30")).toMatch(/date such as/);
    expect(refused("dateRange", { start: "2026-02-01", end: "2026-01-01" })).toMatch(/comes before its start/);
    expect(refused("dateRange", { start: "2026-02-01", other: 1 })).toMatch(/start and an end/);
    expect(refused("select", "z", { options: [{ id: "a", name: "A" }] })).toMatch(/no such option/);
    expect(refused("multiSelect", ["a", "z"], { options: [{ id: "a", name: "A" }] })).toMatch(/no such option/);
    expect(refused("person", ["bad/uid"])).toMatch(/list of members/);
    expect(refused("relation", [{ entityType: "spaceship", entityId: "x" }])).toMatch(/links to records/);
    expect(refused("relation", [{ entityType: "replication", entityId: "x", extra: 1 }])).toMatch(/links to records/);
    expect(refused("file", [{ name: "x", url: "ftp://example.org" }])).toMatch(/name and a web address/);
    expect(refused("text", "x".repeat(10_001))).toMatch(/at most/);
    expect(refused("formula", 1)).toMatch(/computed/);
    expect(refused("createdBy", "uid")).toMatch(/computed/);
  });
});

describe("values as text", () => {
  it("writes each type for people to read", () => {
    expect(displayText(property("checkbox"), true, CONTEXT)).toBe("Yes");
    expect(displayText(property("select", { options: [{ id: "a", name: "Alpha" }] }), "a", CONTEXT)).toBe("Alpha");
    expect(displayText(property("person"), ["uid-alex", "uid-unknown"], CONTEXT)).toBe("Alex Example, Unknown member");
    expect(displayText(property("date"), "2026-11-11", CONTEXT)).toBe("11 November 2026");
    expect(displayText(property("dateRange"), { start: "2026-11-01", end: null }, CONTEXT)).toBe(
      "From 1 November 2026",
    );
    expect(displayText(property("dateRange"), { start: null, end: "2026-11-01" }, CONTEXT)).toBe(
      "Until 1 November 2026",
    );
    expect(displayText(property("number", { numberFormat: "percent" }), 62.5, CONTEXT)).toBe("62.5%");
    expect(displayText(property("number", { numberFormat: "integer" }), 1234.4, CONTEXT)).toBe("1,234");
    expect(displayText(property("number", { numberFormat: "decimal" }), 2, CONTEXT)).toBe("2.00");
    expect(displayText(property("file"), [{ name: "Plan", url: "https://example.org" }], CONTEXT)).toBe("Plan");
    expect(displayText(property("relation"), [{ entityType: "laboratory", entityId: "lab-1" }], CONTEXT)).toBe("lab-1");
    expect(displayText(property("formula"), "2026-11-20", CONTEXT)).toBe("20 November 2026");
    expect(displayText(property("rollup"), ["a", "b"], CONTEXT)).toBe("a, b");
    expect(displayText(property("text"), null, CONTEXT)).toBe("");
  });

  it("folds text and moves dates by months", () => {
    expect(foldText("  Ångström  Lab ")).toBe("angstrom lab");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(formatDate("2026-11-11T12:00:00.000Z", CONTEXT)).toBe("11 November 2026");
    expect(formatDate("not a date", CONTEXT)).toBe("not a date");
  });
});

describe("the core sources", () => {
  const lookups: SourceLookups = {
    laboratoryName: (id) => (id === "lab-synthetic-own" ? "Synthetic Laboratory" : null),
    replicationStatuses: [{ key: "planning", label: "Planning" }],
  };

  it("reads a participation with its relations, and labels each key as a sentence", () => {
    const collection = coreCollection(
      CORE_SOURCES["core:participations"],
      [
        {
          id: "SyntheticStudy2001__lab-synthetic-own",
          data: {
            replicationId: "SyntheticStudy2001",
            laboratoryId: "lab-synthetic-own",
            status: "collectionComplete",
            readinessStatus: "approved",
            targetNMain: 30,
            custom: { siteNote: "Pilot first", status: "overwritten" },
            dataOrigin: "demo",
          },
          restricted: { phone: "+44 0000" },
        },
      ],
      {
        siteNote: {
          key: "siteNote",
          name: "Site note",
          type: "text",
          config: {},
          order: "a",
          archivedAt: null,
          audience: "member",
        },
        phone: {
          key: "phone",
          name: "Telephone",
          type: "text",
          config: {},
          order: "b",
          archivedAt: null,
          audience: "restricted",
        },
        status: {
          key: "status",
          name: "Shadow",
          type: "text",
          config: {},
          order: "c",
          archivedAt: null,
          audience: "member",
        },
        gone: {
          key: "gone",
          name: "Gone",
          type: "text",
          config: {},
          order: "d",
          archivedAt: "archived",
          audience: "member",
        },
      },
      lookups,
    );
    const [record] = collection.records;
    expect(record?.values.participation).toBe("SyntheticStudy2001 at Synthetic Laboratory");
    expect(record?.values.replication).toEqual([{ entityType: "replication", entityId: "SyntheticStudy2001" }]);
    expect(record?.values.siteNote).toBe("Pilot first");
    expect(record?.values.phone).toBe("+44 0000");
    // A custom property never takes the place of a core field.
    expect(record?.values.status).toBe("collectionComplete");
    expect(collection.properties.filter((candidate) => candidate.id === "status")).toHaveLength(1);
    expect(collection.properties.map((candidate) => candidate.id)).not.toContain("gone");
    expect(collection.properties.find((candidate) => candidate.id === "phone")?.source).toBe("restricted");
    expect(collection.properties.find((candidate) => candidate.id === "targetNMain")?.source).toBe("coreEditable");
    expect(sentenceLabel("collectionComplete")).toBe("Collection complete");
  });

  it("counts an item of a checklist that does not apply as unknown", () => {
    const items = coreCollection(
      CORE_SOURCES["core:checklistItems"],
      [
        { id: "ethics", data: { participationId: "P1", label: "Ethics", status: "done" } },
        { id: "pilot", data: { participationId: "P1", label: "Pilot", status: "notApplicable" } },
        { id: "training", data: { participationId: "P1", label: "Training", status: "inProgress" } },
      ],
      {},
      lookups,
    );
    expect(items.records.map((record) => record.values.done)).toEqual([true, null, false]);
    expect(items.records[0]?.reference).toEqual({ entityType: "participation", entityId: "P1__ethics" });
  });

  it("reads a database with its title, its properties in order and its rows that are not archived", () => {
    const collection = databaseCollection(
      "db1",
      {
        name: "Sites",
        properties: {
          b: {
            key: "b",
            name: "Second",
            type: "number",
            config: { numberFormat: "plain" },
            order: "b",
            archivedAt: null,
          },
          a: { key: "a", name: "First", type: "text", config: { unknownKey: true }, order: "a", archivedAt: null },
          f: {
            key: "f",
            name: "Formula",
            type: "formula",
            config: { formula: { expression: "1" } },
            order: "c",
            archivedAt: null,
          },
        },
      },
      [
        { id: "r1", data: { title: "Row one", values: { a: "x", b: 2 }, archivedAt: null } },
        { id: "r2", data: { title: "Row two", values: {}, archivedAt: "archived" } },
      ],
    );
    expect(collection.properties.map((candidate) => [candidate.id, candidate.source])).toEqual([
      ["title", "title"],
      ["a", "row"],
      ["b", "row"],
      ["f", "computed"],
    ]);
    expect(collection.properties[1]?.config).toEqual({});
    expect(collection.records).toHaveLength(1);
    expect(collection.records[0]?.values).toEqual({ a: "x", b: 2, title: "Row one" });
    expect(collection.records[0]?.reference).toEqual({ entityType: "databaseRow", entityId: "db1__r1" });
  });

  it("parses a stored view configuration and refuses an unknown key", () => {
    expect(viewConfigSchema.safeParse({ sorts: [{ property: "a", direction: "ascending" }] }).success).toBe(true);
    expect(viewConfigSchema.safeParse({ colour: "green" }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ widths: { a: 20 } }).success).toBe(false);
  });
});

describe("the layout of a dashboard", () => {
  const layout = [
    { id: "a", x: 0, y: 0, w: 6, h: 2 },
    { id: "b", x: 6, y: 0, w: 6, h: 2 },
    { id: "c", x: 0, y: 2, w: 12, h: 3 },
  ];

  it("moves a widget and makes room for it", () => {
    expect(moveWidget(layout, "c", 0, -2)).toEqual([
      { id: "a", x: 0, y: 3, w: 6, h: 2 },
      { id: "b", x: 6, y: 3, w: 6, h: 2 },
      { id: "c", x: 0, y: 0, w: 12, h: 3 },
    ]);
    expect(moveWidget(layout, "a", 3, 0)).toEqual([
      { id: "a", x: 3, y: 0, w: 6, h: 2 },
      { id: "b", x: 6, y: 2, w: 6, h: 2 },
      { id: "c", x: 0, y: 4, w: 12, h: 3 },
    ]);
  });

  it("keeps a widget inside the grid", () => {
    expect(moveWidget(layout, "b", 5, 0).find((placement) => placement.id === "b")?.x).toBe(6);
    expect(moveWidget(layout, "a", -3, -3).find((placement) => placement.id === "a")).toEqual({
      id: "a",
      x: 0,
      y: 0,
      w: 6,
      h: 2,
    });
    expect(resizeWidget(layout, "b", 4, 0).find((placement) => placement.id === "b")?.w).toBe(6);
    expect(resizeWidget(layout, "a", -10, -10).find((placement) => placement.id === "a")).toEqual({
      id: "a",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it("resizes a widget and pushes what it now covers", () => {
    expect(resizeWidget(layout, "a", 0, 2).find((placement) => placement.id === "c")?.y).toBe(4);
  });

  it("closes holes and places a new widget below the others", () => {
    expect(compactLayout([{ id: "x", x: 0, y: 5, w: 2, h: 1 }])).toEqual([{ id: "x", x: 0, y: 0, w: 2, h: 1 }]);
    expect(nextPlacement(layout, "d", 20, 4)).toEqual({ id: "d", x: 0, y: 5, w: 12, h: 4 });
    // A figure, a chart and two narrow notes fill the free places beside one another first.
    const figure = nextPlacement([], "figure", 3, 2);
    const chart = nextPlacement([figure], "chart", 6, 4);
    const note = nextPlacement([figure, chart], "note", 3, 2);
    const second = nextPlacement([figure, chart, note], "second", 3, 2);
    expect([figure, chart, note, second].map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [3, 0],
      [9, 0],
      [0, 2],
    ]);
    expect(placeWidget(layout, "c", 0, 0)[2]).toEqual({ id: "c", x: 0, y: 0, w: 12, h: 3 });
    expect(placeWidget(layout, "missing", 0, 0)).toEqual(layout);
  });

  it("validates the widgets it stores", () => {
    const widget = {
      type: "note",
      config: { title: "Notes", text: "Synthetic note" },
      x: 0,
      y: 0,
      w: 4,
      h: 2,
    };
    expect(dashboardWidgetInputSchema.safeParse(widget).success).toBe(true);
    expect(dashboardWidgetInputSchema.safeParse({ ...widget, x: 10 }).success).toBe(false);
    expect(dashboardWidgetInputSchema.safeParse({ ...widget, type: "embed" }).success).toBe(false);
    expect(
      dashboardWidgetInputSchema.safeParse({
        type: "chart",
        config: {
          title: "By status",
          collectionKey: "core:participations",
          config: {},
          scope: null,
          groupBy: "status",
          measure: { kind: "count" },
        },
        x: 0,
        y: 0,
        w: 6,
        h: 4,
      }).success,
    ).toBe(true);
  });
});
