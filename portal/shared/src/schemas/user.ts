import { dataOriginSchema } from "../data-origin";
import { DISPLAY_NAME_MAX_LENGTH } from "../identifiers";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import { documentBaseSchema } from "./base";

export const USER_SCHEMA_VERSION = 1;

/**
 * | Status      | Meaning                                              |
 * |-------------|------------------------------------------------------|
 * | `active`    | The account may use the portal                       |
 * | `suspended` | An administrator has stopped the account from acting |
 *
 * The status is the copy of the suspension that the account's profile shows. The copy that
 * security rules and functions enforce is `suspended` in `access/{uid}`. Trusted code changes
 * the two together.
 */
export const USER_STATUSES = ["active", "suspended"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.output<typeof userStatusSchema>;

/** `users/{uid}`: the profile of one Firebase Authentication account. Maintained by functions. */
export const userDocSchema = documentBaseSchema.extend({
  schemaVersion: z.literal(USER_SCHEMA_VERSION),
  /** The verified sign-in address in canonical form (see `normaliseEmail`). */
  emailLower: z.string().min(3).max(320),
  /**
   * The name the account gives itself, normalised with `normaliseDisplayName`. Any signed-in
   * account can choose it, so it never identifies anyone and is never shown as verified.
   */
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).nullable(),
  /** The person profile this account has claimed, or null while it has claimed none. */
  personId: z.string().min(1).nullable(),
  status: userStatusSchema,
  /** Whether the account has enrolled a second factor. */
  mfaEnrolled: z.boolean(),
  /** When the portal last started with this account signed in. */
  lastSeenAt: timestampSchema,
  /** Demonstration accounts are labelled, so that they are never mistaken for members. */
  dataOrigin: dataOriginSchema,
});
export type UserDoc = z.output<typeof userDocSchema>;
