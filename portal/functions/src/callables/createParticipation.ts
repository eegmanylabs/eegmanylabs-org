import {
  COLLECTIONS,
  checklistTemplateDocSchema,
  createParticipationContract,
  ONBOARDING_TEMPLATE_KEY,
  parseStoredDocument,
  participationChecklistItemDocSchema,
  participationDetailDocSchema,
  participationDocSchema,
  participationId as participationIdOf,
  unitScopeKeys,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  writeAudit,
} from "../framework";
import { writeParticipationHistory } from "../participations/history";

/**
 * Creates the participation of a laboratory in a replication (decision D-008). The security
 * rules let no client create one, so the checklist, the restricted detail and the first entry of
 * the status history always exist beside it.
 *
 * | Caller                                                        | May create                    |
 * |---------------------------------------------------------------|-------------------------------|
 * | A holder of `participations.manage` for the replication       | A participation as `invited`: the leads of the replication, the core team and programme administrators, with the second factor where the access document requires one |
 * | A holder of `participations.manage` for the laboratory        | A participation as `interested`: the coordinators of the laboratory, the core team and programme administrators. What follows is decided by the replication (`PARTICIPATION_TRANSITIONS`) |
 *
 * The participation takes the identifier that joins the replication and the laboratory, so a
 * second participation of the same pair is refused as a duplicate and nothing is written. In one
 * transaction the function writes the participation, its restricted detail with ethics and
 * training unknown, one item of the onboarding checklist for each item of the configured
 * template, whose label and position are copied at this moment, the first entry of the status
 * history and the audit entry.
 */
export const createParticipation = defineCallable(createParticipationContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const { replicationId, laboratoryId } = input;
    const status = input.status ?? "invited";
    const participationId = participationIdOf(replicationId, laboratoryId);
    const participationReference = db.doc(COLLECTIONS.participations.docPath(participationId));
    const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(
        context,
        access,
        "participations.manage",
        status === "invited" ? { replicationId } : { laboratoryId },
      );
      const [existing, replication, laboratory, template, localLead] = await transaction.getAll(
        participationReference,
        db.doc(COLLECTIONS.replications.docPath(replicationId)),
        db.doc(COLLECTIONS.laboratories.docPath(laboratoryId)),
        db.doc(COLLECTIONS.checklistTemplates.docPath(ONBOARDING_TEMPLATE_KEY)),
        ...(input.localLeadPersonId === undefined
          ? []
          : [db.doc(COLLECTIONS.persons.docPath(input.localLeadPersonId))]),
      );
      if (existing === undefined || replication === undefined || laboratory === undefined || template === undefined) {
        throw new Error("The transaction returned no snapshot.");
      }
      if (existing.exists) {
        throw new AppError(
          "already-exists",
          "This laboratory takes part in this replication already. Open its participation to change it.",
        );
      }
      if (!replication.exists || replication.get("archivedAt") != null) {
        throw new AppError("not-found", "This replication does not exist or is archived.");
      }
      if (!laboratory.exists || laboratory.get("archivedAt") != null) {
        throw new AppError("not-found", "This laboratory does not exist or is archived.");
      }
      if (localLead !== undefined && (!localLead.exists || localLead.get("archivedAt") != null)) {
        throw new AppError(
          "invalid-argument",
          "The local lead is not a person in the directory. Choose another person.",
        );
      }
      const parsedTemplate = template.exists ? parseStoredDocument(checklistTemplateDocSchema, template.data()) : null;
      if (parsedTemplate === null || !parsedTemplate.success || parsedTemplate.data.archivedAt !== null) {
        throw new AppError(
          "failed-precondition",
          "The onboarding checklist is not configured, so no participation can be created. Ask a programme administrator to install the lookup data.",
        );
      }
      const items = parsedTemplate.data.items;

      const auditEventId = writeAudit(
        transaction,
        {
          action: "participation.created",
          actor: { kind: "user", uid },
          entityType: "participation",
          entityId: participationId,
          changes: [
            { field: "status", after: status },
            { field: "localLeadPersonId", after: input.localLeadPersonId ?? null },
            { field: "targetNMain", after: input.targetNMain ?? null },
            { field: "targetNRest", after: input.targetNRest ?? null },
            { field: "checklistItems", after: items.length },
            ...(input.reason === undefined ? [] : [{ field: "reason", after: input.reason }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const scope = { replicationId, laboratoryId, scopeKeys: unitScopeKeys(replicationId, laboratoryId) };
      transaction.create(
        participationReference,
        participationDocSchema.parse({
          ...createdFields("participations", stamp),
          ...scope,
          ...(input.localLeadPersonId === undefined ? {} : { localLeadPersonId: input.localLeadPersonId }),
          status,
          statusHistoryId: historyReference.id,
          ...(input.targetNMain === undefined ? {} : { targetNMain: input.targetNMain }),
          ...(input.targetNRest === undefined ? {} : { targetNRest: input.targetNRest }),
          readinessStatus: "notStarted",
          custom: {},
          dataOrigin: "live",
        }),
      );
      transaction.create(
        db.doc(COLLECTIONS.participationDetail.docPath(participationId)),
        participationDetailDocSchema.parse({
          ...createdFields("participationDetail", stamp),
          ethicsStatus: "unknown",
          trainingStatus: "unknown",
          readinessApprovedBy: null,
          readinessApprovedAt: null,
        }),
      );
      items.forEach((item, position) => {
        transaction.create(
          db.doc(COLLECTIONS.participationChecklist.docPath(participationId, item.key)),
          participationChecklistItemDocSchema.parse({
            ...createdFields("participationChecklist", stamp),
            participationId,
            templateKey: parsedTemplate.data.key,
            templateItemKey: item.key,
            label: item.label,
            status: "notStarted",
            completedBy: null,
            completedAt: null,
            position,
            ...scope,
          }),
        );
      });
      writeParticipationHistory(
        transaction,
        historyReference,
        { participationId, replicationId, laboratoryId, from: null, to: status, reason: input.reason },
        stamp,
      );
      return {
        participationId,
        status,
        statusHistoryId: historyReference.id,
        checklistItems: items.length,
      };
    });
  },
});
