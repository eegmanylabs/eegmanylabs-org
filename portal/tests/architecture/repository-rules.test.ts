// Rules about what may be committed to this public repository.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allSourcePaths, PORTAL_ROOT, sourceFiles } from "./support";

/**
 * An address of a document on a cloud drive whose identifier has the shape that the host gives
 * a real document: 25 or more letters, digits, hyphens and underscores with at least one digit
 * and one capital. The invented identifiers of the fixtures are lower-case words and stay apart.
 */
const DRIVE_ADDRESS = /https?:\/\/(?:docs|drive)\.google\.com\/[^\s"'`<>)]*/g;
const DRIVE_IDENTIFIER = /(?:\/d\/(?:e\/)?|[?&]id=)([A-Za-z0-9_-]{25,})/;

function namesRealDocument(address: string): boolean {
  const identifier = DRIVE_IDENTIFIER.exec(address)?.[1] ?? "";
  return /\d/.test(identifier) && /[A-Z]/.test(identifier);
}

/** The Markdown documents of docs/, which are public as well. */
function documentationFiles(): { readonly path: string; readonly text: string }[] {
  const directory = path.join(PORTAL_ROOT, "..", "docs");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ path: `docs/${name}`, text: readFileSync(path.join(directory, name), "utf8") }));
}

describe("the public repository", () => {
  it("contains no email address outside the example.org domain", () => {
    const address = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
    const found = sourceFiles().flatMap((file) =>
      [...file.text.matchAll(address)]
        .map((match) => match[0])
        .filter((value) => !value.toLowerCase().endsWith("@example.org"))
        .map((value) => `${file.path}: ${value}`),
    );
    expect(found).toEqual([]);
  });

  it("says in the header of every test and fixture file with an address that the data is synthetic", () => {
    const isTestOrFixture = (path: string) =>
      /\.(test|spec)\.(ts|tsx|mjs)$/.test(path) || /(^|\/)(tests|fixtures|test-support)\//.test(path);
    const silent = sourceFiles()
      .filter((file) => isTestOrFixture(file.path) && !file.path.startsWith("tests/architecture/"))
      .filter((file) => /@example\.org\b/.test(file.text))
      .filter((file) => !/synthetic|fictitious|invented/i.test(file.text.split("\n").slice(0, 12).join("\n")))
      .map((file) => file.path);
    expect(silent).toEqual([]);
  });

  it("contains nothing that looks like a credential", () => {
    const patterns = [
      /AIza[0-9A-Za-z_-]{35}/g, // Google API key
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
      /"private_key"\s*:/g, // service-account key file
      /\b(?:ghp|gho|ghs|github_pat)_[0-9A-Za-z_]{20,}/g,
    ];
    const found = sourceFiles()
      .filter((file) => !file.path.startsWith("tests/architecture/"))
      .flatMap((file) => patterns.flatMap((pattern) => [...file.text.matchAll(pattern)].map(() => file.path)));
    expect(found).toEqual([]);
  });

  it("names no Firebase project other than the demonstration project and placeholders", () => {
    const firebaserc = sourceFiles().find((file) => file.path === ".firebaserc");
    const { projects } = JSON.parse(firebaserc?.text ?? "{}") as { projects: Record<string, string> };
    expect(projects.default).toBe("demo-eegml");
    for (const [alias, project] of Object.entries(projects)) {
      if (alias !== "default") expect(project).toMatch(/PLACEHOLDER/);
    }
  });

  it("holds no spreadsheet or tabular export, whose content would be a source rather than code", () => {
    // Test workbooks are built by code at run time from synthetic fixture builders.
    const exports = allSourcePaths().filter((file) => /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(file));
    expect(exports).toEqual([]);
  });

  it("holds the private import configuration nowhere but in the ignored directory", () => {
    // tools/sources.example.json documents the format and holds no identifier of a source.
    const configurations = allSourcePaths().filter((file) => path.basename(file) === "sources.json");
    expect(configurations).toEqual([]);
  });

  it("names no real document of a cloud drive, in the portal or in docs/", () => {
    // The shape test itself: a built identifier of the real shape is recognised, an invented word is not.
    const shaped = `https://docs.google.com/spreadsheets/d/1${"Ab3".repeat(10)}/edit`;
    expect(namesRealDocument(shaped)).toBe(true);
    expect(namesRealDocument("https://docs.google.com/forms/d/an-invented-form-identifier/edit")).toBe(false);
    const found = [...sourceFiles(), ...documentationFiles()].flatMap((file) =>
      [...file.text.matchAll(DRIVE_ADDRESS)].filter((match) => namesRealDocument(match[0])).map(() => file.path),
    );
    expect(found).toEqual([]);
  });

  it("has no source file that git ignores", () => {
    // The repository's .gitignore is a Python template that ignores directory names such as
    // lib/, build/, dist/ and env/ anywhere in the tree. A source file in such a directory
    // would silently never be committed.
    const paths = allSourcePaths();
    let ignored = "";
    try {
      ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd: PORTAL_ROOT,
        input: paths.join("\n"),
        encoding: "utf8",
      });
    } catch (error) {
      // Exit status 1 means that no path is ignored, which is the result we want.
      if ((error as { status?: number }).status !== 1) throw error;
    }
    expect(ignored.split("\n").filter(Boolean)).toEqual([]);
  });
});
