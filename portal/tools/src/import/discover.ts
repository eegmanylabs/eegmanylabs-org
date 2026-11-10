// Finds the importers. Every module in `sources/` exports its definition as `importer`, so
// adding an importer adds one file there and edits no other.
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ImporterDefinition } from "./model";

export const SOURCES_DIRECTORY = path.join(import.meta.dirname, "sources");

function isImporter(value: unknown): value is ImporterDefinition {
  const candidate = value as Partial<ImporterDefinition> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.key === "string" &&
    typeof candidate.sourceKey === "string" &&
    typeof candidate.read === "function" &&
    typeof candidate.plan === "function"
  );
}

/** Every importer of a directory, by source key. A module that exports no importer is a defect and stops the tool. */
export async function discoverImporters(directory: string = SOURCES_DIRECTORY): Promise<ImporterDefinition[]> {
  const files = readdirSync(directory)
    .filter((name) => /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name))
    .sort();
  const importers: ImporterDefinition[] = [];
  for (const file of files) {
    const module = (await import(/* @vite-ignore */ pathToFileURL(path.join(directory, file)).href)) as { importer?: unknown };
    const found = module.importer;
    if (!isImporter(found)) {
      throw new Error(`The module sources/${file} exports no importer. Every module of that directory exports its definition as \`importer\`.`);
    }
    if (importers.some((other) => other.sourceKey === found.sourceKey || other.key === found.key)) {
      throw new Error(`Two importers claim the source or the key of sources/${file}.`);
    }
    importers.push(found);
  }
  return importers.sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1));
}
