import {
  COLLECTIONS,
  type CorrectionRequestDoc,
  correctionCanBeApplied,
  correctionRequestDocSchema,
  type PersonCorrectionApplicableField,
  parseStoredDocument,
  personDocSchema,
  resolveCorrectionRequestContract,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
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
 * sets them with the status in one transaction with the audit entry.
 *
 * With `apply`, an accepted request about a field that programme staff edit directly
 * (`PERSON_CORRECTION_APPLICABLE_FIELDS`) also sets the proposed value on the person, in the same
 * transaction, with the change in the audit entry. The value must fit the person's schema. Any
 * other detail is derived from other records or is an identity key, so accepting it records the
 * decision and the record is corrected where the detail comes from. A request that carries the
 * same outcome already is answered without a change.
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
      if (request.data.status === input.outcome) {
        return { requestId: input.requestId, status: input.outcome, applied: false };
      }
      if (request.data.status !== "open") {
        throw new AppError(
          "failed-precondition",
          "This correction request is not open any more. Reload the list of requests.",
        );
      }

      const applied = await plannedCorrection(db, transaction, request.data, input.apply === true);

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
            ...(applied === null ? [] : [{ field: applied.field, before: applied.before, after: applied.after }]),
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
      if (applied !== null) {
        transaction.update(applied.reference, { [applied.field]: applied.after, ...touchedFields(stamp) });
      }
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
              applied: applied !== null,
              ...(input.messageToRequester === undefined ? {} : { message: input.messageToRequester }),
            },
          },
          stamp,
        );
      }
      return { requestId: input.requestId, status: input.outcome, applied: applied !== null };
    });
  },
});

interface PlannedCorrection {
  readonly reference: DocumentReference;
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/**
 * The change that applying an accepted request makes to the person, read inside the
 * transaction, or null when the request is not to be applied. Refuses a field that cannot be
 * applied, a person who is missing or archived, and a value that does not fit the schema.
 */
async function plannedCorrection(
  db: Firestore,
  transaction: Transaction,
  request: CorrectionRequestDoc,
  apply: boolean,
): Promise<PlannedCorrection | null> {
  if (!apply) return null;
  if (!correctionCanBeApplied(request)) {
    throw new AppError(
      "failed-precondition",
      "This detail comes from other records and cannot be set here. Accept the report without applying it, and correct the record it comes from.",
    );
  }
  const reference = db.doc(COLLECTIONS.persons.docPath(request.entityId));
  const snapshot = await transaction.get(reference);
  const stored = snapshot.data();
  if (stored === undefined) throw new AppError("not-found", "The person of this report does not exist any more.");
  if (stored.archivedAt != null) {
    throw new AppError("failed-precondition", "This person is archived. Restore the record before you correct it.");
  }
  const after = typeof request.proposedValue === "string" ? request.proposedValue.trim() : request.proposedValue;
  const fits = personDocSchema.shape[request.field as PersonCorrectionApplicableField].safeParse(after);
  if (!fits.success || after === "") {
    throw new AppError(
      "invalid-argument",
      "The proposed value cannot be stored in this field as it is. Accept the report without applying it, and correct the record by hand.",
    );
  }
  return { reference, field: request.field, before: stored[request.field] ?? null, after: fits.data };
}
