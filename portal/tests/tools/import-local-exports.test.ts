// The sources that arrive as exported files which an administrator supplies (docs/DECISIONS.md,
// answers of 13 November 2026, decision 7): the coordination workbook (A), the membership
// workbook (G) and the Quire data. Each importer reads a local file that lies outside the
// repository, refuses one inside it before anything is read or written, and neither prints what
// it reads nor writes it into the repository.
// Every file here is synthetic: invented people and studies on the example.org domain, in a
// temporary directory of the test.
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { coordinationWorkbook } from "../../tools/src/import/fixtures/coordination-workbook";
import { membershipWorkbook } from "../../tools/src/import/fixtures/membership-workbook";
import { QUIRE_USERS, quireDump } from "../../tools/src/import/fixtures/quire";
import {
  committableAt,
  liesWithin,
  repositoryDirectory,
  requireOutsideRepository,
} from "../../tools/src/import/local-export";
import type { ImporterDefinition } from "../../tools/src/import/model";
import { importer as coordination } from "../../tools/src/import/sources/coordination-workbook";
import { importer as membership } from "../../tools/src/import/sources/membership-workbook";
import { importer as quire } from "../../tools/src/import/sources/quire";
import { PORTAL_ROOT } from "../support/emulators";
import { importCli } from "./cli-support";
import {
  documentsOf,
  freshDatabase,
  OBSERVED_ON,
  removeTemporaryDirectories,
  run,
  TEST_HASH_KEY,
  temporaryDirectory,
} from "./import-support";

beforeEach(freshDatabase);
afterAll(removeTemporaryDirectories);

const REPOSITORY = repositoryDirectory();
/** A directory inside the repository that git ignores, where an operator might be tempted to put an export. */
const INSIDE = path.join(PORTAL_ROOT, ".private", "local-export-test");

interface LocalSource {
  readonly importer: ImporterDefinition;
  readonly fileName: string;
  readonly contents: () => Promise<Uint8Array | string>;
  /** Values of the synthetic file that no output may show. */
  readonly secrets: readonly string[];
}

const SOURCES: Readonly<Record<string, LocalSource>> = {
  a: {
    importer: coordination,
    fileName: "a.xlsx",
    contents: () => coordinationWorkbook(),
    secrets: ["Hal Nobody", "hal.nobody@example.org", "Ida Specimen", "an invented note"],
  },
  g: {
    importer: membership,
    fileName: "g.xlsx",
    contents: () => membershipWorkbook(),
    secrets: ["@example.org", "synthetic gender term", "synthetic ethnicity term"],
  },
  i: {
    importer: quire,
    fileName: "quire.json",
    contents: async () => JSON.stringify(quireDump()),
    secrets: QUIRE_USERS.flatMap((user) => [user.name, ...(user.email === undefined ? [] : [user.email])]),
  },
};

async function writeSource(directory: string, source: LocalSource): Promise<string> {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, source.fileName);
  writeFileSync(file, await source.contents());
  return file;
}

describe("the place of a local export", () => {
  it("is the repository of the portal, found by its git entry", () => {
    expect(existsSync(path.join(REPOSITORY, ".git"))).toBe(true);
    expect(liesWithin(PORTAL_ROOT, REPOSITORY)).toBe(true);
    expect(liesWithin(temporaryDirectory(), REPOSITORY)).toBe(false);
  });

  it("is refused inside the repository, also through a path that climbs back into it", () => {
    expect(() => requireOutsideRepository("a", path.join(REPOSITORY, "a.xlsx"))).toThrow(/inside the repository/);
    expect(() => requireOutsideRepository("a", path.join(REPOSITORY, "portal", "..", "data", "a.xlsx"))).toThrow(
      /inside the repository/,
    );
    expect(() => requireOutsideRepository("a", path.join(temporaryDirectory(), "a.xlsx"))).not.toThrow();
  });
});

/**
 * A git work tree of its own outside the portal, such as another clone or the repository the portal
 * moves to (decision 6): the smallest `.git` directory that git recognises, written by hand so that
 * the test runs no git command that changes anything.
 */
