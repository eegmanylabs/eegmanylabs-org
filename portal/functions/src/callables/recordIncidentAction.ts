import {
  COLLECTIONS,
  incidentActionDocSchema,
  incidentDocSchema,
  parseStoredDocument,
  personDocSchema,
  recordIncidentActionContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";

/**
 * Appends an action to an incident (requirement R12.7): a corrective action with its owner and
 * the date by which it is due, a change of status, a note, or a correction of the report or of an
 * earlier action. Capability: `participations.manage` for the replication or the laboratory of the
 * incident. Nothing
 * earlier changes, so the registry keeps what was said and when, and the current state is read
 * from the actions in order.
 */
export const recordIncidentAction = defineCallable(recordIncidentActionContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const needs = {
      correctiveAction: input.text !== null && input.status === null && input.correctedReport === null,
      statusChange: input.status !== null && input.correctedReport === null && input.correctsActionId === null,
      note:
        input.text !== null &&
        input.status === null &&
        input.correctedReport === null &&
        input.correctsActionId === null,
      correction:
        input.status === null &&
        ((input.correctsActionId !== null && input.text !== null && input.correctedReport === null) ||
          (input.correctsActionId === null &&
            input.correctedReport !== null &&
            Object.keys(input.correctedReport).length > 0)),
    } as const;
    if (!needs[input.kind]) {
      throw new AppError(
        "invalid-argument",
        "A corrective action and a note state a text, a change of status states the status, and a correction replaces an earlier action with a text or fields of the report.",
      );
    }
    if (input.kind === "correctiveAction" && input.correctsActionId !== null) {
      throw new AppError("invalid-argument", "Record a change to a corrective action as a correction.");
    }
    if (input.kind !== "correctiveAction" && (input.ownerPersonId !== null || input.dueDate !== null)) {
      throw new AppError("invalid-argument", "An owner and a due date belong to a corrective action.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const incident = parseStoredDocument(
        incidentDocSchema,
        (await transaction.get(db.doc(COLLECTIONS.incidents.docPath(input.incidentId)))).data(),
      );
      if (!incident.success) throw new AppError("not-found", "This incident does not exist.");
      const { replicationId, laboratoryId, scopeKeys } = incident.data;
      // The managers of either unit of the incident follow it up: an incident of a participation
      // belongs to its replication and its laboratory.
      requireCapability(context, access, "participations.manage", { replicationId, laboratoryId });
      if (input.correctsActionId !== null) {
        const earlier = await transaction.get(
          db.doc(COLLECTIONS.incidentActions.docPath(input.incidentId, input.correctsActionId)),
        );
        if (!earlier.exists)
          throw new AppError("invalid-argument", "The action corrected is not one of this incident.");
      }
      if (input.ownerPersonId !== null) {
        const owner = parseStoredDocument(
          personDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.persons.docPath(input.ownerPersonId)))).data(),
        );
        if (!owner.success) throw new AppError("invalid-argument", "The owner named is not in the directory.");
      }

      const reference = db.collection(COLLECTIONS.incidentActions.collectionPath(input.incidentId)).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "incident.actionRecorded",
          actor: { kind: "user", uid: context.uid },
          entityType: "incident",
          entityId: input.incidentId,
          changes: [
            { field: "actionId", after: reference.id },
            { field: "kind", after: input.kind },
            ...(input.status === null ? [] : [{ field: "status", after: input.status }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.create(
        reference,
        incidentActionDocSchema.parse({
          schemaVersion: COLLECTIONS.incidentActions.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: context.uid,
          writeContext: stamp.writeContext,
          incidentId: input.incidentId,
          kind: input.kind,
          ...(input.text === null ? {} : { text: input.text }),
          ...(input.status === null ? {} : { status: input.status }),
          ...(input.ownerPersonId === null ? {} : { ownerPersonId: input.ownerPersonId }),
          ...(input.dueDate === null ? {} : { dueDate: input.dueDate }),
          ...(input.correctsActionId === null ? {} : { correctsActionId: input.correctsActionId }),
          ...(input.correctedReport === null ? {} : { correctedReport: input.correctedReport }),
          recordedBy: context.uid,
          replicationId,
          laboratoryId,
          scopeKeys,
        }),
      );
      return { actionId: reference.id };
    });
  },
});
