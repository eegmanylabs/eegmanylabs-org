// The Authentication account behind a status of `users/{uid}`: a suspended account is disabled,
// so it can neither sign in nor refresh its session, and its refresh tokens are revoked.
import type { UserStatus } from "@eegml/shared";
import { authentication } from "../framework";

/**
 * Brings the Authentication account in line with a status. An account that does not exist in
 * Authentication any more has nothing left to disable.
 */
export async function applyAccountStatus(uid: string, status: UserStatus): Promise<"applied" | "noAccount"> {
  const auth = authentication();
  try {
    await auth.updateUser(uid, { disabled: status === "suspended" });
    if (status === "suspended") await auth.revokeRefreshTokens(uid);
    return "applied";
  } catch (error) {
    if ((error as { code?: unknown }).code === "auth/user-not-found") return "noAccount";
    throw error;
  }
}