function foreignWorkTree(ignored: readonly string[] = []): string {
  const root = temporaryDirectory();
  mkdirSync(path.join(root, ".git", "objects"), { recursive: true });
  mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(root, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n");
  if (ignored.length > 0) writeFileSync(path.join(root, ".gitignore"), `${ignored.join("\n")}\n`);
  return root;
}

describe("a local export in another git work tree", () => {
  it("is refused where git would commit it or the report beside it, and accepted where git ignores both", () => {
    const tracked = path.join(foreignWorkTree(), "exports", "g.xlsx");
    expect(liesWithin(tracked, REPOSITORY)).toBe(false);
    expect(committableAt(tracked)).toBe(true);
    expect(() => requireOutsideRepository("g", tracked)).toThrow(/git work tree/);
    // The export alone is ignored, and the report written beside it would not be: still refused.
    const halfIgnored = path.join(foreignWorkTree(["*.xlsx"]), "g.xlsx");
    expect(committableAt(halfIgnored)).toBe(false);
    expect(() => requireOutsideRepository("g", halfIgnored)).toThrow(/git work tree/);
    const ignored = path.join(foreignWorkTree(["exports/"]), "exports", "g.xlsx");
    expect(() => requireOutsideRepository("g", ignored)).not.toThrow();
    // A directory that no work tree holds is accepted, as before.
    expect(() => requireOutsideRepository("g", path.join(temporaryDirectory(), "g.xlsx"))).not.toThrow();
  });
});

describe.each(Object.entries(SOURCES))("the importer of source %s", (key, source) => {
  it("declares that its input is an exported file supplied by an administrator", () => {
    expect(source.importer.localExport).toBe(true);
    expect(source.importer.sourceKey).toBe(key);
  });

  it("reads a synthetic export from a directory outside the repository and prints nothing of it", async () => {
    const outside = temporaryDirectory();
    const file = await writeSource(outside, source);
    const config = path.join(outside, "sources.json");
    writeFileSync(config, JSON.stringify({ hashKey: TEST_HASH_KEY, sources: {} }));
    const result = importCli([
      "run",
      key,
      "--input",
      file,
      "--mode",
      "preview",
      "--observed-on",
      OBSERVED_ON,
      "--config",
      config,
    ]);
    // The order of the sources may refuse the run, or the preview may stop on the structure. It is never refused
    // for the place of the file, and what the file holds reaches no output.
    expect(result.output).not.toContain("inside the repository");
    for (const secret of source.secrets) expect(result.output, secret).not.toContain(secret);
    // Whatever the importer writes beside its input stays beside it, outside the repository.
    for (const name of readdirSync(outside)) expect(liesWithin(path.join(outside, name), REPOSITORY)).toBe(false);
  });

  it("refuses an export inside the repository before it reads or writes anything", async () => {
    const file = await writeSource(INSIDE, source);
    try {
      await expect(run(source.importer, file, "preview")).rejects.toThrow(/inside the repository/);
      expect((await documentsOf("importBatches")).size).toBe(0);
      expect((await documentsOf("sourceRecords")).size).toBe(0);
      const config = path.join(temporaryDirectory(), "sources.json");
      writeFileSync(config, JSON.stringify({ hashKey: TEST_HASH_KEY, sources: {} }));
      const refused = importCli([
        "run",
        key,
        "--input",
        file,
        "--mode",
        "preview",
        "--observed-on",
        OBSERVED_ON,
        "--config",
        config,
      ]);
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain(`Refusing to read source ${key}: its export lies inside the repository`);
      for (const secret of source.secrets) expect(refused.output, secret).not.toContain(secret);
      // Nothing was written beside the input: no report and no record of the run.
      expect(readdirSync(INSIDE)).toEqual([source.fileName]);
    } finally {
      rmSync(INSIDE, { recursive: true, force: true });
    }
  });

  it("refuses a link outside the repository that leads to a file inside it", async () => {
    const inside = await writeSource(INSIDE, source);
    const link = path.join(temporaryDirectory(), source.fileName);
    symlinkSync(inside, link);
    try {
      await expect(run(source.importer, link, "preview")).rejects.toThrow(/inside the repository/);
      expect((await documentsOf("importBatches")).size).toBe(0);
    } finally {
      rmSync(INSIDE, { recursive: true, force: true });
    }
  });
});
