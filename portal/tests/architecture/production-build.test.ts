// Builds the web application for production, with invented configuration, and reads what came
// out. Everything that exists for the emulators only must be absent from it.
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PORTAL_ROOT } from "./support";

// Invented values in the shape the Firebase console gives. They name no real project.
const INVENTED_CONFIGURATION = {
  VITE_FIREBASE_API_KEY: "example-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "example-portal.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "example-portal",
  VITE_FIREBASE_STORAGE_BUCKET: "example-portal.firebasestorage.app",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000",
  PORTAL_PUBLIC_PATH: "/example-repository/",
};

let output = "";
let build: SpawnSyncReturns<string>;

/** Paths of every file of the build, relative to its directory. */
function files(directory = output, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(directory, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

const read = (file: string) => readFileSync(path.join(output, file), "utf8");
const scripts = () =>
  files()
    .filter((file) => file.endsWith(".js"))
    .map((file) => ({ file, text: read(file) }));

beforeAll(() => {
  // A directory of its own, so the build disturbs neither the builds in use nor another run.
  output = mkdtempSync(path.join(os.tmpdir(), "eegml-production-build-"));
  build = spawnSync(
    process.execPath,
    [path.join(PORTAL_ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--mode", "production"],
    {
      cwd: path.join(PORTAL_ROOT, "web"),
      env: { ...process.env, ...INVENTED_CONFIGURATION, PORTAL_WEB_OUT_DIR: output },
      encoding: "utf8",
    },
  );
}, 120_000);

afterAll(() => {
  rmSync(output, { recursive: true, force: true });
});

describe("a production build", () => {
  it("succeeds with the five variables of the Firebase web configuration", () => {
    expect(build.stderr).not.toMatch(/error/i);
    expect(build.status).toBe(0);
    expect(files()).toEqual(expect.arrayContaining(["index.html", "404.html", "frame-guard.js"]));
  });

  /** The files whose text matches, by name: a failure then names the file and does not print a bundle. */
  const filesWith = (pattern: RegExp) =>
    files()
      .filter((name) => /\.(js|html|css)$/.test(name))
      .filter((name) => pattern.test(read(name)));

  it("names no local address and connects to no emulator", () => {
    expect(filesWith(/127\.0\.0\.1/)).toEqual([]);
    expect(filesWith(/example-portal/).length).toBeGreaterThan(0);
    expect(scripts().filter(({ text }) => /emulators:\s*null/.test(text)).length).toBe(1);
  });

  it("contains neither the page of interface components nor a route to it", () => {
    expect(files().filter((file) => /ComponentsPage/.test(file))).toEqual([]);
    expect(filesWith(/dev\/components|Interface components|__portalTest/)).toEqual([]);
  });

  it("ships DM Sans and no other typeface, no source map and no configuration file", () => {
    const fonts = files().filter((file) => file.endsWith(".woff2"));
    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) expect(font).toMatch(/^assets\/dm-sans-/);
    expect(files().filter((file) => /\.map$|(^|\/)\.env/.test(file))).toEqual([]);
  });

  it("has a policy for the production services, no inline script and no request to stay out of search results", () => {
    const html = read("index.html");
    expect(html).toContain("https://europe-west2-example-portal.cloudfunctions.net");
    expect(html).toContain("upgrade-insecure-requests");
    expect(html).not.toContain('name="robots"');
    expect([...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)]).toEqual([]);
    // Relative addresses only, so the files work wherever they are published.
    expect([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])).toEqual(
      expect.arrayContaining(["./frame-guard.js"]),
    );
    for (const [, address] of html.matchAll(/(?:src|href)="([^"]+)"/g)) expect(address).toMatch(/^\.\//);
  });

  it("links the page for unknown addresses to the path the portal is published under", () => {
    const html = read("404.html");
    expect(html).toContain('<a href="/example-repository/">');
    expect(html).toMatch(/url\("\/example-repository\/assets\/dm-sans-latin-opsz-normal-[\w-]+\.woff2"\)/);
    expect(html).not.toContain("<script");
  });
});
