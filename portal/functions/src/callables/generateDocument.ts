import { COLLECTIONS, can, generateDocumentContract, PROGRAMME_KEY } from "@eegml/shared";
import { AppError, defineCallable, readAccessDocument, requireSecondFactor } from "../framework";
import { requestGeneration, templateOf } from "../integrations/jobs/generation";

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
    const at = context.clock.now();
    const {
      generatedDocumentId: id,
      runId,
      created,
    } = await requestGeneration(db, {
      template,
      entityType: input.entityType,
      entityId: input.entityId,
      name: typeof entity.get("name") === "string" ? String(entity.get("name")) : input.entityId,
      actor: { kind: "user", uid },
      trigger: "manual",
      eventKey: `manual:${uid}:${at.getTime()}`,
      at,
    });
    return { generatedDocumentId: id, runId, alreadyQueued: !created };
  },
});
