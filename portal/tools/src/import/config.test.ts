// Unit tests of the reader of the private import configuration. The identifiers, the addresses
// (on example.org) and the key in these files are invented.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ToolRefusal } from "../environment";
import { externalIdentifiers, loadPrivateConfig, namesSourceDocument, PORTAL_DIRECTORY } from "./config";

const directory = mkdtempSync(path.join(tmpdir(), "eegml-import-config-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function written(name: string, content: unknown): string {
  const file = path.join(directory, name);
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const HASH_KEY = "an-invented-hash-key-of-at-least-32-bytes";

describe("loadPrivateConfig", () => {
  it("reads the hash key and the location of each source", () => {
    const file = written("valid.json", {
      hashKey: HASH_KEY,
      sources: {
        b: { externalId: "invented-file-identifier", exportUrl: "https://sheets.example.org/export?format=xlsx" },
      },
    });
    expect(loadPrivateConfig(file)).toEqual({
      hashKey: HASH_KEY,
      sources: {
        b: { externalId: "invented-file-identifier", exportUrl: "https://sheets.example.org/export?format=xlsx" },
      },
      // Nothing is rehearsed unless the file says so.
      rehearse: [],
    });
    expect(loadPrivateConfig(written("no-sources.json", { hashKey: HASH_KEY })).sources).toEqual({});
  });

  it("reads the registry of contributor sheets, each with its replication and the decisions about its columns", () => {
    const sheet = {
      externalId: "an-invented-identifier-of-a-sheet",
      replicationId: "AlphaBeta2001",
      exportUrl: "https://sheets.example.org/invented/export?format=xlsx",
      columnOverrides: [
        { header: "", position: 1, field: "orderInPublication" },
        { header: "Funding 2", field: "orcid" },
      ],
    };
    const file = written("sheets.json", { hashKey: HASH_KEY, contributorSheets: { "alpha-beta": sheet } });
    expect(loadPrivateConfig(file).contributorSheets).toEqual({ "alpha-beta": sheet });
    // A file without the registry has none. No sheet is registered by default.
    expect(loadPrivateConfig(written("none.json", { hashKey: HASH_KEY })).contributorSheets).toBeUndefined();
    const refused = [
      // A sheet names its replication: nothing inside a sheet does.
      { "alpha-beta": { externalId: sheet.externalId } },
      { "alpha-beta": { ...sheet, replicationId: "not a study identifier" } },
      // An override maps a column to one of the two fields that need a decision, and to nothing else.
      { "alpha-beta": { ...sheet, columnOverrides: [{ header: "Notes", field: "email" }] } },
      { "a name with spaces": sheet },
    ];
    for (const [index, contributorSheets] of refused.entries()) {
      expect(
        () => loadPrivateConfig(written(`refused-${index}.json`, { hashKey: HASH_KEY, contributorSheets })),
        String(index),
      ).toThrow(ToolRefusal);
    }
  });

  it("reads what the environment rehearses, the baseline of rows and the confirmed headers of a source", () => {
    const file = written("rehearsal.json", {
      hashKey: HASH_KEY,
      rehearse: ["candidateStudies", "contributorLists"],
      expectedStudies: 4,
      sources: {
        g: {
          baseline: { list_members: { data: 7, header: 1, filler: 2 } },
          confirmedHeaders: { study_description: ["StudyID", "Description"] },
        },
      },
      contributorSheets: {
        "alpha-beta": {
          externalId: "an-invented-identifier-of-a-sheet",
          replicationId: "AlphaBeta2001",
          baseline: { Sheet1: { data: 5 } },
        },
      },
    });
    const config = loadPrivateConfig(file);
    expect(config.rehearse).toEqual(["candidateStudies", "contributorLists"]);
    expect(config.expectedStudies).toBe(4);
    expect(config.sources.g).toEqual({
      baseline: { list_members: { data: 7, header: 1, filler: 2 } },
      confirmedHeaders: { study_description: ["StudyID", "Description"] },
    });
    expect(config.contributorSheets?.["alpha-beta"]?.baseline).toEqual({ Sheet1: { data: 5 } });
    // An output that the plan does not withhold cannot be named, and a class of rows that does not exist neither.
    expect(() =>
      loadPrivateConfig(written("unknown-output.json", { hashKey: HASH_KEY, rehearse: ["everything"] })),
    ).toThrow(ToolRefusal);
    expect(() =>
      loadPrivateConfig(
        written("unknown-class.json", { hashKey: HASH_KEY, sources: { g: { baseline: { t: { rows: 1 } } } } }),
      ),
    ).toThrow(ToolRefusal);
  });

  it("finds the identifier of a source document in a file name, and nothing shorter than an identifier", () => {
    const config = loadPrivateConfig(
      written("identifiers.json", {
        hashKey: HASH_KEY,
        sources: { b: { externalId: "an-invented-identifier-of-b" }, c: { externalId: "short" } },
        contributorSheets: {
          "alpha-beta": { externalId: "an-invented-identifier-of-a-sheet", replicationId: "AlphaBeta2001" },
        },
      }),
    );
    expect(externalIdentifiers(config).sort()).toEqual([
      "an-invented-identifier-of-a-sheet",
      "an-invented-identifier-of-b",
    ]);
    expect(namesSourceDocument("an-invented-identifier-of-b - Sheet1.xlsx", config)).toBe(true);
    expect(namesSourceDocument("export of an-invented-identifier-of-a-sheet.xlsx", config)).toBe(true);
    expect(namesSourceDocument("b.xlsx", config)).toBe(false);
    expect(namesSourceDocument("a short name.xlsx", config)).toBe(false);
  });

  it("refuses a missing file and says what to do, without creating it", () => {
    expect(() => loadPrivateConfig(path.join(directory, "absent.json"))).toThrow(ToolRefusal);
    expect(() => loadPrivateConfig(path.join(directory, "absent.json"))).toThrow(/sources\.example\.json/);
  });

  it("refuses a hash key that is too short to protect the hashes of personal values", () => {
    expect(() => loadPrivateConfig(written("short.json", { hashKey: "too-short" }))).toThrow(/hashKey/);
  });

  it("refuses a file of another shape, and never quotes a value of the file in its refusal", () => {
    const secretLooking = "an-invented-value-that-must-not-be-printed";
    const cases = [
      written("broken.json", `{ "hashKey": "${secretLooking}`),
      written("unknown-key.json", { hashKey: HASH_KEY, token: secretLooking }),
      written("bad-url.json", { hashKey: HASH_KEY, sources: { b: { exportUrl: `ftp://${secretLooking}` } } }),
      written("bad-source-key.json", { hashKey: HASH_KEY, sources: { B: { externalId: secretLooking } } }),
    ];
    for (const file of cases) {
      let message = "";
      try {
        loadPrivateConfig(file);
      } catch (error) {
        expect(error).toBeInstanceOf(ToolRefusal);
        message = (error as Error).message;
      }
      expect(message, file).not.toBe("");
      expect(message).not.toContain(secretLooking);
    }
  });

  it("is documented by an example file that has the format and holds placeholders only", () => {
    const example = path.join(PORTAL_DIRECTORY, "tools", "sources.example.json");
    const config = loadPrivateConfig(example);
    expect(Object.keys(config.sources)).toEqual(expect.arrayContaining(["b", "c", "d", "e", "f"]));
    expect(readFileSync(example, "utf8")).toMatch(/REPLACE/);
    const sheets = Object.values(config.contributorSheets ?? {});
    expect(sheets.length).toBeGreaterThan(0);
    for (const source of [...Object.values(config.sources), ...sheets]) {
      for (const address of [source.url, source.exportUrl]) {
        if (address !== undefined) expect(new URL(address).hostname).toBe("sheets.example.org");
      }
    }
  });
});
