// Rules of the visual system and of interface copy that can be checked by reading the source.
import { describe, expect, it } from "vitest";
import { isTest, type SourceFile, sourceFiles } from "./support";

const TOKENS_FILE = "web/src/styles/tokens.css";

const web = sourceFiles("web/src").filter((file) => !isTest(file));

function matches(files: readonly SourceFile[], pattern: RegExp): string[] {
  return files.flatMap((file) => [...file.text.matchAll(pattern)].map((match) => `${file.path}: ${match[0].trim()}`));
}

describe("the visual system", () => {
  it("uses no shadow of any kind", () => {
    // Tailwind's ring utilities are box shadows too, so focus is drawn with outlines.
    const utilities =
      /(?<![\w-])(?:shadow|drop-shadow|inset-shadow|text-shadow|ring|inset-ring)(?:-[\w[\]/.#()%-]+)?(?=[\s"'`:])/g;
    const classStrings = web.filter((file) => file.path.endsWith(".tsx") || file.path.endsWith(".ts"));
    const inClassNames = classStrings.flatMap((file) =>
      [...file.text.matchAll(/["'`]([^"'`\n]*)["'`]/g)].flatMap((literal) =>
        [...(literal[1] ?? "").matchAll(utilities)].map((match) => `${file.path}: ${match[0]}`),
      ),
    );
    expect(inClassNames).toEqual([]);

    const declarations = matches(
      web.filter((file) => file.path.endsWith(".css")),
      /(?:box-shadow|text-shadow|drop-shadow)\s*[:(][^;]*/g,
    );
    expect(declarations).toEqual([]);
  });

  it("removes Tailwind's shadow and default colour utilities in the token file", () => {
    const tokens = web.find((file) => file.path === TOKENS_FILE)?.text ?? "";
    for (const reset of [
      "--shadow-*: initial",
      "--inset-shadow-*: initial",
      "--drop-shadow-*: initial",
      "--color-*: initial",
    ]) {
      expect(tokens).toContain(reset);
    }
  });

  it("uses no green", () => {
    expect(matches(web, /\b(?:green|emerald|lime|teal)\b/gi)).toEqual([]);
  });

  it("takes every colour from the token file", () => {
    // The application's source, the page template and the files that are published as they are.
    const everywhere = [
      ...web,
      ...sourceFiles("web/public"),
      ...sourceFiles("web").filter((file) => file.path === "web/index.html"),
    ];
    expect(everywhere.map((file) => file.path)).toEqual(
      expect.arrayContaining(["web/index.html", "web/public/frame-guard.js", TOKENS_FILE]),
    );
    const elsewhere = everywhere.filter((file) => file.path !== TOKENS_FILE);
    // A raw colour value: hexadecimal, or a colour function.
    expect(matches(elsewhere, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/g)).toEqual([]);
  });

  it("sets all text in DM Sans, the one typeface of the portal (decision D-018)", () => {
    const manifest = JSON.parse(sourceFiles("web").find((file) => file.path === "web/package.json")?.text ?? "{}");
    const fontPackages = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@fontsource"));
    expect(fontPackages).toEqual(["@fontsource-variable/dm-sans"]);

    const styles = web.filter((file) => file.path.endsWith(".css"));
    expect(matches(styles, /@import\s+["']@fontsource[^"']*["']/g)).toEqual([
      'web/src/styles/app.css: @import "@fontsource-variable/dm-sans/opsz.css"',
    ]);
    // No second family, and no utility or token that would select one.
    expect(matches(web, /\bfraunces\b|\bfont-serif\b|--(?:font-)?serif\b|\bGeorgia\b/gi)).toEqual([]);
  });

  it("loads fonts from the installed packages, never from a font service or a content delivery network", () => {
    const everywhere = sourceFiles("web").filter((file) => !isTest(file) && !file.path.startsWith("web/config/"));
    expect(matches(everywhere, /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com/g)).toEqual(
      [],
    );
  });
});

describe("interface copy and documentation", () => {
  const written = sourceFiles().filter(
    (file) => !file.path.startsWith("tests/architecture/") && /\.(tsx?|md|html|css|mjs|rules|yml)$/.test(file.path),
  );

  it("contains no em dash", () => {
    expect(written.filter((file) => file.text.includes("—")).map((file) => file.path)).toEqual([]);
  });

  it("uses UK spelling for the words the portal uses most", () => {
    const american = /\b(?:authoriz|organiz|normaliz|initializ|recogniz|behavior|color|center|catalog(?!ue))\w*/g;
    // Documentation prose only. Lines that quote code keep the spelling of the APIs they name.
    const prose = written.filter((file) => file.path.endsWith(".md"));
    const inCode = (line: string) => line.includes("`") || line.trimStart().startsWith("|") || line.includes("http");
    const found = prose.flatMap((file) =>
      file.text
        .split("\n")
        .filter((line) => !inCode(line))
        .flatMap((line) => [...line.matchAll(american)].map((match) => `${file.path}: ${match[0]}`)),
    );
    expect(found).toEqual([]);
  });
});
