// @ts-check
// Finds every secret that the functions code asks for, and where. A secret reaches a function
// in three ways only: `defineSecret(NAME)`, the `secrets` option of a function that binds such a
// parameter, and the environment variable of a storage secret named by an endpoint, which
// credentials.ts reads with `process.env[credentialRef]` after checking the `STORAGE_` prefix.
// The deployment preflight and tests/architecture/least-privilege.test.ts both use this.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORTAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ file: string, secret: string, how: "defineSecret" | "prefix" }} SecretReference */

/**
 * The source files of a directory, tests left out, as paths relative to it.
 * @param {string} directory
 * @returns {string[]}
 */
function sourcesBelow(directory) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} relative */
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) found.push(child);
    }
  };
  walk("");
  return found;
}

/**
 * String constants of the form `NAME = "VALUE"` in the given texts.
 * @param {readonly string[]} texts
 */
function constantsOf(texts) {
  /** @type {Map<string, string>} */
  const constants = new Map();
  for (const text of texts) {
    for (const match of text.matchAll(/\b([A-Z][A-Z0-9_]+)\s*=\s*"([^"]+)"/g)) {
      if (match[1] !== undefined && match[2] !== undefined) constants.set(match[1], match[2]);
    }
  }
  return constants;
}

/**
 * Every secret the functions code names, with the file (relative to functions/src) that names it.
 * @param {string} [root] The portal directory.
 * @returns {SecretReference[]}
 */
export function secretReferences(root = PORTAL_ROOT) {
  const functionsSource = path.join(root, "functions", "src");
  const files = sourcesBelow(functionsSource).map((file) => ({
    file,
    text: readFileSync(path.join(functionsSource, file), "utf8"),
  }));
  const shared = sourcesBelow(path.join(root, "shared", "src")).map((file) =>
    readFileSync(path.join(root, "shared", "src", file), "utf8"),
  );
  const constants = constantsOf([...shared, ...files.map((file) => file.text)]);
  /** @type {SecretReference[]} */
  const references = [];
  for (const { file, text } of files) {
    for (const match of text.matchAll(/defineSecret\(\s*(?:"([^"]+)"|([A-Za-z_][\w]*))\s*\)/g)) {
      const secret = match[1] ?? constants.get(match[2] ?? "") ?? `unresolved:${match[2]}`;
      references.push({ file, secret, how: "defineSecret" });
    }
    if (/process\.env\[/.test(text)) {
      const prefix = /\^([A-Z]+_)\[/.exec(text)?.[1] ?? "unchecked:";
      references.push({ file, secret: prefix, how: "prefix" });
    }
  }
  return references;
}
