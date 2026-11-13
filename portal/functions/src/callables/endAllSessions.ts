import { endAllSessionsContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { commitAccess, draftAccess } from "../access/maintain";
import { AppError, authentication, callerStamp, defineCallable, withheldChanges, writeAudit } from "../framework";
import { recordGovernance } from "../governance/ledger";

/**
 * Ends every session of the caller's own account, the session that makes the call included
 * (docs/SECURITY.md, section 3). Any signed-in account in good standing may call it, for itself
 * only: it takes no arguments.
 *
 * | Step                                                   | Effect                                               |
 * |--------------------------------------------------------|------------------------------------------------------|
 * | `sessionsValidAfter` of the access document, in one transaction with the audit entry | The security rules and every function refuse each session that began earlier, from its next request |
 * | The refresh tokens of the Authentication account are revoked | No session that began earlier can renew its token |
 *
 * The instant is whole seconds, because the sign-in time of a token is whole seconds: a session
 * that begins in the same second as the call is a new session and keeps working.
 */
export const endAllSessions = defineCallable(endAllSessionsContract, {
  handler: async (_input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const boundary = new Date(Math.floor(at.getTime() / 1000) * 1000);

    await db.runTransaction(async (transaction) => {
      const draft = await draftAccess(db, transaction, uid, at);
      if (draft === null) {
        throw new AppError("failed-precondition", "Your account has not started the portal yet. Reload the page.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "account.sessionsEnded",
          actor: { kind: "user", uid },
          entityType: "user",
          entityId: uid,
          // The access document is readable by its owner only.
          changes: withheldChanges(["sessionsValidAfter"]),
          at,
        },
        db,
      );
      draft.inputs = { ...draft.inputs, sessionsValidAfter: Timestamp.fromDate(boundary) };
      commitAccess(db, transaction, draft, callerStamp(uid, at, auditEventId));
    });

    try {
      await authentication().revokeRefreshTokens(uid);
    } catch (error) {
      // The access document already refuses every earlier session. An account that no longer
      // exists in Authentication has no tokens left to revoke.
      if ((error as { code?: unknown }).code !== "auth/user-not-found") throw error;
    }
    recordGovernance(context.logger, { kind: "sessionsEnded", at: boundary.toISOString(), uid });
    return { sessionsValidAfter: boundary.toISOString() };
  },
});
