import {
  COLLECTIONS,
  datasetDocSchema,
  incidentDocSchema,
  parseStoredDocument,
  reportIncidentContract,
  unitScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, writeAudit } from "../framework";
import { governanceScope, requireDeviationsInScope, requireParticipationInScope } from "../scientific/model";

/**
 * Reports an incident of a replication or a laboratory (requirement R12.7). Capability:
 * `participations.manage` for the replication or the laboratory. A participation named belongs
 * to the scope, a dataset to the scope as well, and a deviation to a participation of the scope.
 * An incident of a participation belongs to its replication and its laboratory together.
 * The report never changes: what follows it is recorded with `recordIncidentAction`.
 */
export const reportIncident = defineCallable(reportIncidentContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.occurredAt > at.toISOString().slice(0, 10)) {
      throw new AppError(
        "invalid-argument",
        "An incident is reported once it has happened: its date is not in the future.",
      );
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const scope = await governanceScope(db, transaction, context, access, input.scopeType, input.scopeId, {
        replication: "participations.manage",
        laboratory: "participations.manage",
        programme: "participations.manage",
      });
      // An incident of a participation belongs to both its replication and its laboratory, so
      // the team of each reads it.
      let fields = scope;
      if (input.participationId !== null) {
        const participation = await requireParticipationInScope(db, transaction, input.participationId, scope);
        fields = {
          replicationId: participation.replicationId,
          laboratoryId: participation.laboratoryId,
          scopeKeys: unitScopeKeys(participation.replicationId, participation.laboratoryId),
        };
      }
      if (input.datasetId !== null) {
        const dataset = parseStoredDocument(
          datasetDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.datasets.docPath(input.datasetId)))).data(),
        );
        const inScope =
          dataset.success &&
          ((scope.replicationId !== null && dataset.data.replicationId === scope.replicationId) ||
            (scope.laboratoryId !== null && dataset.data.laboratoryId === scope.laboratoryId));
        if (!inScope)
          throw new AppError("invalid-argument", "The dataset named is not one of this replication or laboratory.");
      }
      await requireDeviationsInScope(db, transaction, input.deviations, scope);

      const reference = db.collection(COLLECTIONS.incidents.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "incident.reported",
          actor: { kind: "user", uid: context.uid },
          entityType: "incident",
          entityId: reference.id,
          changes: [
            { field: "severity", after: input.severity },
            { field: "occurredAt", after: input.occurredAt },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.create(
        reference,
        incidentDocSchema.parse({
          schemaVersion: COLLECTIONS.incidents.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: context.uid,
          writeContext: stamp.writeContext,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          title: input.title,
          description: input.description,
          severity: input.severity,
          occurredAt: input.occurredAt,
          reportedBy: context.uid,
          ...(input.participationId === null ? {} : { participationId: input.participationId }),
          ...(input.datasetId === null ? {} : { datasetId: input.datasetId }),
          deviations: input.deviations,
          ...fields,
        }),
      );
      return { incidentId: reference.id };
    });
  },
});
