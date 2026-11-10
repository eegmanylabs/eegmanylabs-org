// Unit tests of the ownership of fields: what an import may set, and what it leaves alone.
// The documents are invented.
import { COLLECTIONS, type CollectionEntry } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import type { PlannedDocument } from "./model";
import { carriesProvenance, mergeDocument, newDocument } from "./ownership";

const entry = COLLECTIONS.replications as CollectionEntry;
const context = {
  ownRecordIds: new Set(["h-1", "h-2"]),
  created: { createdBy: "system:import", updatedBy: "system:import" },
  updated: { updatedBy: "system:import" },
};

function planned(owned: Record<string, unknown>, extra: Partial<PlannedDocument> = {}): PlannedDocument {
  return {
    collection: "replications",
    ids: ["AlphaBeta2001"],
    path: "replications/AlphaBeta2001",
    fixed: { studyKey: "AlphaBeta2001", custom: {} },
    owned,
    silent: [],
    union: {},
    sourceRecordIds: ["h-1"],
    fieldSources: Object.fromEntries(Object.keys(owned).map((field) => [field, "h-1"])),
    ...extra,
  };
}

describe("newDocument", () => {
  it("records for each owned field the value that was imported and the source record that supplied it", () => {
    const created = newDocument(planned({ theme: "Attention", signupUrl: undefined }), entry, context);
    expect(created).toMatchObject({
      studyKey: "AlphaBeta2001",
      theme: "Attention",
      sourceRecordIds: ["h-1"],
      importedValues: { theme: "Attention" },
      fieldSources: { theme: "h-1" },
      createdBy: "system:import",
    });
    expect(created).not.toHaveProperty("signupUrl");
  });

  it("writes no provenance to a collection whose documents carry none", () => {
    const index = COLLECTIONS.studyAliasIndex as CollectionEntry;
    expect(carriesProvenance(index)).toBe(false);
    const created = newDocument(
      { ...planned({}), collection: "studyAliasIndex", union: { replicationIds: ["AlphaBeta2001"] }, fixed: {} },
      index,
      context,
    );
    expect(created).toMatchObject({ replicationIds: ["AlphaBeta2001"] });
    expect(created).not.toHaveProperty("sourceRecordIds");
  });
});

