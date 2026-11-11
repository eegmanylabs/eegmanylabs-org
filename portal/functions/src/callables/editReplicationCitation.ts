import { COLLECTIONS, editReplicationCitationContract, parseStoredDocument, replicationDocSchema } from "@eegml/shared";
import { FieldValue } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

const INVALID_MESSAGE = "This value does not fit the field. Check it and save again.";

/**
 * Changes one field of a citation that has been checked. The security rules refuse a client
 * change to the citation of the original study while `citationStatus` says anything but
 * `unverified`, so that a badge that says verified always describes the citation that was
 * checked.
 *
 * | Caller                                                | May change                         |
 * |-------------------------------------------------------|------------------------------------|
 * | A holder of `replications.manage` for the replication | One citation field: the leads of the replication, the core team and programme administrators, with the second factor where the access document requires one |
 *
 * In one transaction the field changes, `citationStatus` returns to `unverified`, the time,
 * source and metadata of the check are removed and the audit entry is written. A citation that
 * is unverified already is changed in the same way, which the rules also allow a client. An
 * archived replication is frozen.
 */
export const editReplicationCitation = defineCallable(editReplicationCitationContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.replications.docPath(input.replicationId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(context, access, "replications.manage", { replicationId: input.replicationId });
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists ? parseStoredDocument(replicationDocSchema, snapshot.data()) : null;
      if (stored === null || !stored.success) throw new AppError("not-found", "This replication does not exist.");
      if (stored.data.archivedAt !== null) {
        throw new AppError("failed-precondition", "This replication is archived, so its citation cannot change.");
      }
      const {
        citationCheckedAt: _checkedAt,
        citationSource: _source,
        citationMetadata: _metadata,
        [input.field]: before,
        ...kept
      } = stored.data;
      const next = {
        ...kept,
        citationStatus: "unverified",
        ...(input.value === null ? {} : { [input.field]: input.value }),
      };
      if (!replicationDocSchema.safeParse(next).success) throw new AppError("invalid-argument", INVALID_MESSAGE);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "replication.citationEdited",
          actor: { kind: "user", uid },
          entityType: "replication",
          entityId: input.replicationId,
          changes: [
            { field: input.field, before: before ?? null, after: input.value },
            { field: "citationStatus", before: stored.data.citationStatus, after: "unverified" },
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        [input.field]: input.value === null ? FieldValue.delete() : input.value,
        citationStatus: "unverified",
        citationCheckedAt: FieldValue.delete(),
        citationSource: FieldValue.delete(),
        citationMetadata: FieldValue.delete(),
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
      return { replicationId: input.replicationId, citationStatus: "unverified" as const };
    });
  },
});
