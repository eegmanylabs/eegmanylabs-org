// Helpers for tests that read the source tree instead of running it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PORTAL_ROOT } from "../../scripts/paths.mjs";

export { PORTAL_ROOT };

/** Directories that hold generated files or installed packages, never source. */
const GENERATED_DIRECTORIES = new Set(["node_modules", "out", ".run", ".private"]);
const GENERATED_FILES = [/^firebase\.run-\d+\.json$/, /^package-lock\.json$/, /\.log$/, /^\.env(\..+)?\.local$/];

export interface SourceFile {
  /** Path relative to the portal directory, with forward slashes. */
  readonly path: string;
  readonly text: string;
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".js",
  ".json",
  ".css",
  ".html",
  ".md",
  ".rules",
  ".sh",
  ".yml",
  ".example",
  "",
]);

/** Every text source file under a directory of the portal, generated files left out. */
export function sourceFiles(directory = ""): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(PORTAL_ROOT, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!GENERATED_DIRECTORIES.has(entry.name)) walk(child);
      } else if (!GENERATED_FILES.some((pattern) => pattern.test(entry.name))) {
        if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
          files.push({ path: child, text: readFileSync(path.join(PORTAL_ROOT, child), "utf8") });
        }
      }
    }
  };
  walk(directory);
  return files;
}

/** Every path under the portal directory that is not generated, text or not. */
export function allSourcePaths(): string[] {
  const paths: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(path.join(PORTAL_ROOT, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!GENERATED_DIRECTORIES.has(entry.name)) walk(child);
      } else if (!GENERATED_FILES.some((pattern) => pattern.test(entry.name))) {
        paths.push(child);
      }
    }
  };
  walk("");
  return paths;
}

const IMPORT_PATTERNS = [
  // import x from "m", import type x from "m", import "m", export ... from "m"
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\sfrom\s+)?["']([^"']+)["']/g,
  // import("m"), require("m")
  /(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** The module specifiers a file imports, in any form: static, type-only, dynamic or require. */
export function importsOf(file: SourceFile): string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of file.text.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

export const isCode = (file: SourceFile) => /\.(ts|tsx|mjs|cjs|js)$/.test(file.path);
export const isTest = (file: SourceFile) => /\.test\.(ts|tsx|mjs)$/.test(file.path);
