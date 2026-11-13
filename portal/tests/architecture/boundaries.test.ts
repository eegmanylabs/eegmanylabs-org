// The layering of the portal, checked by reading every import.
import { describe, expect, it } from "vitest";
import { importsOf, isCode, sourceFiles } from "./support";

const isFirebaseSdk = (specifier: string) => /^(firebase|@firebase)(\/|$)/.test(specifier);
const isFirebaseServerSdk = (specifier: string) => /^firebase-(admin|functions)(\/|$)/.test(specifier);

function offenders(directory: string, allowed: (path: string) => boolean, banned: (specifier: string) => boolean) {
  return sourceFiles(directory)
    .filter(isCode)
    .filter((file) => !allowed(file.path))
    .flatMap((file) =>
      importsOf(file)
        .filter(banned)
        .map((specifier) => `${file.path} imports ${specifier}`),
    );
}

describe("the import scanner", () => {
  it("sees static, type-only, side-effect, re-export, dynamic and require imports", () => {
    const text = [
      'import { a } from "firebase/app";',
      'import type { B } from "firebase/auth";',
      'import "firebase/firestore";',
      'export { c } from "firebase/functions";',
      'const d = await import("firebase/storage");',
      'const e = require("@firebase/util");',
      "import {\n  f,\n  g,\n} from 'firebase/app-check';",
    ].join("\n");
    expect(importsOf({ path: "example.ts", text }).sort()).toEqual(
      [
        "@firebase/util",
        "firebase/app",
        "firebase/app-check",
        "firebase/auth",
        "firebase/firestore",
        "firebase/functions",
        "firebase/storage",
      ].sort(),
    );
  });
});

describe("the web application", () => {
  it("imports the Firebase SDK only inside web/src/data", () => {
    expect(offenders("web/src", (path) => path.startsWith("web/src/data/"), isFirebaseSdk)).toEqual([]);
  });

  it("has a data layer that does import the Firebase SDK, so the check above is not empty", () => {
    const inside = sourceFiles("web/src/data").flatMap((file) => importsOf(file).filter(isFirebaseSdk));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("reaches the data layer through its index, never through one of its files", () => {
    const deepImport = (specifier: string) => /^@\/data\/.+/.test(specifier) || /(^|\/)data\/[^/]+$/.test(specifier);
    const collaboration = (specifier: string) => specifier === "@/data/collaboration";
    expect(
      offenders(
        "web/src",
        (path) => path.startsWith("web/src/data/"),
        (specifier) => deepImport(specifier) && !collaboration(specifier),
      ),
    ).toEqual([]);
  });

  it("opens the collaboration door of the data layer to the editor alone, which loads on demand", () => {
    expect(
      offenders(
        "web/src",
        (path) => path.startsWith("web/src/data/") || path.startsWith("web/src/editor/"),
        (specifier) => specifier === "@/data/collaboration",
      ),
    ).toEqual([]);
    const editorFiles = sourceFiles("web/src/editor").filter((file) =>
      importsOf(file).includes("@/data/collaboration"),
    );
    expect(editorFiles.length).toBeGreaterThan(0);
  });

  it("never imports server-side packages or the other workspaces' source", () => {
    const banned = (specifier: string) =>
      isFirebaseServerSdk(specifier) || /^@eegml\/(functions|tools)/.test(specifier) || /^node:/.test(specifier);
    expect(offenders("web/src", () => false, banned)).toEqual([]);
  });
});

describe("the shared package", () => {
  const isHashLibrary = (specifier: string) => /^@noble\/hashes\//.test(specifier);

  it("imports nothing but zod, the hash library and its own files", () => {
    const banned = (specifier: string) =>
      !specifier.startsWith(".") && specifier !== "zod" && specifier !== "vitest" && !isHashLibrary(specifier);
    expect(offenders("shared/src", () => false, banned)).toEqual([]);
  });

  it("uses the hash library in one file only, where every identifier is derived", () => {
    const users = sourceFiles()
      .filter(isCode)
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith("@noble/")))
      .map((file) => file.path);
    expect(users).toEqual(["shared/src/ids.ts"]);
  });

  it("names the hash library as a dependency at one exact version", () => {
    const manifest = sourceFiles("shared").find((file) => file.path === "shared/package.json");
    const dependencies = (JSON.parse(manifest?.text ?? "{}") as { dependencies?: Record<string, string> }).dependencies;
    expect(dependencies?.["@noble/hashes"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("zod", () => {
  it("is imported directly in one file only, which switches it to the mode the security policy needs", () => {
    const direct = sourceFiles()
      .filter(isCode)
      .filter((file) => importsOf(file).some((specifier) => specifier === "zod" || specifier.startsWith("zod/")))
      .map((file) => file.path);
    expect(direct).toEqual(["shared/src/zod.ts"]);
  });
});

describe("the functions and the tools", () => {
  it.each(["functions/src", "tools/src"])("%s never imports the web SDK or the web application", (directory) => {
    const banned = (specifier: string) =>
      isFirebaseSdk(specifier) || /^@eegml\/web/.test(specifier) || /^react/.test(specifier);
    expect(offenders(directory, () => false, banned)).toEqual([]);
  });

  it("declare every callable through defineCallable, so none can skip validation or the region", () => {
    const direct = sourceFiles("functions/src")
      .filter(isCode)
      .filter((file) => file.path !== "functions/src/framework/callable.ts" && !file.path.endsWith(".test.ts"))
      .filter((file) => /\bonCall\s*[(<]/.test(file.text))
      .map((file) => file.path);
    expect(direct).toEqual([]);
  });
});
