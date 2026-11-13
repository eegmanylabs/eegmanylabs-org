// What a decision of the programme seals (docs/MIGRATION_PLAN.md, section 11, questions 7 and
// 14) reaches no derived channel. The rules let programme administrators alone read a sealed
// collection (tests/rules/programme-answers-features.test.ts); this file holds the code that
// derives other documents from stored ones to the same promise: the search index, digests and
// scheduled reports, exports, the publishing allow-list, automations, synchronised sheets,
// generated documents, the view engine and the audit trail never read a sealed collection, and
// the change log of an import shows a marker in place of a sealed document.
import {
  CAPABILITY_DEFINITIONS,
  COLLECTION_ENTRIES,
  COLLECTIONS,
  DEFAULT_ROLE_CAPABILITIES,
  isSealedEntry,
  ROLES,
  SEALED_SOURCE_KEYS,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "./support";

const SEALED = COLLECTION_ENTRIES.filter((entry) => isSealedEntry(entry));

/**
 * The code of each derived channel, by the directory or file that holds it. A sealed collection
 * named anywhere in it would be a way out for what is sealed.
 */
const CHANNELS: Readonly<Record<string, readonly string[]>> = {
  "the search index": ["functions/src/search", "functions/src/triggers/search.ts", "shared/src/search-tokens.ts"],
  "digests and scheduled reports": ["shared/src/digest", "functions/src/reports", "functions/src/notifications"],
  "exports, the subject-access export included": ["shared/src/exports", "functions/src/governance/person-data.ts"],
  "the publishing allow-list": [
    "shared/src/publishing",
    "functions/src/publishing",
    "functions/src/triggers/publishing.ts",
  ],
  automations: ["shared/src/automation", "functions/src/automation", "functions/src/triggers/automations.ts"],
  "synchronised sheets and generated documents": ["shared/src/sync", "shared/src/docs", "functions/src/integrations"],
  "the view engine and its sources": ["shared/src/views", "web/src/views"],
};

const SEALED_NAMES = SEALED.flatMap((entry) => [entry.key, entry.collectionId]);

describe("a sealed collection", () => {
  it("is what the answers seal: the prediction-market data, the summary figures and the raw rows that hold them", () => {
    expect(SEALED.map((entry) => entry.key).sort()).toEqual([
      "historicalAggregates",
      "predictionMarketItems",
      "predictionMarketOutcomes",
      "sourceRecordRawChunks",
      "sourceRecords",
    ]);
    expect([...SEALED_SOURCE_KEYS]).toEqual(["e", "f"]);
  });

  it("is read by programme administrators alone, written by trusted code alone, restricted and never searched", () => {
    for (const entry of SEALED) {
      expect(entry.read.tiers, entry.key).toEqual(["ADMIN"]);
      expect(entry.write.mode, entry.key).toBe("function");
      expect(entry.dataClass, entry.key).toBe("restricted");
      expect(entry.flags.searchable, entry.key).toBe(false);
    }
    expect(CAPABILITY_DEFINITIONS["sealed.read"].level).toBe("administrator");
    for (const role of ROLES) {
      expect(DEFAULT_ROLE_CAPABILITIES[role].includes("sealed.read"), role).toBe(role === "programme_admin");
    }
  });

  it.each(Object.entries(CHANNELS))("is named nowhere in the code of %s", (_channel, roots) => {
    const files = roots.flatMap((root) =>
      root.endsWith(".ts")
        ? sourceFiles(root.split("/").slice(0, -1).join("/")).filter((file) => file.path === root)
        : sourceFiles(root),
    );
    expect(files.length).toBeGreaterThan(0);
    const naming = files.flatMap((file) =>
      SEALED_NAMES.filter(
        (name) =>
          file.text.includes(`COLLECTIONS.${name}`) ||
          file.text.includes(`"${name}"`) ||
          file.text.includes(`'${name}'`) ||
          file.text.includes(`${name}/`),
      ).map((name) => `${file.path}: ${name}`),
    );
    expect(naming).toEqual([]);
  });

  it("keeps its values out of the audit trail, which records the names of changed fields alone for such a document", () => {
    // The audit trigger keeps values only for documents of the classes `member` and `public`.
    const trigger = sourceFiles("functions/src/triggers").find((file) => file.path.endsWith("audit-entry.ts"));
    expect(trigger?.text).toContain('entry.dataClass === "member" || entry.dataClass === "public"');
    for (const entry of SEALED) expect(["member", "public"]).not.toContain(entry.dataClass);
  });

  it("shows a marker in the change log of an import in place of its states", () => {
    const apply = sourceFiles("tools/src/import").find((file) => file.path.endsWith("import/apply.ts"));
    expect(apply?.text).toContain('isSealedEntry(entry) ? "sealed" : null');
    expect(COLLECTIONS.importBatchChangeState.read.tiers).toEqual(["FUNCTION"]);
  });
});
