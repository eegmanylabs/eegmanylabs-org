import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";

export const ACCESS_SCHEMA_VERSION = 1;

/**
 * `access/{uid}`: what one account may do. Security rules read this document, so it is the
 * authority for authorisation. Only functions write it.
 */
export const accessDocSchema = z.object({
  schemaVersion: z.literal(ACCESS_SCHEMA_VERSION),
  /** True once the account has been accepted as a member of the programme. */
  member: z.boolean(),
  /** The person profile this account is linked to, or null while it is unlinked. */
  personId: z.string().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  dataOrigin: dataOriginSchema,
});
export type AccessDoc = z.output<typeof accessDocSchema>;
