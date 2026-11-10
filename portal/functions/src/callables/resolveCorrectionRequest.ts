import {
  COLLECTIONS,
  correctionRequestDocSchema,
  parseStoredDocument,
  resolveCorrectionRequestContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";

/**
 * Records the outcome of a correction request and notifies whoever made it. Capability:
 * `people.manage`, with the second factor wherever the caller's access document requires one.
 *
 * Members create correction requests directly, under the security rules, and may withdraw one
 * that is still open. The rules reserve `resolvedBy` and `resolvedAt` for this function, which
 * sets them with the status in one transaction with the audit entry. It records the decision
 * and does not edit the record: whoever accepts a request makes the correction itself where
 * they may. A request that carries the same outcome already is answered without a change.
 */
export const resolveCorrectionRequest = defineCallable(resolveCorrectionRequestContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.correctionRequests.docPath(input.requestId));

    return db.runTransaction(async (transaction) => {
      requireCapability(context, await readAccessDocument(db, actor, transaction), "people.manage", "programme");
      const snapshot = await transaction.get(reference);
      const request = snapshot.exists ? parseStoredDocument(correctionRequestDocSchema, snapshot.data()) : null;
      if (request === null) throw new AppError("not-found", "This correction request does not exist.");
      if (!request.success) throw request.error;
      if (request.data.status === input.outcome) return { requestId: input.requestId, status: input.outcome };
      if (request.data.status !== "open") {
        throw new AppError(
          "failed-precondition",
          "This correction request is not open any more. Reload the list of requests.",
        );
      }

      const auditEventId = writeAudit(
        transaction,
        {
          action: "correction.resolved",
          actor: { kind: "user", uid: actor },
          entityType: request.data.entityType,
          entityId: request.data.entityId,
          changes: [
            ...withheldChanges(["status", "resolvedBy", "resolvedAt"]),
            { field: "outcome", after: input.outcome },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);
      transaction.update(reference, {
        status: input.outcome,
        resolvedBy: actor,
        resolvedAt: Timestamp.fromDate(at),
        ...touchedFields(stamp),
      });
      if (request.data.uid !== actor) {
        writeNotification(
          db,
          transaction,
          {
            uid: request.data.uid,
            type: "statusChange",
            entityType: request.data.entityType,
            entityId: request.data.entityId,
            eventId: auditEventId,
            payload: {
              kind: "correctionResolved",
              requestId: input.requestId,
              field: request.data.field,
              outcome: input.outcome,
              ...(input.messageToRequester === undefined ? {} : { message: input.messageToRequester }),
            },
          },
          stamp,
        );
      }
      return { requestId: input.requestId, status: input.outcome };
    });
  },
});
