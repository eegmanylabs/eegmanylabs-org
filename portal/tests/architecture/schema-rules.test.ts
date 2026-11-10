// Every stored document carries the standard fields of docs/DATA_MODEL.md, section 1. These
// tests read the schema registry and the schema directory, so a schema added later cannot
// leave the fields out or stay out of the registry.
import {
  APPEND_ONLY_BASE_FIELDS,
  COLLECTIONS,
  DOCUMENT_BASE_FIELDS,
  DOCUMENT_SCHEMAS,
  type DocumentLifecycle,
  type RegisteredSchema,
  z,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { importsOf, isTest, sourceFiles } from "./support";

const SCHEMA_DIRECTORY = "shared/src/schemas";
/** Files of the schema directory that hold no document schema of their own. */
const NOT_A_DOCUMENT_SCHEMA = new Set(["base.ts", "registry.ts"]);

const FIELDS_OF: Record<DocumentLifecycle, readonly string[]> = {
  mutable: DOCUMENT_BASE_FIELDS,
  appendOnly: APPEND_ONLY_BASE_FIELDS,
};

/** The standard fields a registered schema lacks or makes optional. */
function missingStandardFields({ schema, lifecycle }: RegisteredSchema): string[] {
  const shape = schema.shape as Record<string, z.ZodType>;
  return FIELDS_OF[lifecycle].filter((field) => {
    const declared = shape[field];
    return declared === undefined || declared.safeParse(undefined).success;
  });
}

describe("the check for standard fields", () => {
  const complete = DOCUMENT_SCHEMAS[COLLECTIONS.users].schema;

  it("finds a field that a schema leaves out", () => {
    const schema = complete.omit({ writeContext: true, updatedBy: true });
    expect(missingStandardFields({ schema, lifecycle: "mutable" })).toEqual(["updatedBy", "writeContext"]);
  });

  it("finds a field that a schema makes optional", () => {
    const schema = complete.extend({ createdBy: z.string().optional() });
    expect(missingStandardFields({ schema, lifecycle: "mutable" })).toEqual(["createdBy"]);
  });
});

describe("the schema registry", () => {
  it("has a schema for every collection and for nothing else", () => {
    expect(Object.keys(DOCUMENT_SCHEMAS).sort()).toEqual(Object.values(COLLECTIONS).sort());
  });

  it.each(Object.entries(DOCUMENT_SCHEMAS))("%s carries every standard field of its lifecycle", (_name, registered) => {
    expect(missingStandardFields(registered)).toEqual([]);
  });

  it("gives an append-only document no field that only an update could set", () => {
    const updateOnly = DOCUMENT_BASE_FIELDS.filter((field) => !APPEND_ONLY_BASE_FIELDS.includes(field));
    expect(updateOnly.sort()).toEqual(["archivedAt", "updatedAt", "updatedBy"]);
    for (const { schema, lifecycle } of Object.values(DOCUMENT_SCHEMAS)) {
      if (lifecycle !== "appendOnly") continue;
      expect(Object.keys(schema.shape).filter((field) => updateOnly.includes(field))).toEqual([]);
    }
  });

  it("includes every file of the schema directory, so no schema can stay outside these checks", () => {
    const files = sourceFiles(SCHEMA_DIRECTORY).filter((file) => !isTest(file));
    const registry = files.find((file) => file.path === `${SCHEMA_DIRECTORY}/registry.ts`);
    expect(registry).toBeDefined();
    const registered = new Set(importsOf(registry ?? { path: "", text: "" }).map((specifier) => `${specifier}.ts`));
    const outside = files
      .map((file) => file.path.slice(SCHEMA_DIRECTORY.length + 1))
      .filter((name) => !NOT_A_DOCUMENT_SCHEMA.has(name))
      .filter((name) => !registered.has(`./${name.replace(/\.ts$/, "")}.ts`));
    expect(outside).toEqual([]);
  });
});
