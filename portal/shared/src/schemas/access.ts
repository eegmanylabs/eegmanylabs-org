import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import { documentBaseSchema } from "./base";

export const ACCESS_SCHEMA_VERSION = 1;

/**
 * `access/{uid}`: what one account may do. Security rules and functions read this document on
 * every request, so it is the authority for authorisation, and a change to it takes effect on
 * the next request. Only functions write it.
 */
export const accessDocSchema = documentBaseSchema.extend({
  schemaVersion: z.literal(ACCESS_SCHEMA_VERSION),
  /** True once the account has been accepted as a member of the programme. */
  member: z.boolean(),
  /** The person profile this account is linked to, or null while it is unlinked. */
  personId: z.string().min(1).nullable(),
  /** True while an administrator has stopped the account from acting. A suspended account is refused everything. */
  suspended: z.boolean(),
  /**
   * Sessions that began before this instant are refused, which is how every session of an
   * account is ended at once. Null while no such instant has been set.
   */
  sessionsValidAfter: timestampSchema.nullable(),
});
export type AccessDoc = z.output<typeof accessDocSchema>;

/** What the rules and the functions need to know about a caller's session. */
export interface SessionFacts {
  /** When the caller signed in, in seconds since the epoch, as the sign-in token states it. */
  readonly authTimeSeconds: number | null;
}

export type AccountStanding = "active" | "suspended" | "session-ended";

/**
 * Whether an account may act, from its access document. This is the same decision that
 * `isActive()` makes in portal/firestore.rules, so functions and rules refuse the same callers.
 * An account that has no access document yet is active: it has been granted nothing.
 */
export function accountStanding(
  access: Pick<AccessDoc, "suspended" | "sessionsValidAfter"> | null,
  session: SessionFacts,
): AccountStanding {
  if (access === null) return "active";
  if (access.suspended) return "suspended";
  if (access.sessionsValidAfter !== null) {
    const signedInAt = session.authTimeSeconds === null ? null : session.authTimeSeconds * 1000;
    if (signedInAt === null || signedInAt < access.sessionsValidAfter.toMillis()) return "session-ended";
  }
  return "active";
}
