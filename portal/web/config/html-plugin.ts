// Vite plugin for the parts of index.html that depend on the build mode.
import { copyFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { buildContentSecurityPolicy } from "./csp.ts";
import type { PortalBuildConfig } from "./types.ts";

const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/**
 * - Puts the Content-Security-Policy meta element first in <head>, so the policy applies to
 *   everything the parser meets after it. Builds only: the development server injects inline
 *   scripts for hot reloading, which the policy would block.
 * - Adds a robots meta element in every mode except production.
 * - Loads public/frame-guard.js before the application. It is added here, not written in
 *   index.html, because it must stay a classic script that runs before anything else.
 * - Copies index.html to 404.html, which GitHub Pages serves for unknown paths.
 */
export function portalHtml(config: PortalBuildConfig): Plugin {
  let outputDirectory = "";
  let building = false;
  return {
    name: "portal-html",
    configResolved(resolved) {
      outputDirectory = path.resolve(resolved.root, resolved.build.outDir);
      building = resolved.command === "build";
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const first: string[] = [];
        if (building) {
          const policy = escapeAttribute(buildContentSecurityPolicy(config));
          first.push(`<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
        }
        if (config.mode !== "production") first.push('<meta name="robots" content="noindex, nofollow" />');
        if (!html.includes("<head>") || !html.includes("</title>")) {
          throw new Error("index.html needs a plain <head> element and a <title> for the portal's additions.");
        }
        return html
          .replace("<head>", `<head>\n    ${first.join("\n    ")}`)
          .replace("</title>", '</title>\n    <script src="./frame-guard.js"></script>');
      },
    },
    writeBundle() {
      copyFileSync(path.join(outputDirectory, "index.html"), path.join(outputDirectory, "404.html"));
    },
  };
}
