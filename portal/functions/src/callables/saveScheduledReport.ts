import {
  COLLECTIONS,
  documentTemplateDocSchema,
  parseStoredDocument,
  saveScheduledReportContract,
  scheduledReportDocSchema,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { reportEntityExists, sortRecipients } from "../reports/recipients";

/**
 * Creates or changes a scheduled progress report (requirement R15.7). Capability:
 * `automations.manage` for the programme. The template must be registered and be for the kind of
 * record the report names, the record must exist and not be archived, and every recipient must be
 * a member in good standing who may read the document the report updates (`reports/recipients`); whether its documents are written live or as a dry run is the
 * template's own setting, which the administrators of the integrations approve.
 */
export const saveScheduledReport = defineCallable(saveScheduledReportContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "automations.manage", "programme");
    const template = parseStoredDocument(
      documentTemplateDocSchema,
      (await db.doc(COLLECTIONS.documentTemplates.docPath(input.templateKey)).get()).data(),
    );
    if (!template.success) throw new AppError("not-found", "This template is not registered.");
    if (template.data.entityType !== input.entityType) {
      throw new AppError("invalid-argument", "This template is for another kind of record.");
    }
    if (input.entityType !== "programme" && input.entityType !== "replication" && input.entityType !== "laboratory") {
      throw new AppError(
        "invalid-argument",
        "A scheduled report is about the programme, a replication or a laboratory.",
      );
    }
    if (!(await reportEntityExists(db, input.entityType, input.entityId))) {
      throw new AppError("invalid-argument", "The record this report is about does not exist or is archived.");
    }
    const { refused } = await sortRecipients(db, input.recipients, template.data, input.entityType, input.entityId);
    if (refused.length > 0) {
      throw new AppError(
        "invalid-argument",
        `${refused.length === 1 ? "One recipient is" : `${refused.length} recipients are`} not a member in good standing who may read this report. Choose recipients from the members who can read it.`,
      );
    }
    const collection = db.collection(COLLECTIONS.scheduledReports.collectionPath());
    const reference = input.reportId === undefined ? collection.doc() : collection.doc(input.reportId);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (input.reportId !== undefined && !existing.exists)
        throw new AppError("not-found", "This report does not exist.");
      const auditEventId = writeAudit(
        transaction,
        {
          action: "scheduledReport.saved",
          actor: { kind: "user", uid },
          entityType: "scheduledReport",
          entityId: reference.id,
          changes: [
            { field: "schedule", after: input.schedule },
            { field: "enabled", after: input.enabled },
            { field: "recipients", after: input.recipients.length },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const fields = {
        name: input.name,
        definition: { templateKey: input.templateKey, entityType: input.entityType, entityId: input.entityId },
        schedule: input.schedule,
        recipients: [...new Set(input.recipients)],
        enabled: input.enabled,
      };
      if (existing.exists) transaction.update(reference, { ...fields, ...touchedFields(stamp) });
      else {
        transaction.create(
          reference,
          scheduledReportDocSchema.parse({
            ...createdFields("scheduledReports", stamp),
            ...fields,
            lastRunAt: null,
            lastPeriod: null,
          }),
        );
      }
    });
    return { reportId: reference.id };
  },
});
