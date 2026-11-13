import { withdrawPublicationContract } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { PUBLISHING_NOT_CONFIGURED_MESSAGE, websiteRepository } from "../integrations/github/adapters";
import { alertIntegrationFailure } from "../notifications/alerts";
import { gitHubFailure, readBatch } from "../publishing/model";

/**
 * Withdraws an export that is not published (requirement R14.5). Capability:
 * `publishing.prepare` for the programme. Where its pull request is open, the adapter closes it
 * without merging, which is the one change the portal makes to a pull request after opening it.
 * The export stays in the log with the reason.
 */
export const withdrawPublication = defineCallable(withdrawPublicationContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "publishing.prepare", "programme");
    const batch = await readBatch(db, input.batchId);
    if (!["previewed", "verified", "staged"].includes(batch.data.status)) {
      throw new AppError("failed-precondition", "Only an export that is not published yet can be withdrawn.");
    }
    if (batch.data.status === "staged" && batch.data.pullRequestNumber !== undefined) {
      const repository = websiteRepository();
      if (repository === null) throw new AppError("failed-precondition", PUBLISHING_NOT_CONFIGURED_MESSAGE);
      try {
        await repository.closePullRequest(batch.data.pullRequestNumber);
      } catch (error) {
        await alertIntegrationFailure(db, "github", at);
        throw gitHubFailure(error);
      }
    }
    await db.runTransaction(async (transaction) => {
      const current = await readBatch(db, batch.id, transaction);
      if (current.data.status !== batch.data.status) {
        throw new AppError("failed-precondition", "The export changed while it was being withdrawn.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "publication.withdrawn",
          actor: { kind: "user", uid },
          entityType: "publicationBatch",
          entityId: batch.id,
          changes: [{ field: "status", before: batch.data.status, after: "withdrawn" }],
          at,
        },
        db,
      );
      transaction.update(current.reference, {
        status: "withdrawn",
        statusReason: input.reason,
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
    });
    return { status: "withdrawn" as const };
  },
});
