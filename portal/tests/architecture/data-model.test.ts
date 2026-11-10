// The documentation guard: docs/DATA_MODEL.md and the collection registry say the same thing.
//
// The data model is the authoritative specification and the registry is what code reads, so
// neither may change without the other. These tests read the tables of the document and compare
// them with the registry in both directions: every path, how each identifier is formed, and
// which collections no client may write.
import { readFileSync } from "node:fs";
import path from "node:path";
import { COLLECTION_ENTRIES, type CollectionEntry } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { PORTAL_ROOT } from "./support";

const DOCUMENT = readFileSync(path.join(PORTAL_ROOT, "..", "docs", "DATA_MODEL.md"), "utf8");

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** The cells of one line of a Markdown table. */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Every table of the document: a header line, a line of dashes and the rows that follow. */
function tablesOf(markdown: string): Table[] {
  const tables: Table[] = [];
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const separator = lines[index + 1] ?? "";
    if (!lines[index]?.startsWith("|") || !/^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(separator)) continue;
    const header = cellsOf(lines[index] ?? "");
    const rows: string[][] = [];
    index += 2;
    while (lines[index]?.startsWith("|")) {
      rows.push(cellsOf(lines[index] ?? ""));
      index += 1;
    }
    tables.push({ header, rows });
  }
  return tables;
}

const codeSpans = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");

/** A path with the names of its parameters removed, so that `{id}` and `{claimId}` compare equal. */
const shapeOf = (documentPath: string) => documentPath.replace(/\{[^{}]+\}/g, "{}");
const withoutLastSegment = (documentPath: string) => documentPath.split("/").slice(0, -1).join("/");
const isFixed = (entry: CollectionEntry) => entry.identifier.kind === "fixed";

const TABLES = tablesOf(DOCUMENT);
/** The tables that define collections: Path, Identifier, Access, Contents. */
const DEFINITIONS = TABLES.filter((table) => table.header[0] === "Path" && table.header.includes("Contents"));
/** Any other table with a Path column: it refers to collections that are defined elsewhere. */
const REFERENCES = TABLES.filter((table) => table.header[0] === "Path" && !table.header.includes("Contents"));

interface DefinitionRow {
  readonly path: string;
  readonly identifier: string;
  readonly access: string;
}

const DEFINED: readonly DefinitionRow[] = DEFINITIONS.flatMap((table) =>
  table.rows.map((row) => ({
    path: codeSpans(row[0] ?? "")[0] ?? "",
    identifier: row[1] ?? "",
    access: row[2] ?? "",
  })),
);

const entriesDocumentedAs = (documentPath: string) =>
  COLLECTION_ENTRIES.filter((entry) => entry.documentedAs === documentPath);

/**
 * The entries that a reference in the text names: a document path, the path of a collection,
 * the bare name of a collection, or `private/<name>` and `special/<name>`.
 */
function entriesNamedBy(reference: string): CollectionEntry[] {
  const shape = shapeOf(reference);
  const exact = COLLECTION_ENTRIES.filter(
    (entry) => shapeOf(entry.path) === shape || shapeOf(entry.documentedAs) === shape,
  );
  if (exact.length > 0) return exact;
  const collection = COLLECTION_ENTRIES.filter(
    (entry) => !isFixed(entry) && shapeOf(withoutLastSegment(entry.path)) === shape,
  );
  if (collection.length > 0) return collection;
  const restricted = /^(private|special)\/(.+)$/.exec(reference);
  if (restricted) {
    return COLLECTION_ENTRIES.filter(
      (entry) =>
        entry.collectionId === restricted[1] &&
        (restricted[2] === "<name>" || entry.path.endsWith(`/${restricted[2]}`)),
    );
  }
  return COLLECTION_ENTRIES.filter((entry) => !isFixed(entry) && entry.collectionId === reference);
}

