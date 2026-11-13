import { proposePublicationRollbackContract } from "@eegml/shared";
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
import { MAIN_BRANCH, PORTAL_BRANCH_PREFIX } from "../integrations/github/types";
import { alertIntegrationFailure } from "../notifications/alerts";
import { gitHubFailure, readBatch, readBatchFiles } from "../publishing/model";

/**
 * Proposes the rollback of a published export (requirement R14.5): a pull request that
 * restores every file the export replaced, and removes every file it created, from the texts the
 * log kept. Capability: `publishing.approve` for the programme, with the second factor wherever
 * the access document requires one. It is a proposal: a maintainer merges it, as the README's
 * route for a revert asks. Where a file on the main branch is no longer the file the export
 * wrote, someone has changed it since, and nothing is proposed, so that their change is not
 * undone with it; a maintainer reverts the merge by hand then.
 */
export const proposePublicationRollback = defineCallable(proposePublicationRollbackContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "publishing.approve", "programme");
    const batch = await readBatch(db, input.batchId);
    if (batch.data.status !== "published") {
      throw new AppError("failed-precondition", "Only a published export can be rolled back.");
    }
    if (batch.data.rollbackPullRequestNumber !== undefined) {
      throw new AppError("failed-precondition", "A rollback of this export is proposed already.");
    }
    const repository = websiteRepository();
    if (repository === null) throw new AppError("failed-precondition", PUBLISHING_NOT_CONFIGURED_MESSAGE);
    const files = (await readBatchFiles(db, batch.id)).filter((file) => file.diff.bytesChanged);
    const branch = `${PORTAL_BRANCH_PREFIX}${batch.id}-rollback`;
    let pull: Awaited<ReturnType<typeof repository.openPullRequest>>;
    try {
      const open = await repository.openPullRequests(PORTAL_BRANCH_PREFIX);
      if (open.length > 0) {
        throw new AppError(
          "failed-precondition",
          `Pull request #${open[0]?.number} is still open. Only one publishing pull request is open at a time.`,
        );
      }
      const head = await repository.branchHead(MAIN_BRANCH);
      for (const file of files) {
        if ((await repository.readFile(file.path, head)) !== file.content) {
          throw new AppError(
            "failed-precondition",
            `${file.path} has changed on the website since this export was published. Nothing was proposed; a maintainer reverts the merge as the website's README describes.`,
          );
        }
      }
      await repository.createBranch(branch, head);
      await repository.commitFiles(
        branch,
        head,
        files.map((file) => ({ path: file.path, content: file.baseContent })),
        `Roll back export ${batch.id} from the members' portal: ${input.reason}`,
      );
      pull = await repository.openPullRequest({
        head: branch,
        base: MAIN_BRANCH,
        title: `Roll back a publication from the members' portal (export ${batch.id})`,
        body: [
          "## Purpose",
          "",
          `Restores the files that export ${batch.id} replaced, as the portal's publishing log kept them.`,
          "",
          `Reason: ${input.reason}`,
          "",
          "## Files changed",
          "",
          ...files.map(
            (file) => `- \`${file.path}\`${file.baseContent === null ? " (removed: the export created it)" : ""}`,
          ),
        ].join("\n"),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      await alertIntegrationFailure(db, "github", at);
      throw gitHubFailure(error);
    }
    await db.runTransaction(async (transaction) => {
      const current = await readBatch(db, batch.id, transaction);
      const auditEventId = writeAudit(
        transaction,
        {
          action: "publication.rollbackProposed",
          actor: { kind: "user", uid },
          entityType: "publicationBatch",
          entityId: batch.id,
          changes: [{ field: "rollbackPullRequestUrl", after: pull.url }],
          at,
        },
        db,
      );
      transaction.update(current.reference, {
        rollbackPullRequestNumber: pull.number,
        rollbackPullRequestUrl: pull.url,
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
    });
    return { pullRequestUrl: pull.url, pullRequestNumber: pull.number };
  },
});
