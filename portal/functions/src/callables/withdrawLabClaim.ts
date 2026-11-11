import { COLLECTIONS, labClaimDocSchema, parseStoredDocument, withdrawLabClaimContract } from "@eegml/shared";
import { AppError, callerStamp, defineCallable, NOT_ALLOWED_MESSAGE, touchedFields, writeAudit } from "../framework";

/**
 * Withdraws a request to represent or register a laboratory while it waits for review.
 *
 * | Caller                                | May withdraw                                     |
 * |---------------------------------------|--------------------------------------------------|
 * | The account that sent the request     | Its own request, while its status is `pendingReview` |
 *
 * Nobody else withdraws a request, a reviewer included: a reviewer rejects it instead. A caller
 * who did not send the request learns nothing about whether it exists. In one transaction the
 * status becomes `withdrawn` and the audit entry is written. A new request may follow.
 */
export const withdrawLabClaim = defineCallable(withdrawLabClaimContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.labClaims.docPath(input.claimId));

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const parsed = snapshot.exists ? parseStoredDocument(labClaimDocSchema, snapshot.data()) : null;
      if (parsed === null || !parsed.success || parsed.data.uid !== uid) {
        throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      }
      if (parsed.data.status === "withdrawn") return { claimId: input.claimId, status: "withdrawn" as const };
      if (parsed.data.status !== "pendingReview") {
        throw new AppError(
          "failed-precondition",
          "This request has been decided already, so it can no longer be withdrawn. Reload the page to see the decision.",
        );
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "labClaim.withdrawn",
          actor: { kind: "user", uid },
          entityType: "laboratory",
          entityId: parsed.data.laboratoryId,
          changes: [{ field: "status", before: "pendingReview", after: "withdrawn" }],
          at,
        },
        db,
      );
      transaction.update(reference, { status: "withdrawn", ...touchedFields(callerStamp(uid, at, auditEventId)) });
      return { claimId: input.claimId, status: "withdrawn" as const };
    });
  },
});
