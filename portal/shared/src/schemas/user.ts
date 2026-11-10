import { dataOriginSchema } from "../data-origin";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";

export const USER_SCHEMA_VERSION = 1;

/**
 * | Status      | Meaning                                              |
 * |-------------|------------------------------------------------------|
 * | `active`    | The account may use the portal                       |
 * | `suspended` | An administrator has stopped the account from acting |
 */
export const USER_STATUSES = ["active", "suspended"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.output<typeof userStatusSchema>;

/** `users/{uid}`: one Firebase Authentication account. Maintained by the `sessionStart` function. */
export const userDocSchema = z.object({
  schemaVersion: z.literal(USER_SCHEMA_VERSION),
  /** The verified sign-in address in canonical form (see `normaliseEmail`). */
  emailLower: z.string().min(3).max(320),
  /** The name supplied by the sign-in provider. Absent until one is known. */
  displayName: z.string().min(1).max(200).nullable(),
  status: userStatusSchema,
  createdAt: timestampSchema,
  lastSeenAt: timestampSchema,
  dataOrigin: dataOriginSchema,
});
export type UserDoc = z.output<typeof userDocSchema>;
