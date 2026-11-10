#!/usr/bin/env node
// @ts-check
// A static server that behaves like GitHub Pages in the ways that matter to the portal:
//
//   - there are no rewrites: an unknown path answers 404 with the body of 404.html
//   - "/dir" redirects to "/dir/", and "/dir/" serves "/dir/index.html"
//   - there are no custom response headers, so no Content-Security-Policy header and no
//     X-Frame-Options: what the application needs must come from the files themselves
//
// The site is served under a path prefix, the way a project site is served under
// https://<owner>.github.io/<repository>/. That keeps root-relative addresses from working by
// accident.
//
//   node scripts/pages-server.mjs [--root <directory>] [--port <number>] [--mount /portal/]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { webOutputDirectory } from "./paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "./ports.mjs";

/** Path prefix the preview and the end-to-end tests serve the portal under. */
export const DEFAULT_MOUNT = "/portal/";

const CONTENT_TYPES = /** @type {Record<string, string>} */ ({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
});

/** @param {string} file */
const isFile = (file) => existsSync(file) && statSync(file).isFile();
/** @param {string} directory */
const isDirectory = (directory) => existsSync(directory) && statSync(directory).isDirectory();

/**
 * @param {{ root: string, mount: string }} options
 * @returns {import("node:http").Server}
 */
export function createPagesServer({ root, mount }) {
  /**
   * @param {import("node:http").ServerResponse} response
   * @param {number} status
   * @param {string} file
   * @param {string | undefined} method
   */
  const send = (response, status, file, method) => {
    response.writeHead(status, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-length": statSync(file).size,
      "cache-control": "max-age=600",
    });
    if (method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  };

  return createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    let pathname = "";
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = "\u0000";
    }
    if (`${pathname}/` === mount) {
      response.writeHead(301, { location: `${mount}${url.search}` });
      response.end();
      return;
    }
    if (!pathname.startsWith(mount) || pathname.includes("\u0000")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("404 Not Found\n");
      return;
    }

    const target = path.join(root, path.normalize(pathname.slice(mount.length)));
    const inside = target === root || target.startsWith(root + path.sep);
    if (inside && isFile(target)) return send(response, 200, target, request.method);
    if (inside && isDirectory(target)) {
      if (!pathname.endsWith("/")) {
        response.writeHead(301, { location: `${url.pathname}/${url.search}` });
        response.end();
        return;
      }
      const index = path.join(target, "index.html");
      if (isFile(index)) return send(response, 200, index, request.method);
    }
    const notFound = path.join(root, "404.html");
    if (isFile(notFound)) return send(response, 404, notFound, request.method);
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("404 Not Found\n");
  });
}

/**
 * @param {string} name
 * @param {string} fallback
 */
function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const ports = portsFor(resolvePortBase());
  const root = path.resolve(option("root", webOutputDirectory("emulator", ports.base)));
  const port = Number(option("port", String(ports.preview)));
  const mount = option("mount", DEFAULT_MOUNT);
  if (!/^\/([\w.-]+\/)*$/.test(mount)) {
    console.error(`pages-server: --mount must start and end with a slash, for example ${DEFAULT_MOUNT}`);
    process.exit(2);
  }
  if (!isFile(path.join(root, "index.html"))) {
    console.error(`pages-server: there is no build in ${root}. Run "npm run build" first.`);
    process.exit(2);
  }
  const server = createPagesServer({ root, mount });
  server.on("error", (error) => {
    console.error(`pages-server: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, LOCAL_HOST, () => {
    console.log(`pages-server: serving ${root} at http://${LOCAL_HOST}:${port}${mount}`);
  });
  for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  }
}