describe("the reader of the document", () => {
  it("finds the tables of the data model", () => {
    expect(DEFINITIONS).toHaveLength(11);
    expect(REFERENCES).toHaveLength(1);
    expect(DEFINED.length).toBeGreaterThan(120);
    for (const row of DEFINED) expect(row.path, JSON.stringify(row)).toMatch(/^[A-Za-z{][^ ]*$/);
  });

  it("reads a table cell by cell", () => {
    const [table] = tablesOf(
      "text\n\n| Path | Contents |\n|---|---|\n| `a/{b}` | One, `two` |\n| `c/{d}/e/{f}` | |\n\nmore",
    );
    expect(table).toEqual({
      header: ["Path", "Contents"],
      rows: [
        ["`a/{b}`", "One, `two`"],
        ["`c/{d}/e/{f}`", ""],
      ],
    });
    expect(codeSpans("`a/{b}`, `c` and d")).toEqual(["a/{b}", "c"]);
  });
});

describe("docs/DATA_MODEL.md and the collection registry", () => {
  it("define every path once", () => {
    const paths = DEFINED.map((row) => row.path);
    expect(paths.filter((documentPath, index) => paths.indexOf(documentPath) !== index)).toEqual([]);
  });

  it("agree on the paths: every path of the document has a registry entry", () => {
    expect(
      DEFINED.map((row) => row.path).filter((documentPath) => entriesDocumentedAs(documentPath).length === 0),
    ).toEqual([]);
  });

  it("agree on the paths: every registry entry appears in the document", () => {
    const documented = new Set(DEFINED.map((row) => row.path));
    expect(COLLECTION_ENTRIES.filter((entry) => !documented.has(entry.documentedAs)).map((entry) => entry.key)).toEqual(
      [],
    );
  });

  it("agree on which documents have a fixed name and which identifiers are opaque", () => {
    const disagreements = DEFINED.flatMap((row) =>
      entriesDocumentedAs(row.path)
        .filter(
          (entry) =>
            (row.identifier === "Fixed name") !== (entry.identifier.kind === "fixed") ||
            row.identifier.startsWith("Opaque") !== (entry.identifier.kind === "auto"),
        )
        .map((entry) => `${entry.key}: the document says "${row.identifier}"`),
    );
    expect(disagreements).toEqual([]);
  });

  it("agree on what no client reads: the access tier FUNCTION, alone", () => {
    const disagreements = DEFINED.flatMap((row) =>
      entriesDocumentedAs(row.path)
        .filter((entry) => {
          const unreadable = entry.read.tiers.includes("FUNCTION");
          const documentedUnreadable = row.access === "FUNCTION" || row.access.startsWith("No client read");
          const closed = unreadable && entry.write.mode === "function";
          return unreadable !== documentedUnreadable || closed !== (row.access === "FUNCTION");
        })
        .map((entry) => `${entry.key}: the document says "${row.access}"`),
    );
    expect(disagreements).toEqual([]);
  });

  it("agree on what only trusted code writes: the document says FUNCTION wherever the registry does", () => {
    const disagreements = DEFINED.flatMap((row) =>
      entriesDocumentedAs(row.path)
        .filter((entry) => entry.write.mode === "function" && !/\bFUNCTION\b/.test(row.access))
        .map((entry) => `${entry.key}: the document says "${row.access}"`),
    );
    expect(disagreements).toEqual([]);
  });

  it("refer, in every other table, only to collections that are defined", () => {
    const unknown = REFERENCES.flatMap((table) =>
      table.rows.flatMap((row) =>
        codeSpans(row[0] ?? "").filter((reference) => entriesNamedBy(reference).length === 0),
      ),
    );
    expect(unknown).toEqual([]);
  });
});

describe("the list of collections that never accept a client write", () => {
  const SENTENCE = /The following never accept a client write: ([^\n]*?)\. In `users\/\{uid\}\/notifications`/.exec(
    DOCUMENT,
  );

  /** The registry keys that the sentence covers: each collection it names, and its subcollections where it says so. */
  function covered(): Set<string> {
    const keys = new Set<string>();
    for (const item of (SENTENCE?.[1] ?? "").split(/,\s+|\s+and\s+(?=`|the\s)/)) {
      const named = new Set(
        codeSpans(item).flatMap((reference) => entriesNamedBy(reference).map((entry) => entry.key)),
      );
      if (/with its subcollections/.test(item)) {
        // The registry lists a parent before its children, so one pass reaches every descendant.
        for (const entry of COLLECTION_ENTRIES) {
          if (entry.parent !== null && named.has(entry.parent)) named.add(entry.key);
        }
      }
      for (const key of named) keys.add(key);
    }
    return keys;
  }

  it("is found in the document, and names only collections that are defined", () => {
    expect(SENTENCE).not.toBeNull();
    const unknown = codeSpans(SENTENCE?.[1] ?? "").filter((reference) => entriesNamedBy(reference).length === 0);
    expect(unknown).toEqual([]);
  });

  it("names nothing that the registry lets a client write", () => {
    const keys = covered();
    expect(
      COLLECTION_ENTRIES.filter((entry) => keys.has(entry.key) && entry.write.mode !== "function").map(
        (entry) => entry.key,
      ),
    ).toEqual([]);
  });

  it("names everything that the registry reserves for trusted code", () => {
    const keys = covered();
    expect(
      COLLECTION_ENTRIES.filter((entry) => entry.write.mode === "function" && !keys.has(entry.key)).map(
        (entry) => entry.key,
      ),
    ).toEqual([]);
  });
});
