// The request of a generated document (docs/INTEGRATIONS.md, section 3.5): the document is
// created once for a template and a record, with the audience of its kind, and a job of the
// queue updates it. A person asks for one with `generateDocument`; an automation and a
// scheduled report ask in the same way, under an actor of their own.
import {
  COLLECTIONS,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateDoc,
  type DocumentTemplateKind,
  documentTemplateDocSchema,
  generatedDocumentDocSchema,
  generatedDocumentId,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  replicationScopeKey,
  type SyncRunDoc,
  systemActor,
  systemWriteContext,
  type WriteContext,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { AppError, type AuditActor, writeAudit } from "../../framework";
import { createdFields } from "../../framework/documents";
import { enqueueRun } from "./queue";

/**
 * The template a call names: by its key, or by its kind, the template of that kind for the kind
 * of record, preferring one in use. Those who manage a record do not read the templates, so they
 * name a kind.
 */
export async function templateOf(
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

export interface GenerationRequest {
  readonly template: { readonly key: string; readonly data: DocumentTemplateDoc };
  readonly entityType: "programme" | "replication" | "laboratory";
  readonly entityId: string;
  /** The name of the record, for the title of a new document. */
  readonly name: string;
  readonly actor: AuditActor;
  readonly trigger: SyncRunDoc["trigger"];
  /** The event, the schedule or the request that asks, which names the job. */
  readonly eventKey: string;
  /** The write context of the request, for a request that an automation makes. */
  readonly writeContext?: WriteContext;
  readonly at: Date;
}

/** Creates the generated document where it does not exist, and enqueues its update. */
export async function requestGeneration(
  db: Firestore,
  request: GenerationRequest,
): Promise<{ readonly generatedDocumentId: string; readonly runId: string; readonly created: boolean }> {
  const { template, at } = request;
  const id = generatedDocumentId(template.key, request.entityType, request.entityId);
  const reference = db.doc(COLLECTIONS.generatedDocuments.docPath(id));
  const actorName = request.actor.kind === "user" ? request.actor.uid : systemActor(request.actor.kind);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    const auditEventId = writeAudit(
      transaction,
      {
        action: "generatedDocument.requested",
        actor: request.actor,
        entityType: "generatedDocument",
        entityId: id,
        changes: [{ field: "templateKey", after: template.key }],
        at,
        ...(request.writeContext === undefined
          ? {}
          : {
              context: {
                depth: request.writeContext.depth,
                correlationId: request.writeContext.correlationId,
                causationId: request.writeContext.causationId,
              },
            }),
      },
      db,
    );
    if (existing.exists) return;
    // The audience of a kind: every member, or the record's team and programme staff alone for
    // a kind drawn from records that members outside the team may not read.
    const restricted = DOCUMENT_TEMPLATES[template.data.kind].audience === "team";
    const audience = restricted ? PROGRAMME_SCOPE_KEY : MEMBERS_SCOPE_KEY;
    const scope =
      request.entityType === "replication"
        ? {
            replicationId: request.entityId,
            laboratoryId: null,
            scopeKeys: [replicationScopeKey(request.entityId), audience],
          }
        : request.entityType === "laboratory"
          ? {
              replicationId: null,
              laboratoryId: request.entityId,
              scopeKeys: [laboratoryScopeKey(request.entityId), audience],
            }
          : { replicationId: null, laboratoryId: null, scopeKeys: [audience] };
    transaction.create(
      reference,
      generatedDocumentDocSchema.parse({
        ...createdFields("generatedDocuments", {
          at,
          actor: actorName,
          writeContext: {
            // A request that names no context is the caller's own, or the system's where the
            // actor is the system: an unattended request is never recorded as a person's.
            ...(request.writeContext ??
              (request.actor.kind === "user"
                ? { origin: "user" as const, depth: 0, correlationId: null, causationId: null }
                : systemWriteContext())),
            auditEventId,
          },
        }),
        templateKey: template.key,
        templateKind: template.data.kind,
        entityType: request.entityType,
        entityId: request.entityId,
        title: `${template.data.name}: ${request.name}`.slice(0, 300),
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
    trigger: request.trigger,
    eventKey: request.eventKey,
    requestedBy: actorName,
    at,
  });
  return { generatedDocumentId: id, runId, created };
}
