import {
  COLLECTIONS,
  DOCUMENT_TEMPLATES,
  documentTemplateDocSchema,
  parseStoredDocument,
  saveDocumentTemplateContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";
import { DOCS_MIME_TYPE, DRIVE_FOLDER_MIME_TYPE } from "../integrations/google/types";
import { recordHealth } from "../integrations/jobs/health";
import { interactiveAdapters, requireIntegrationsManager } from "../integrations/support";

/**
 * Registers or changes a document template (docs/INTEGRATIONS.md, section 3.5), for holders of
 * `integrations.manage`. The template must be a Google Doc and the target a folder of a shared
 * drive, both open to the portal's account, because the account cannot own the copies it makes
 * anywhere else. Moving a template to live writes is a programme administrator's act alone.
 */
export const saveDocumentTemplate = defineCallable(saveDocumentTemplateContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const definition = DOCUMENT_TEMPLATES[input.kind];
    const { adapters } = interactiveAdapters();
    const [template, folder] = await Promise.all([
      adapters.drive.getFile(input.externalDocumentId).catch(() => null),
      adapters.drive.getFile(input.targetFolderId).catch(() => null),
    ]);
    if (template === null || template.mimeType !== DOCS_MIME_TYPE) {
      throw new AppError("failed-precondition", "The template is not a Google Doc that the portal's account can open.");
    }
    if (folder === null || folder.mimeType !== DRIVE_FOLDER_MIME_TYPE || folder.driveId === undefined) {
      throw new AppError(
        "failed-precondition",
        "The target is not a folder of a shared drive that the portal's account can open.",
      );
    }
    const reference = db.doc(COLLECTIONS.documentTemplates.docPath(input.key));
    const at = context.clock.now();
    const created = await db.runTransaction(async (transaction) => {
      const access = await requireIntegrationsManager(db, context, transaction);
      const existing = parseStoredDocument(documentTemplateDocSchema, (await transaction.get(reference)).data());
      const wasLive = existing.success && existing.data.mode === "live";
      if (input.mode === "live" && !wasLive) {
        requireProgrammeAdministrator(access, "Only a programme administrator approves live writes of a template.");
      }
      if (existing.success && existing.data.kind !== input.kind) {
        throw new AppError("invalid-argument", "The kind of a template never changes. Register another template.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "documentTemplate.saved",
          actor: { kind: "user", uid },
          entityType: "documentTemplate",
          entityId: input.key,
          changes: [
            { field: "enabled", before: existing.success ? existing.data.enabled : null, after: input.enabled },
            { field: "mode", before: existing.success ? existing.data.mode : null, after: input.mode },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const fields = {
        name: input.name,
        externalDocumentId: input.externalDocumentId,
        targetFolderId: input.targetFolderId,
        enabled: input.enabled,
        mode: input.mode,
        ...(input.mode === "live" && !wasLive ? { approvedBy: uid, approvedAt: Timestamp.fromDate(at) } : {}),
        ...(input.mode === "dryRun" ? { approvedBy: null, approvedAt: null } : {}),
      };
      if (existing.success) {
        transaction.update(reference, { ...fields, ...touchedFields(stamp) });
        return false;
      }
      transaction.create(
        reference,
        documentTemplateDocSchema.parse({
          ...createdFields("documentTemplates", stamp),
          key: input.key,
          kind: input.kind,
          entityType: definition.entityType,
          managedSections: definition.sections.map((section) => section.name),
          approvedBy: null,
          approvedAt: null,
          ...fields,
        }),
      );
      return true;
    });
    await recordHealth(db, "googleDocs", { kind: "success" }, at);
    return { key: input.key, created };
  },
});
