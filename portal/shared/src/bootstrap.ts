// The bootstrap of the first programme administrators.
//
// A new project has no administrator who could grant the first role. The command
// `admin:bootstrap` therefore stores one record for an address, under the keyed hash of that
// address and with no address in it. The first account that signs in with that address,
// verified, becomes a programme administrator, and the record is marked as used.
//
// The record is no part of the collection registry yet: docs/DATA_MODEL.md has no row for it, and
// the registry and that document change together. No security rule names the collection, so
// every client is refused every read and write of it. Only the command and `sessionStart` use it.
import { normaliseEmail } from "./identifiers";
import { keyedShortHash } from "./ids";
import { documentBaseSchema, uidSchema } from "./schemas/base";
import { timestampSchema } from "./timestamp";
import type { z } from "./zod";

/** The collection of bootstrap records. Its document identifiers are built with `bootstrapAdminId`. */
export const BOOTSTRAP_ADMINS_COLLECTION = "bootstrapAdmins";

/**
 * The identifier of the bootstrap record of an address: the keyed hash of a label and of the
 * address in canonical form, one to a line. The label keeps it apart from the entry of the same
 * address in `personEmailIndex`. Pinned to a golden value in bootstrap.test.ts.
 */
export function bootstrapAdminId(email: string, secret: string): string {
  return keyedShortHash(`bootstrapAdmin\n${normaliseEmail(email)}`, secret);
}

export function bootstrapAdminPath(id: string): string {
  if (!/^[0-9a-f]{20}$/.test(id)) throw new RangeError("A bootstrap record is named by a keyed short hash.");
  return `${BOOTSTRAP_ADMINS_COLLECTION}/${id}`;
}

/** `bootstrapAdmins/{hash}`: the standard fields, and who used the record when. Never an address. */
export const bootstrapAdminRecordSchema = documentBaseSchema.extend({
  /** When an account used the record, or null while it is unused. A used record matches nobody. */
  usedAt: timestampSchema.nullable(),
  /** The account that the record made a programme administrator. */
  usedBy: uidSchema.nullable(),
});
export type BootstrapAdminRecord = z.output<typeof bootstrapAdminRecordSchema>;
