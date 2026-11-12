import {
  COLLECTIONS,
  can,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateDoc,
  type DocumentTemplateKind,
  documentTemplateDocSchema,
  generateDocumentContract,
  generatedDocumentDocSchema,
  generatedDocumentId,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_KEY,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  replicationScopeKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireSecondFactor,
  writeAudit,
} from "../framework";
import { enqueueRun } from "../integrations/jobs/queue";

/**
 * The template a call names: by its key, or by its kind, the template of that kind for the kind
 * of record, preferring one in use. Those who manage a record do not read the templates, so they
 * name a kind.
 */
async function templateOf(
  db: Firestore,
  input: { readonly templateKey?: string; readonly kind?: DocumentTemplateKind; readonly entityType: string },
): Promise<{ readonly key: string; readonly data: DocumentTemplateDoc }> {
  if (input.templateKey !== undefined) {
    const parsed = parseStoredDocument(
      documentTemplateDocSchema,
      (await db.doc(COLLECTIONS.documentTemplates.docPath(input.templateKey)).get()).data(),
    );
    if (!parsed.success) throw new AppError("not-found", "This template is not registered.");
    return { key: input.templateKey, data: parsed.data };
  }
  const found = await db
    .collection(COLLECTIONS.documentTemplates.collectionPath())
    .where("kind", "==", input.kind)
    .limit(50)
    .get();
  const candidates = found.docs
    .flatMap((document) => {
      const parsed = parseStoredDocument(documentTemplateDocSchema, document.data());
      return parsed.success && parsed.data.archivedAt === null && parsed.data.entityType === input.entityType
        ? [{ key: document.id, data: parsed.data }]
        : [];
    })
    .sort((a, b) => Number(b.data.enabled) - Number(a.data.enabled) || a.key.localeCompare(b.key));
  const chosen = candidates[0];
  if (chosen === undefined) {
    throw new AppError(
      "failed-precondition",
      "No template of this kind is registered yet. An administrator of the integrations registers one.",
    );
  }
  return chosen;
}

/**
 * Creates or updates the generated document of a template for a record (docs/INTEGRATIONS.md,
 * section 3.5). For holders of `integrations.manage`, and for those who manage the record:
 * `replications.manage` for a replication, `labs.manage` for a laboratory. The document is
 * created once and updated in place by a queued job. It is read by the audience of its kind
 * (`DOCUMENT_TEMPLATES`): every member, or for recruitment, meetings and milestones the record's
 * team and programme staff alone, since their text draws on records that other members may not read.
 */
export const generateDocument = defineCallable(generateDocumentContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const access = await readAccessDocument(db, uid);
    requireSecondFactor(context, access);
    const manages =
      can(access, "integrations.manage", "programme") ||
      (input.entityType === "replication" && can(access, "replications.manage", { replicationId: input.entityId })) ||
      (input.entityType === "laboratory" && can(access, "labs.manage", { laboratoryId: input.entityId }));
    if (!manages) throw new AppError("permission-denied", "Your account is not allowed to do this.");
    const template = await templateOf(db, input);
    if (!template.data.enabled) {
      throw new AppError(
        "failed-precondition",
        "This template is switched off, so no document is written from it. An administrator of the integrations can switch it on.",
      );
    }
    if (template.data.entityType !== input.entityType) {
      throw new AppError("invalid-argument", "This template is for another kind of record.");
    }
    const entityPath =
      input.entityType === "replication"
        ? COLLECTIONS.replications.docPath(input.entityId)
        : input.entityType === "laboratory"
          ? COLLECTIONS.laboratories.docPath(input.entityId)
          : COLLECTIONS.programmes.docPath(input.entityId);
    const entity = await db.doc(entityPath).get();
    if (!entity.exists && !(input.entityType === "programme" && input.entityId === PROGRAMME_KEY)) {
      throw new AppError("not-found", "The record does not exist.");
    }
    const id = generatedDocumentId(template.key, input.entityType, input.entityId);
    const reference = db.doc(COLLECTIONS.generatedDocuments.docPath(id));
    const at = context.clock.now();
    const name = typeof entity.get("name") === "string" ? String(entity.get("name")) : input.entityId;
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "generatedDocument.requested",
          actor: { kind: "user", uid },
          entityType: "generatedDocument",
          entityId: id,
          changes: [{ field: "templateKey", after: template.key }],
          at,
        },
        db,
      );
      if (existing.exists) return;
      // The audience of a kind: every member, or the record's team and programme staff alone for
      // a kind drawn from records that members outside the team may not read.
      const restricted = DOCUMENT_TEMPLATES[template.data.kind].audience === "team";
      const audience = restricted ? PROGRAMME_SCOPE_KEY : MEMBERS_SCOPE_KEY;
      const scope =
        input.entityType === "replication"
          ? {
              replicationId: input.entityId,
              laboratoryId: null,
              scopeKeys: [replicationScopeKey(input.entityId), audience],
            }
          : input.entityType === "laboratory"
            ? {
                replicationId: null,
                laboratoryId: input.entityId,
                scopeKeys: [laboratoryScopeKey(input.entityId), audience],
              }
            : { replicationId: null, laboratoryId: null, scopeKeys: [audience] };
      transaction.create(
        reference,
        generatedDocumentDocSchema.parse({
          ...createdFields("generatedDocuments", callerStamp(uid, at, auditEventId)),
          templateKey: template.key,
          templateKind: template.data.kind,
          entityType: input.entityType,
          entityId: input.entityId,
          title: `${template.data.name}: ${name}`.slice(0, 300),
          managedSections: {},
          lastGeneratedAt: null,
          status: "pending",
          restricted,
          ...scope,
        }),
      );
    });
    const { runId, created } = await enqueueRun(db, {
      kind: "documentUpdate",
      generatedDocumentId: id,
      mode: template.data.mode,
      trigger: "manual",
      eventKey: `manual:${uid}:${at.getTime()}`,
      requestedBy: uid,
      at,
    });
    return { generatedDocumentId: id, runId, alreadyQueued: !created };
  },
});
