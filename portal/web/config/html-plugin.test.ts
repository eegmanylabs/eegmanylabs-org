import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { portsFor } from "../../scripts/ports.mjs";
import { resolveBuildConfig } from "./build-config.ts";
import { CHARSET_LIMIT_BYTES, composeIndexHtml, findFontFile, notFoundHtml } from "./html-plugin.ts";
import { readTokens } from "./tokens.ts";

const ports = portsFor(9300);
const indexHtml = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
// What Vite has added to the page by the time the plugin sees it in a build.
const builtHtml = indexHtml
  .replace('<script type="module" src="/src/main.tsx"></script>', "")
  .replace(
    "</head>",
    '  <script type="module" crossorigin src="./assets/index-abc123.js"></script>\n    <link rel="stylesheet" crossorigin href="./assets/index-abc123.css">\n  </head>',
  );

// Invented values in the shape the Firebase console gives. They name no real project.
const realEnvironment = {
  VITE_FIREBASE_API_KEY: "example-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "example-portal.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "example-portal",
  VITE_FIREBASE_STORAGE_BUCKET: "example-portal.firebasestorage.app",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
};

const emulator = resolveBuildConfig("emulator", {}, ports);
const production = resolveBuildConfig("production", realEnvironment, ports);
const building = { building: true, themeColour: "#302a2a" };

/** The elements of the document head, in order, as their opening tags. */
function headElements(html: string): string[] {
  const head = html.slice(html.indexOf("<head>") + "<head>".length, html.indexOf("</head>"));
  return [...head.matchAll(/<(?!\/)[^>]+>/g)].map((match) => match[0]);
}

