// What the command palette finds. Every item is synthetic.
import { describe, expect, it } from "vitest";
import { matchScore, type PaletteItem, searchPalette } from "./palette-search";

const ITEMS: readonly PaletteItem[] = [
  { id: "recent:1", kind: "recent", label: "ExampleBeta2005", keywords: [] },
  { id: "recent:2", kind: "recent", label: "Ada Example", keywords: [] },
  { id: "action:star", kind: "action", label: "Star ExampleAlpha2001", keywords: [] },
  { id: "destination:members", kind: "destination", label: "Members", keywords: [] },
  { id: "destination:replications", kind: "destination", label: "Replications", keywords: [] },
  {
    id: "replication:alpha",
    kind: "replication",
    label: "ExampleAlpha2001",
    detail: "An invented attention study",
    keywords: ["Exmpl_Alpha", "Example, A."],
  },
  { id: "replication:beta", kind: "replication", label: "ExampleBeta2005", keywords: ["Placeholder, B."] },
  { id: "member:ada", kind: "member", label: "Ada Example", detail: "Northfield Example University", keywords: [] },
  { id: "member:zoe", kind: "member", label: "Zoë Ångström", detail: "Harbour Example Institute", keywords: [] },
  { id: "laboratory:a", kind: "laboratory", label: "Example Attention Laboratory", keywords: [] },
];

const found = (query: string) =>
  searchPalette(ITEMS, query).map((group) => [group.kind, group.items.map((item) => item.id)] as const);

describe("searchPalette", () => {
  it("offers the recent items in their order, the actions and the destinations before anything is typed", () => {
    expect(found("")).toEqual([
      ["recent", ["recent:1", "recent:2"]],
      ["action", ["action:star"]],
      ["destination", ["destination:members", "destination:replications"]],
    ]);
  });

  it("groups records by kind and ranks a label that starts with the query first", () => {
    expect(found("example")).toEqual([
      ["action", ["action:star"]],
      ["replication", ["replication:alpha", "replication:beta"]],
      ["member", ["member:ada", "member:zoe"]],
      ["laboratory", ["laboratory:a"]],
    ]);
    expect(found("ada")).toEqual([["member", ["member:ada"]]]);
  });

  it("finds a replication by another spelling, its title or its authors, and a member by affiliation", () => {
    expect(found("exmpl_alpha")).toEqual([["replication", ["replication:alpha"]]]);
    expect(found("invented attention")).toEqual([["replication", ["replication:alpha"]]]);
    expect(found("placeholder")).toEqual([["replication", ["replication:beta"]]]);
    expect(found("harbour")).toEqual([["member", ["member:zoe"]]]);
    expect(found("zoe angstrom")).toEqual([["member", ["member:zoe"]]]);
  });

  it("finds actions and destinations by name, and nothing for a query that matches nothing", () => {
    expect(found("star")).toEqual([["action", ["action:star"]]]);
    expect(found("members")).toEqual([["destination", ["destination:members"]]]);
    expect(found("no such thing")).toEqual([]);
  });

  it("limits each group", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `member:${index}`,
      kind: "member" as const,
      label: `Synthetic Person ${index}`,
      keywords: [],
    }));
    expect(searchPalette(many, "synthetic", 5)[0]?.items).toHaveLength(5);
  });
});

describe("matchScore", () => {
  it("scores a label that starts with the query above one that contains it, above any other match", () => {
    const item = { id: "x", kind: "member" as const, label: "Ada Example", detail: "Northfield", keywords: ["Alias"] };
    expect(matchScore(item, "ada")).toBe(3);
    expect(matchScore(item, "alias")).toBe(3);
    expect(matchScore(item, "example")).toBe(2);
    expect(matchScore(item, "northfield")).toBe(1);
    expect(matchScore(item, "southfield")).toBe(0);
  });
});
