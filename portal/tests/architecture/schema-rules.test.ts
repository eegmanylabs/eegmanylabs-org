// Every stored document carries the standard fields of docs/DATA_MODEL.md, section 1. These
// tests read the collection registry and the schema directory, so a schema added later cannot
// leave the fields out or stay out of the registry.
import * as shared from "@eegml/shared";
import {
  APPEND_ONLY_BASE_FIELDS,
  COLLECTION_ENTRIES,
  COLLECTIONS,
  type CollectionEntry,
  DOCUMENT_BASE_FIELDS,
  z,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { importsOf, isTest, sourceFiles } from "./support";

const SCHEMA_DIRECTORY = "shared/src/schemas";
/** Files of the schema directory that hold no document schema of their own. */
const NOT_A_DOCUMENT_SCHEMA = new Set(["base.ts"]);

type Lifecycle = Pick<CollectionEntry, "schema"> & { readonly flags: Pick<CollectionEntry["flags"], "appendOnly"> };

/** The standard fields a registered schema lacks or makes optional. */
function missingStandardFields({ schema, flags }: Lifecycle): string[] {
  const shape = schema.shape as Record<string, z.ZodType>;
  return (flags.appendOnly ? APPEND_ONLY_BASE_FIELDS : DOCUMENT_BASE_FIELDS).filter((field) => {
    const declared = shape[field];
    return (
      declared === undefined ||
      declared.safeParse(undefined).success ||
      // A field that may be absent, even where it refuses an explicit undefined.
      (declared as { def?: { type?: string } }).def?.type === "optional"
    );
  });
}

describe("the check for standard fields", () => {
  const complete = COLLECTIONS.users.schema;
  const mutable = { flags: { appendOnly: false } };

  it("finds a field that a schema leaves out", () => {
    const schema = complete.omit({ writeContext: true, updatedBy: true });
    expect(missingStandardFields({ schema, ...mutable })).toEqual(["updatedBy", "writeContext"]);
  });

  it("finds a field that a schema makes optional", () => {
    const schema = complete.extend({ createdBy: z.string().optional() });
    expect(missingStandardFields({ schema, ...mutable })).toEqual(["createdBy"]);
  });

  it("finds a field that a schema lets be absent", () => {
    const schema = complete.extend({ archivedAt: z.string().exactOptional() });
    expect(missingStandardFields({ schema, ...mutable })).toEqual(["archivedAt"]);
  });
});

describe("the collection registry", () => {
  it.each(COLLECTION_ENTRIES.map((entry) => [entry.key, entry] as const))(
    "%s carries every standard field of its lifecycle",
    (_name, entry) => {
      expect(missingStandardFields(entry)).toEqual([]);
    },
  );

  it("gives an append-only document no field that only an update could set", () => {
    const updateOnly = DOCUMENT_BASE_FIELDS.filter((field) => !APPEND_ONLY_BASE_FIELDS.includes(field));
    expect(updateOnly.sort()).toEqual(["archivedAt", "updatedAt", "updatedBy"]);
    const appendOnly = COLLECTION_ENTRIES.filter((entry) => entry.flags.appendOnly);
    expect(appendOnly.length).toBeGreaterThan(10);
    for (const { schema } of appendOnly) {
      expect(Object.keys(schema.shape).filter((field) => updateOnly.includes(field))).toEqual([]);
    }
  });

  it("includes every file of the schema directory, so no schema can stay outside these checks", () => {
    const files = sourceFiles(SCHEMA_DIRECTORY).filter((file) => !isTest(file));
    const registry = sourceFiles("shared/src").find((file) => file.path === "shared/src/collections.ts");
    expect(registry).toBeDefined();
    const registered = new Set(importsOf(registry ?? { path: "", text: "" }));
    const outside = files
      .map((file) => file.path.slice(SCHEMA_DIRECTORY.length + 1))
      .filter((name) => !NOT_A_DOCUMENT_SCHEMA.has(name))
      .filter((name) => !registered.has(`./schemas/${name.replace(/\.ts$/, "")}`));
    expect(files.length).toBeGreaterThan(10);
    expect(outside).toEqual([]);
  });

  it("includes every document schema that the shared package exports", () => {
    const registered = new Set<unknown>(COLLECTION_ENTRIES.map((entry) => entry.schema));
    const documentSchemas = Object.entries(shared).filter(
      ([name, value]) => /DocSchema$/.test(name) && value instanceof z.ZodObject,
    );
    expect(documentSchemas.length).toBeGreaterThan(130);
    expect(documentSchemas.filter(([, schema]) => !registered.has(schema)).map(([name]) => name)).toEqual([]);
    expect(registered.has(shared.auditEventSchema)).toBe(true);
  });
});
