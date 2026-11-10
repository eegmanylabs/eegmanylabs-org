// Rules about what may be committed to this public repository.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { allSourcePaths, PORTAL_ROOT, sourceFiles } from "./support";

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

  it("names no Firebase project other than the demonstration project", () => {
    const firebaserc = sourceFiles().find((file) => file.path === ".firebaserc");
    expect(JSON.parse(firebaserc?.text ?? "{}")).toEqual({ projects: { default: "demo-eegml" } });
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
