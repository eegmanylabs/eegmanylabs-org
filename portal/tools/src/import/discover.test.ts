// Unit tests of the discovery of importers and of the committed source definitions. Nothing
// here is private: a source is named by its letter and its title.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourceAuthoritySchema, sourceKindSchema, sourceSyncPolicySchema } from "@eegml/shared";
import { afterAll, describe, expect, it } from "vitest";
import { discoverImporters, SOURCES_DIRECTORY } from "./discover";
import { SOURCE_DEFINITIONS, SOURCE_FAMILIES, sourceDefinition, sourceFamily } from "./registry";

const directory = mkdtempSync(path.join(tmpdir(), "eegml-import-discover-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("discoverImporters", () => {
  it("finds every importer of the sources directory by convention, in the order of their sources", async () => {
    const importers = await discoverImporters();
    const found = importers.map((importer) => [importer.sourceKey, importer.key]);
    // Every importer that exists is found. Adding one adds its module and edits no list of the framework.
    expect(found).toEqual(
      expect.arrayContaining([
        ["b", "namingConventions"],
        ["c", "communityVocabulary"],
        ["d", "listOfStudies"],
        ["e", "predictionMarket"],
        ["f", "recruitmentContacts"],
        ["h", "websiteData"],
      ]),
    );
    const keys = found.map(([sourceKey]) => sourceKey ?? "");
    expect(keys).toEqual([...new Set(keys)].sort());
    expect(SOURCES_DIRECTORY.endsWith(path.join("import", "sources"))).toBe(true);
    for (const importer of importers) {
      expect(importer.summary.length).toBeGreaterThan(10);
      expect(importer.inputDescription.length).toBeGreaterThan(10);
    }
  });

  it("stops on a module of the directory that exports no importer, so that a misplaced file is noticed", async () => {
    writeFileSync(path.join(directory, "not-an-importer.ts"), "export const somethingElse = 1;\n");
    await expect(discoverImporters(directory)).rejects.toThrow(/sources\/not-an-importer\.ts exports no importer/);
  });
});

describe("the source definitions of the repository", () => {
  it("name each source by letter and title, with values that the data model knows", () => {
    expect(SOURCE_DEFINITIONS.map((definition) => definition.key)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
    ]);
    for (const definition of SOURCE_DEFINITIONS) {
      expect(definition.letter).toBe(definition.key.toUpperCase());
      expect(sourceKindSchema.safeParse(definition.kind).success).toBe(true);
      expect(sourceAuthoritySchema.safeParse(definition.authority).success).toBe(true);
      expect(sourceSyncPolicySchema.safeParse(definition.syncPolicy).success).toBe(true);
      // An address or a file identifier never appears in a definition.
      expect(JSON.stringify(definition)).not.toMatch(/https?:|docs\.google|[0-9A-Za-z_-]{30,}/);
    }
    expect(sourceDefinition("H")).toBe(sourceDefinition("h"));
    expect(sourceDefinition("z")).toBeUndefined();
  });

  it("hold an entry for the source of every importer, which names its source in its own module", async () => {
    for (const importer of await discoverImporters()) {
      // An importer that serves a family of sources names the family, and is bound to one member by `select`.
      const entry =
        importer.select === undefined ? sourceDefinition(importer.sourceKey) : sourceFamily(importer.sourceKey);
      expect(entry, importer.key).toBeDefined();
    }
  });

  it("name each family of sources whose members only the private configuration can list", () => {
    expect(SOURCE_FAMILIES.map((family) => [family.key, family.selectedBy])).toEqual([["ctable", "--sheet"]]);
    for (const family of SOURCE_FAMILIES) {
      // A family is no source: no entry of the registry has its key.
      expect(sourceDefinition(family.key)).toBeUndefined();
      expect(sourceKindSchema.safeParse(family.kind).success).toBe(true);
      expect(JSON.stringify(family)).not.toMatch(/https?:|docs\.google|[0-9A-Za-z_-]{30,}/);
    }
    expect(sourceFamily("CTABLE")).toBe(sourceFamily("ctable"));
  });

  it("mark the two sources that could not be opened as built against synthetic fixtures only", () => {
    const marked = SOURCE_DEFINITIONS.filter((definition) => definition.notes !== undefined);
    expect(marked.map((definition) => definition.key)).toEqual(["a", "g"]);
    for (const definition of marked) expect(definition.notes).toMatch(/synthetic fixtures only.*layout is unverified/);
  });
});
