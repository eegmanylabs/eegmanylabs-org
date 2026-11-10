import { COLLECTIONS, setUserStatusContract, type UserStatus } from "@eegml/shared";
import { commitAccess, draftAccess } from "../access/maintain";
import {
  AppError,
  authentication,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { LAST_ADMINISTRATOR_MESSAGE, otherAdministrators } from "../roles/administrators";
import { inForce } from "../roles/assignments";

/**
 * Brings the Authentication account in line with a status. A suspended account is disabled,
 * so it can neither sign in nor refresh its session, and its refresh tokens are revoked. An
 * account that does not exist in Authentication any more has nothing left to disable.
 */
async function applyToAccount(uid: string, status: UserStatus): Promise<"applied" | "noAccount"> {
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

/**
 * Suspends an account or lifts its suspension (docs/SECURITY.md, section 3). Capability:
 * `users.suspend`, with the second factor wherever the caller's access document requires one.
 *
 * A suspension takes three steps, and the first is the one that holds at once:
 *
 * | Step                                              | Effect                                            |
 * |---------------------------------------------------|---------------------------------------------------|
 * | `users/{uid}.status` and the access document, in one transaction with the audit entry | The security rules and every function refuse the account on its next request |
 * | The Authentication account is disabled            | No new sign-in and no refresh of the session      |
 * | Its refresh tokens are revoked                    | Open sessions end when their token runs out       |
 *
 * A caller never suspends their own account, and the last active programme administrator is
 * never suspended. A call that asks for the status the account has already changes no
 * document and still repeats the two steps on the Authentication account, so a call that
 * failed half way is completed by calling again.
 */
export const setUserStatus = defineCallable(setUserStatusContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const userReference = db.doc(COLLECTIONS.users.docPath(input.uid));

    await db.runTransaction(async (transaction) => {
      requireCapability(context, await readAccessDocument(db, actor, transaction), "users.suspend", "programme");
      if (input.uid === actor) {
        throw new AppError("permission-denied", "You cannot suspend or reinstate your own account.");
      }
      const draft = await draftAccess(db, transaction, input.uid, at);
      if (draft === null) {
        throw new AppError("not-found", "This account does not exist, or it has never started the portal.");
      }
      if (draft.inputs.user.status === input.status) return;
      if (
        input.status === "suspended" &&
        draft.inputs.roleAssignments.some(
          (assignment) => assignment.role === "programme_admin" && inForce(assignment, at),
        ) &&
        (await otherAdministrators(db, transaction, input.uid, at)).length === 0
      ) {
        throw new AppError("failed-precondition", LAST_ADMINISTRATOR_MESSAGE);
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: input.status === "suspended" ? "account.suspended" : "account.reinstated",
          actor: { kind: "user", uid: actor },
          entityType: "user",
          entityId: input.uid,
          // The profile is readable by its owner only. The reason is the caller's own statement.
          changes: [...withheldChanges(["status"]), { field: "reason", after: input.reason }],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      transaction.update(userReference, { status: input.status, ...touchedFields(stamp) });
      draft.inputs = { ...draft.inputs, user: { ...draft.inputs.user, status: input.status } };
      commitAccess(db, transaction, draft, stamp);
    });

    const outcome = await applyToAccount(input.uid, input.status);
    if (outcome === "noAccount") {
      context.logger.warn("the status of an account without an Authentication record was changed", { uid: input.uid });
    }
    return { uid: input.uid, status: input.status };
  },
});
