// portal/firestore.indexes.json, compared with what the catalogue of queries and the collection
// registry call for. The emulator does not enforce indexes, so this is the only test that
// notices a query whose index was never declared, or an index that no query needs any more.
import { readFileSync } from "node:fs";
import path from "node:path";
import { COLLECTION_ENTRIES, type z } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import {
  collectionGroupOverridesFor,
  compositeIndexesFor,
  exemptionsFor,
  expectedIndexFile,
  type IndexFile,
} from "../rules/indexes";
import { QUERY_CATALOGUE } from "../rules/queries";
import { PORTAL_ROOT } from "./support";

const declared = JSON.parse(readFileSync(path.join(PORTAL_ROOT, "firestore.indexes.json"), "utf8")) as IndexFile;

describe("firestore.indexes.json", () => {
  it("declares exactly the indexes that the catalogued queries and the registry call for", () => {
    expect(declared).toEqual(expectedIndexFile(QUERY_CATALOGUE));
  });

  it("holds one array field at most in each composite index", () => {
    for (const index of declared.indexes) {
      expect(index.fields.filter((field) => "arrayConfig" in field).length, JSON.stringify(index)).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("names only collections and fields that exist", () => {
    const fieldsOf = new Map<string, Set<string>>();
    for (const entry of COLLECTION_ENTRIES) {
      const fields = fieldsOf.get(entry.collectionId) ?? new Set<string>();
      for (const field of Object.keys(entry.schema.shape as Record<string, z.ZodType>)) fields.add(field);
      fieldsOf.set(entry.collectionId, fields);
    }
    const named = [
      ...declared.indexes.flatMap((index) =>
        index.fields.map((field) => [index.collectionGroup, field.fieldPath] as const),
      ),
      ...declared.fieldOverrides.map((override) => [override.collectionGroup, override.fieldPath] as const),
    ];
    const unknown = named.filter(([collectionId, field]) => fieldsOf.get(collectionId)?.has(field) !== true);
    expect(unknown).toEqual([]);
  });

  it("never exempts a field that a query needs", () => {
    const exempt = new Set(exemptionsFor().map((override) => `${override.collectionGroup} ${override.fieldPath}`));
    const queried = [
      ...compositeIndexesFor(QUERY_CATALOGUE).flatMap((index) =>
        index.fields.map((field) => `${index.collectionGroup} ${field.fieldPath}`),
      ),
      ...collectionGroupOverridesFor(QUERY_CATALOGUE).map(
        (override) => `${override.collectionGroup} ${override.fieldPath}`,
      ),
    ];
    expect(queried.filter((field) => exempt.has(field))).toEqual([]);
  });

  it("serves a query across parents on one field with an index for the collection group", () => {
    const overrides = collectionGroupOverridesFor(QUERY_CATALOGUE);
    expect(overrides.map((override) => `${override.collectionGroup}.${override.fieldPath}`)).toEqual(
      expect.arrayContaining([
        "checklist.laboratoryId",
        "checklist.scopeKeys",
        "memberships.reviewStatus",
        "changes.sourceRecordIds",
      ]),
    );
    for (const override of overrides) {
      expect(override.indexes.filter((index) => index.queryScope === "COLLECTION_GROUP")).toHaveLength(1);
      expect(override.indexes.filter((index) => index.queryScope === "COLLECTION")).toHaveLength(3);
    }
  });

  it("stays within the number of single-field configurations a database may hold", () => {
    expect(declared.fieldOverrides.length).toBeLessThanOrEqual(200);
  });
});