describe("mergeDocument", () => {
  const stored = newDocument(planned({ theme: "Attention", psychConstruct: "attention" }), entry, context);

  it("writes nothing when the source says what the document holds", () => {
    expect(mergeDocument(planned({ theme: "Attention", psychConstruct: "attention" }), entry, stored, context)).toEqual(
      {
        data: null,
        changedFields: [],
        conflicts: [],
      },
    );
  });

  it("lets a field follow the source while it still holds what the source wrote last time", () => {
    const result = mergeDocument(planned({ theme: "Memory", psychConstruct: "attention" }), entry, stored, context);
    expect(result.changedFields).toEqual(["theme"]);
    expect(result.conflicts).toEqual([]);
    expect(result.data).toMatchObject({
      theme: "Memory",
      importedValues: { theme: "Memory", psychConstruct: "attention" },
    });
  });

  it("fills a field that is empty, and removes a field that the source no longer states", () => {
    const filled = mergeDocument(
      planned({ theme: "Attention", psychConstruct: "attention", outcome: "N2" }),
      entry,
      stored,
      context,
    );
    expect(filled.changedFields).toEqual(["outcome"]);
    expect(filled.data).toMatchObject({ outcome: "N2", fieldSources: { outcome: "h-1" } });
    const emptied = mergeDocument(planned({ theme: "Attention", psychConstruct: undefined }), entry, stored, context);
    expect(emptied.changedFields).toEqual(["psychConstruct"]);
    expect(emptied.data).not.toHaveProperty("psychConstruct");
    expect(emptied.data?.importedValues).toEqual({ theme: "Attention" });
  });

  it("never overwrites a field that was edited in the portal, and reports both values", () => {
    const edited = { ...stored, theme: "Edited by a person" };
    const result = mergeDocument(planned({ theme: "Memory", psychConstruct: "attention" }), entry, edited, context);
    expect(result.changedFields).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        field: "theme",
        liveState: "differs",
        liveValue: "Edited by a person",
        liveOrigin: "portal",
        sourceValue: "Memory",
        sourceRecordId: "h-1",
      },
    ]);
    // The live value stays, and the new source value is recorded beside it.
    expect(result.data).toMatchObject({ theme: "Edited by a person", importedValues: { theme: "Memory" } });
  });

  it("writes nothing on a repeated import of a field that was edited, and still reports the conflict", () => {
    const edited = { ...stored, theme: "Edited by a person" };
    const result = mergeDocument(planned({ theme: "Attention", psychConstruct: "attention" }), entry, edited, context);
    expect(result.data).toBeNull();
    expect(result.conflicts).toHaveLength(1);
  });

  it("reports no conflict for an edited field that an importer declares silent, or that equals the source again", () => {
    const edited = { ...stored, theme: "Edited by a person" };
    const silent = mergeDocument(planned({ theme: "Memory" }, { silent: ["theme"] }), entry, edited, context);
    expect(silent.conflicts).toEqual([]);
    expect(silent.data).toMatchObject({ theme: "Edited by a person" });
    const converged = mergeDocument(planned({ theme: "Edited by a person" }), entry, edited, context);
    expect(converged.conflicts).toEqual([]);
    expect(converged.changedFields).toEqual([]);
    expect(converged.data).toMatchObject({ importedValues: { theme: "Edited by a person" } });
  });

  it("leaves a field alone that another source supplied, and names that source's record", () => {
    const fromD = {
      ...stored,
      theme: "Conflict",
      fieldSources: { theme: "d-9", psychConstruct: "h-1" },
      importedValues: { theme: "Conflict", psychConstruct: "attention" },
    };
    const result = mergeDocument(planned({ theme: "Memory", psychConstruct: "attention" }), entry, fromD, context);
    expect(result.conflicts).toEqual([
      {
        field: "theme",
        liveState: "differs",
        liveValue: "Conflict",
        liveOrigin: "otherSource",
        liveSourceRecordId: "d-9",
        sourceValue: "Memory",
        sourceRecordId: "h-1",
      },
    ]);
    expect(result.data).toBeNull();
  });

  it("leaves a field cleared that a person has cleared in the portal, and reports the source value beside it", () => {
    // The import had set the theme. A person removed it: the field is absent and the record of the import remains.
    const { theme: _cleared, ...cleared } = stored;
    const plan = planned({ theme: "Attention", psychConstruct: "attention" });
    const result = mergeDocument(plan, entry, cleared, context);
    expect(result.changedFields).toEqual([]);
    expect(result.data).toBeNull();
    expect(result.conflicts).toEqual([
      {
        field: "theme",
        liveState: "cleared",
        liveValue: undefined,
        liveOrigin: "portal",
        sourceValue: "Attention",
        sourceRecordId: "h-1",
      },
    ]);
    // A changed source value is recorded beside the cleared field, which stays cleared on every later run.
    const changed = mergeDocument(planned({ theme: "Memory", psychConstruct: "attention" }), entry, cleared, context);
    expect(changed.changedFields).toEqual([]);
    expect(changed.data).not.toHaveProperty("theme");
    expect(changed.data).toMatchObject({ importedValues: { theme: "Memory" } });
    const again = mergeDocument(
      planned({ theme: "Memory", psychConstruct: "attention" }),
      entry,
      changed.data ?? {},
      context,
    );
    expect(again.data).toBeNull();
    expect(again.conflicts.map((conflict) => conflict.liveState)).toEqual(["cleared"]);
  });

  it("leaves a cleared field alone without a report where the importer declares the field silent", () => {
    const { theme: _cleared, ...cleared } = stored;
    const result = mergeDocument(planned({ theme: "Attention" }, { silent: ["theme"] }), entry, cleared, context);
    expect(result.conflicts).toEqual([]);
    expect(result.data).toBeNull();
  });

  it("leaves a field cleared that another source had supplied, and does not take its place", () => {
    const { theme: _cleared, ...cleared } = {
      ...stored,
      fieldSources: { theme: "d-9", psychConstruct: "h-1" },
      importedValues: { theme: "Conflict", psychConstruct: "attention" },
    };
    const result = mergeDocument(planned({ theme: "Memory", psychConstruct: "attention" }), entry, cleared, context);
    expect(result.data).toBeNull();
    expect(result.conflicts).toMatchObject([{ field: "theme", liveState: "cleared", liveOrigin: "portal" }]);
  });

  it("fills a field again that the source itself had stopped stating", () => {
    const emptied = mergeDocument(planned({ theme: undefined, psychConstruct: "attention" }), entry, stored, context);
    const refilled = mergeDocument(
      planned({ theme: "Attention", psychConstruct: "attention" }),
      entry,
      emptied.data ?? {},
      context,
    );
    expect(refilled.conflicts).toEqual([]);
    expect(refilled.data).toMatchObject({ theme: "Attention" });
  });

  it("treats a value that nobody imported as an edit made in the portal", () => {
    const manual = { studyKey: "AlphaBeta2001", theme: "Typed in the portal" };
    const result = mergeDocument(planned({ theme: "Memory" }), entry, manual, context);
    expect(result.conflicts[0]).toMatchObject({ liveOrigin: "portal", liveValue: "Typed in the portal" });
    expect(result.data).toMatchObject({ theme: "Typed in the portal", sourceRecordIds: ["h-1"] });
  });

  it("never touches a fixed field of a document that exists", () => {
    const changed = { ...stored, custom: { note: "set in the portal" } };
    const result = mergeDocument(planned({ theme: "Attention", psychConstruct: "attention" }), entry, changed, context);
    expect(result.data).toBeNull();
  });

  it("adds missing members to a union field and removes none", () => {
    const index = COLLECTIONS.studyAliasIndex as CollectionEntry;
    const spec = {
      ...planned({}),
      collection: "studyAliasIndex" as const,
      fixed: {},
      union: { replicationIds: ["B", "C"] },
    };
    const result = mergeDocument(spec, index, { replicationIds: ["A", "B"] }, context);
    expect(result.data).toMatchObject({ replicationIds: ["A", "B", "C"] });
    expect(mergeDocument(spec, index, { replicationIds: ["C", "B", "A"] }, context).data).toBeNull();
  });

  it("does not add a member again that a person has removed from a list, and reports it", () => {
    const index = COLLECTIONS.studyAliasIndex as CollectionEntry;
    const spec = {
      ...planned({}),
      collection: "studyAliasIndex" as const,
      fixed: {},
      union: { replicationIds: ["A", "B", "C"] },
    };
    // The change log says that an earlier import had added B, and the list no longer holds it.
    const result = mergeDocument(spec, index, { replicationIds: ["A"] }, context, { replicationIds: ["B"] });
    expect(result.data).toMatchObject({ replicationIds: ["A", "C"] });
    expect(result.conflicts).toEqual([
      {
        field: "replicationIds",
        liveState: "memberRemoved",
        liveValue: undefined,
        liveOrigin: "portal",
        sourceValue: "B",
        sourceRecordId: "h-1",
      },
    ]);
    // Once only the removed member is missing, nothing is written, and the removal is still reported.
    const settled = mergeDocument(spec, index, { replicationIds: ["A", "C"] }, context, { replicationIds: ["B"] });
    expect(settled.data).toBeNull();
    expect(settled.conflicts).toHaveLength(1);
  });

  it("keeps the source records of a document in one order, whatever order the rows were read in", () => {
    const first = newDocument(planned({ theme: "Attention" }, { sourceRecordIds: ["h-2", "h-1"] }), entry, context);
    expect(first.sourceRecordIds).toEqual(["h-1", "h-2"]);
    const withOthers = { ...stored, sourceRecordIds: ["h-1", "d-9"] };
    const merged = mergeDocument(
      planned({ theme: "Attention", psychConstruct: "attention" }, { sourceRecordIds: ["h-2", "h-1"] }),
      entry,
      withOthers,
      context,
    );
    expect(merged.data).toMatchObject({ sourceRecordIds: ["d-9", "h-1", "h-2"] });
  });

  it("replaces an earlier revision of its own source record and keeps the records of other sources", () => {
    const withOthers = { ...stored, sourceRecordIds: ["d-9", "h-1"] };
    const result = mergeDocument(
      planned(
        { theme: "Attention", psychConstruct: "attention" },
        { sourceRecordIds: ["h-2"], fieldSources: { theme: "h-2", psychConstruct: "h-2" } },
      ),
      entry,
      withOthers,
      context,
    );
    expect(result.changedFields).toEqual([]);
    expect(result.data).toMatchObject({
      sourceRecordIds: ["d-9", "h-2"],
      fieldSources: { theme: "h-2", psychConstruct: "h-2" },
    });
  });
});