describe("composeIndexHtml", () => {
  it("keeps the character-set declaration first and puts the policy directly after it", () => {
    const [first, second] = headElements(composeIndexHtml(builtHtml, emulator, building));
    expect(first).toBe('<meta charset="utf-8" />');
    expect(second).toMatch(/^<meta http-equiv="Content-Security-Policy" content="default-src 'none'; /);
  });

  it("puts the policy before everything that loads or runs something", () => {
    const html = composeIndexHtml(builtHtml, production, building);
    const policy = html.indexOf("Content-Security-Policy");
    for (const tag of ["<script", "<link"]) {
      expect(html.indexOf(tag)).toBeGreaterThan(policy);
    }
    // The frame guard runs before the application.
    expect(html.indexOf('src="./frame-guard.js"')).toBeLessThan(html.indexOf('src="./assets/index-abc123.js"'));
  });

  it("ends the character-set declaration inside the first 1024 bytes, however long the policy is", () => {
    const longest = resolveBuildConfig(
      "production",
      {
        ...realEnvironment,
        VITE_FIREBASE_PROJECT_ID: `example-${"x".repeat(200)}`,
        VITE_FIREBASE_AUTH_DOMAIN: `${"y".repeat(200)}.example.org`,
        VITE_ENABLE_GOOGLE_SIGN_IN: "true",
      },
      ports,
    );
    const html = composeIndexHtml(builtHtml, longest, building);
    const end = html.indexOf('<meta charset="utf-8" />') + '<meta charset="utf-8" />'.length;
    expect(Buffer.byteLength(html.slice(0, end), "utf8")).toBeLessThanOrEqual(CHARSET_LIMIT_BYTES);
    expect(html.length).toBeGreaterThan(CHARSET_LIMIT_BYTES);
  });

  it("adds no policy for the development server, which needs inline scripts", () => {
    const html = composeIndexHtml(indexHtml, emulator, { building: false, themeColour: "#302a2a" });
    expect(html).not.toContain("Content-Security-Policy");
    expect(html).toContain('<script src="./frame-guard.js"></script>');
  });

  it("asks search engines to stay away everywhere except in production", () => {
    const robots = '<meta name="robots" content="noindex, nofollow" />';
    expect(composeIndexHtml(builtHtml, emulator, building)).toContain(robots);
    expect(composeIndexHtml(builtHtml, resolveBuildConfig("staging", realEnvironment, ports), building)).toContain(
      robots,
    );
    expect(composeIndexHtml(builtHtml, production, building)).not.toContain('name="robots"');
  });

  it("takes the theme colour from the design tokens, so index.html holds no colour of its own", () => {
    expect(indexHtml).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const themeColour = readTokens().get("ink-950") ?? "";
    expect(themeColour).toMatch(/^#[0-9a-f]{6}$/);
    expect(composeIndexHtml(builtHtml, emulator, { building: true, themeColour })).toContain(
      `<meta name="theme-color" content="${themeColour}" />`,
    );
  });

  it("fails the build when index.html has lost its character-set declaration or its title", () => {
    expect(() => composeIndexHtml(builtHtml.replace('<meta charset="utf-8" />', ""), emulator, building)).toThrow(
      /index\.html needs/,
    );
    expect(() => composeIndexHtml(builtHtml.replace(/<title>.*<\/title>/, ""), emulator, building)).toThrow(
      /index\.html needs/,
    );
  });

  it("fails the build when something that loads or runs would come before the policy", () => {
    const early = builtHtml.replace("<head>", '<head>\n    <script src="./early.js"></script>');
    expect(() => composeIndexHtml(early, emulator, building)).toThrow(/must come before every element/);
  });

  it("fails the build when the character-set declaration would end after byte 1024", () => {
    const pushedDown = builtHtml.replace("<head>", `<head>\n    <!-- ${"padding ".repeat(140)} -->`);
    expect(() => composeIndexHtml(pushedDown, emulator, building)).toThrow(/first 1024 bytes/);
  });
});

describe("notFoundHtml", () => {
  const tokens = readTokens();
  const page = (publicPath: string) =>
    notFoundHtml({ publicPath, tokens, fontFile: "assets/dm-sans-latin-opsz-normal-abc123.woff2" });

  it("says that the page was not found and links to the start of the portal", () => {
    const html = page("/portal/");
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain('<a href="/portal/">Go to the members\' portal</a>');
    expect(html).toContain("<title>Page not found | EEGManyLabs members' portal</title>");
  });

  it.each(["/", "/portal/", "/eegmanylabs-org/"])(
    "addresses everything from the path %s, so it works at any depth",
    (publicPath) => {
      const html = page(publicPath);
      const addresses = [...html.matchAll(/(?:href|src)="([^"]*)"|url\("([^"]*)"\)/g)].map(
        (match) => match[1] ?? match[2] ?? "",
      );
      expect(addresses).toEqual([`${publicPath}assets/dm-sans-latin-opsz-normal-abc123.woff2`, publicPath]);
      for (const address of addresses) expect(address.startsWith("/")).toBe(true);
    },
  );

  it("runs no script and carries a policy of its own that allows none", () => {
    const html = page("/portal/");
    expect(html).not.toContain("<script");
    const [first, second] = headElements(html);
    expect(first).toBe('<meta charset="utf-8" />');
    expect(second).toBe(
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'\" />",
    );
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("takes its colours and its typeface from the design tokens", () => {
    const html = page("/portal/");
    const colours = new Set([...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]));
    const fromTokens = new Set(
      [
        "ink-950",
        "background",
        "fg",
        "fg-secondary",
        "accent-strong",
        "accent-strong-hover",
        "fg-on-accent",
        "focus-ring",
      ].map((name) => tokens.get(name)),
    );
    expect([...colours].filter((colour) => !fromTokens.has(colour))).toEqual([]);
    expect(html).toContain(`font-family: ${tokens.get("sans")};`);
    expect(html).not.toMatch(/box-shadow|text-shadow/);
  });
});

describe("findFontFile", () => {
  it("finds the upright Latin DM Sans file among the files of a build", () => {
    expect(
      findFontFile([
        "index.html",
        "assets/index-abc123.js",
        "assets/dm-sans-latin-ext-opsz-normal-DEF456.woff2",
        "assets/dm-sans-latin-opsz-normal-AbC_12-3.woff2",
      ]),
    ).toBe("assets/dm-sans-latin-opsz-normal-AbC_12-3.woff2");
  });

  it("fails the build when the font is missing, so the page cannot lose it unnoticed", () => {
    expect(() => findFontFile(["index.html", "assets/index-abc123.js"])).toThrow(/DM Sans/);
  });
});
