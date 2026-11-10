// The schema of every collection, in one registry.
//
// `satisfies` makes the compiler refuse a collection in COLLECTIONS that has no schema here,
// and an architecture test checks that each schema carries the standard fields of its
// lifecycle and that no schema file is left out.
import { COLLECTIONS, type CollectionName } from "../paths";
import type { z } from "../zod";
import { accessDocSchema } from "./access";
import { auditEventSchema } from "./audit";
import { userDocSchema } from "./user";

/**
 * | Lifecycle    | Meaning                                              | Standard fields         |
 * |--------------|------------------------------------------------------|-------------------------|
 * | `mutable`    | Documents are created, updated and archived          | `documentBaseSchema`    |
 * | `appendOnly` | Documents are created once and never changed         | `appendOnlyBaseSchema`  |
 */
export type DocumentLifecycle = "mutable" | "appendOnly";

export interface RegisteredSchema {
  readonly schema: z.ZodObject;
  readonly lifecycle: DocumentLifecycle;
}

export const DOCUMENT_SCHEMAS = {
  [COLLECTIONS.users]: { schema: userDocSchema, lifecycle: "mutable" },
  [COLLECTIONS.access]: { schema: accessDocSchema, lifecycle: "mutable" },
  [COLLECTIONS.auditEvents]: { schema: auditEventSchema, lifecycle: "appendOnly" },
} as const satisfies Record<CollectionName, RegisteredSchema>;
