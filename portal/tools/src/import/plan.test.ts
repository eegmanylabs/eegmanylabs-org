// Unit tests of the plan builder. The documents are invented.
import { describe, expect, it } from "vitest";
import { PlanBuilder, PlanError } from "./plan";
import { itemBuilders } from "./reconcile";

const items = itemBuilders("a-synthetic-secret-for-tests-of-32-bytes-or-more");

describe("PlanBuilder", () => {
  it("joins what several rows state about one document", () => {
    const builder = new PlanBuilder();
    const path = builder.document({
      collection: "studyAliasIndex",
      ids: ["alph"],
      union: { replicationIds: ["AlphaBeta2001"] },
      sourceRecordIds: ["r-1"],
    });
    builder.document({
      collection: "studyAliasIndex",
      ids: ["alph"],
      union: { replicationIds: ["AlphaGamma2002", "AlphaBeta2001"] },
      sourceRecordIds: ["r-2"],
    });
    const plan = builder.build();
    expect(path).toBe("studyAliasIndex/alph");
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0]).toMatchObject({
      path: "studyAliasIndex/alph",
      union: { replicationIds: ["AlphaBeta2001", "AlphaGamma2002"] },
      sourceRecordIds: ["r-1", "r-2"],
    });
  });

  it("names the first source record as the supplier of each owned field, unless the importer names another", () => {
    const builder = new PlanBuilder();
    builder.document({
      collection: "replications",
      ids: ["Delta1999"],
      owned: { theme: "Memory", originalDoi: "10.1000/invented" },
      sourceRecordIds: ["r-1", "r-2"],
      fieldSources: { originalDoi: "r-2" },
    });
    expect(builder.build().documents[0]?.fieldSources).toEqual({ theme: "r-1", originalDoi: "r-2" });
  });

  it("refuses two different values for one field of one document, which is a defect of the importer", () => {
    const builder = new PlanBuilder();
    builder.document({
      collection: "replications",
      ids: ["Delta1999"],
      owned: { theme: "Memory" },
      sourceRecordIds: ["r-1"],
    });
    expect(() =>
      builder.document({
        collection: "replications",
        ids: ["Delta1999"],
        owned: { theme: "Attention" },
        sourceRecordIds: ["r-2"],
      }),
    ).toThrow(PlanError);
    expect(() => builder.document({ collection: "replications", ids: ["Delta1999"], sourceRecordIds: [] })).toThrow(
      PlanError,
    );
  });

  it("raises an item once however often it is stated, and marks the item of a failed check as blocking", () => {
    const builder = new PlanBuilder();
    const item = items.unparsedValue({
      subject: "h/replications/delta1999",
      field: "Doi",
      claims: [{ source: "h", value: "x" }],
    });
    builder.item(item);
    builder.item(item);
    builder.block("header", "A header is missing.", items.structureChange({ subject: "b/t0/header", claims: [] }));
    builder.rawOnly("r-9", "erasedPerson");
    const plan = builder.build();
    expect(plan.items.map((entry) => [entry.kind, entry.blocking]).sort()).toEqual([
      ["structureChange", true],
      ["unparsedValue", false],
    ]);
    expect(plan.blocking).toEqual([{ check: "header", message: "A header is missing." }]);
    expect([...plan.rawOnly]).toEqual([["r-9", "erasedPerson"]]);
  });

  it("orders documents and items so that the same statements always give the same plan", () => {
    const state = (order: readonly string[]) => {
      const builder = new PlanBuilder();
      for (const id of order)
        builder.document({
          collection: "studyAliasIndex",
          ids: [id],
          union: { replicationIds: ["X"] },
          sourceRecordIds: ["r"],
        });
      return builder.build().documents.map((document) => document.path);
    };
    expect(state(["b", "a", "c"])).toEqual(state(["c", "b", "a"]));
  });
});
