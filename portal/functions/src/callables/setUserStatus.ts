import { COLLECTIONS, setUserStatusContract } from "@eegml/shared";
import { commitAccess, draftAccess } from "../access/maintain";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { applyAccountStatus } from "../people/account-status";
import {
  holdsProgrammeRole,
  LAST_ADMINISTRATOR_MESSAGE,
  otherAdministrators,
  PROGRAMME_STAFF_ACCOUNT_MESSAGE,
} from "../roles/administrators";
import { inForce } from "../roles/assignments";

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
 * never suspended. The account of programme staff, a programme administrator or a member of
 * the core team, is suspended and reinstated by a programme administrator only, because the
 * core team can hold `users.suspend` through an override. A call that asks for the status the account has already changes no
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
      const access = await readAccessDocument(db, actor, transaction);
      requireCapability(context, access, "users.suspend", "programme");
      if (input.uid === actor) {
        throw new AppError("permission-denied", "You cannot suspend or reinstate your own account.");
      }
      const draft = await draftAccess(db, transaction, input.uid, at);
      if (draft === null) {
        throw new AppError("not-found", "This account does not exist, or it has never started the portal.");
      }
      if (holdsProgrammeRole(draft.inputs.roleAssignments, at)) {
        requireProgrammeAdministrator(access, PROGRAMME_STAFF_ACCOUNT_MESSAGE);
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

    const outcome = await applyAccountStatus(input.uid, input.status);
    if (outcome === "noAccount") {
      context.logger.warn("the status of an account without an Authentication record was changed", { uid: input.uid });
    }
    return { uid: input.uid, status: input.status };
  },
});
