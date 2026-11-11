// Vite plugin for the parts of the built pages that depend on the build mode: the additions to
// index.html, and 404.html, the page GitHub Pages serves for an address it does not know.
import type { Plugin } from "vite";
import { buildContentSecurityPolicy } from "./csp.ts";
import { readTokens } from "./tokens.ts";
import type { PortalBuildConfig } from "./types.ts";

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const CHARSET_ELEMENT = '<meta charset="utf-8" />';
/** HTML requires the character-set declaration to lie inside the first 1024 bytes of the file. */
export const CHARSET_LIMIT_BYTES = 1024;

const PORTAL_NAME = "EEGManyLabs members' portal";

export interface IndexAdditions {
  /** True for a build. The development server needs inline scripts, which the policy forbids. */
  readonly building: boolean;
  /** The browser-interface colour, taken from the design tokens. */
  readonly themeColour: string;
}

/**
 * Adds to index.html what depends on the build:
 *
 * - The character-set declaration stays first, and the Content-Security-Policy meta element
 *   follows it directly. A policy delivered by a meta element applies from the point where the
 *   parser meets it, and the character-set declaration loads nothing, so the policy still
 *   precedes every element that fetches something.
 * - A robots meta element in every mode except production.
 * - The theme colour, so that index.html holds no colour value of its own.
 * - public/frame-guard.js, before the application. It is added here, not written in
 *   index.html, because it must stay a classic script that runs before anything else.
 */
export function composeIndexHtml(html: string, config: PortalBuildConfig, additions: IndexAdditions): string {
  if (!html.includes(CHARSET_ELEMENT) || !html.includes("</title>")) {
    throw new Error(`index.html needs ${CHARSET_ELEMENT} and a <title> for the portal's additions.`);
  }
  const head: string[] = [];
  if (additions.building) {
    head.push(
      `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(buildContentSecurityPolicy(config))}" />`,
    );
  }
  if (config.mode !== "production") head.push('<meta name="robots" content="noindex, nofollow" />');
  head.push(`<meta name="theme-color" content="${escapeHtml(additions.themeColour)}" />`);

  const composed = html
    .replace(CHARSET_ELEMENT, [CHARSET_ELEMENT, ...head].join("\n    "))
    .replace("</title>", '</title>\n    <script src="./frame-guard.js"></script>');
  assertHeadOrder(composed, additions.building);
  return composed;
}

/** Fails the build when the order of the document head would weaken the page. */
function assertHeadOrder(html: string, building: boolean): void {
  const charsetEnd = html.indexOf(CHARSET_ELEMENT) + CHARSET_ELEMENT.length;
  if (Buffer.byteLength(html.slice(0, charsetEnd), "utf8") > CHARSET_LIMIT_BYTES) {
    throw new Error(
      `The character-set declaration must end within the first ${CHARSET_LIMIT_BYTES} bytes of the page.`,
    );
  }
  if (!building) return;
  const policy = html.indexOf('<meta http-equiv="Content-Security-Policy"');
  const firstFetch = Math.min(
    ...["<script", "<link", "<img", "<style"].map((tag) => html.indexOf(tag)).filter((at) => at >= 0),
  );
  if (policy < 0 || policy > firstFetch) {
    throw new Error("The Content-Security-Policy must come before every element that loads or runs something.");
  }
}

export interface NotFoundPage {
  /** The path the portal is published under, with a slash at both ends. See `resolvePublicPath`. */
  readonly publicPath: string;
  /** The design tokens with their final values, by name. */
  readonly tokens: ReadonlyMap<string, string>;
  /** The DM Sans file of the build, as a path inside the output directory. */
  readonly fontFile: string;
}

/**
 * The page for an address that does not exist. GitHub Pages serves it at any depth, so it
 * cannot use a relative address: its one link and its one font file are addressed from the
 * path the portal is published under. It runs no script and loads nothing else.
 */
export function notFoundHtml({ publicPath, tokens, fontFile }: NotFoundPage): string {
  const token = (name: string) => {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`The page for unknown addresses needs the token --${name}.`);
    return value;
  };
  const policy = "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'";
  const root = escapeHtml(publicPath);
  return `<!doctype html>
<html lang="en-GB">
  <head>
    ${CHARSET_ELEMENT}
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="theme-color" content="${escapeHtml(token("ink-950"))}" />
    <title>Page not found | ${escapeHtml(PORTAL_NAME)}</title>
    <style>
      @font-face {
        font-family: "DM Sans Variable";
        font-style: normal;
        font-display: swap;
        font-weight: 100 1000;
        src: url("${root}${escapeHtml(fontFile)}") format("woff2-variations");
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        align-content: center;
        background: ${token("background")};
        color: ${token("fg")};
        font-family: ${token("sans")};
        font-size: 0.875rem;
        line-height: 1.45;
      }
      main { width: 100%; max-width: 48.75rem; margin: 0 auto; padding: 1.5rem; }
      h1 { margin: 0 0 1rem; font-size: 1.7rem; font-weight: 400; line-height: 1.08; letter-spacing: -0.04em; }
      p { margin: 0 0 1rem; color: ${token("fg-secondary")}; }
      a {
        display: inline-flex;
        align-items: center;
        height: 2.5rem;
        padding: 0 1rem;
        border: 1px solid ${token("accent-strong")};
        border-radius: 8px;
        background: ${token("accent-strong")};
        color: ${token("fg-on-accent")};
        font-weight: 500;
        text-decoration: none;
      }
      a:hover { border-color: ${token("accent-strong-hover")}; background: ${token("accent-strong-hover")}; }
      a:focus-visible { outline: 3px solid ${token("focus-ring")}; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>
        There is no page at this address. Every page of the portal is reached from its start page, so an address
        inside the portal contains a # sign.
      </p>
      <p><a href="${root}">Go to the members' portal</a></p>
    </main>
  </body>
</html>
`;
}

/** The main DM Sans file among the files of a build: upright, Latin, with the optical-size axis. */
export function findFontFile(fileNames: readonly string[]): string {
  const font = fileNames.find((name) => /(^|\/)dm-sans-latin-opsz-normal[\w.-]*\.woff2$/.test(name));
  if (!font) throw new Error("The build contains no DM Sans font file for the page for unknown addresses.");
  return font;
}

export interface PortalHtmlOptions {
  readonly publicPath: string;
}

export function portalHtml(config: PortalBuildConfig, { publicPath }: PortalHtmlOptions): Plugin {
  const tokens = readTokens();
  const themeColour = tokens.get("ink-950");
  if (themeColour === undefined) throw new Error("tokens.css has no --ink-950 for the theme colour.");
  let building = false;
  return {
    name: "portal-html",
    configResolved(resolved) {
      building = resolved.command === "build";
    },
    transformIndexHtml: {
      order: "post",
      handler: (html) => composeIndexHtml(html, config, { building, themeColour }),
    },
    generateBundle(_options, bundle) {
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: notFoundHtml({ publicPath, tokens, fontFile: findFontFile(Object.keys(bundle)) }),
      });
    },
  };
}
