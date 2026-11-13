import { approvePublicationContract } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
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
import { GitHubError, MAIN_BRANCH, PORTAL_BRANCH_PREFIX } from "../integrations/github/types";
import { portalAddress } from "../integrations/jobs/live";
import { alertIntegrationFailure } from "../notifications/alerts";
import { gitHubFailure, pullRequestBody, readBatch, readBatchFiles } from "../publishing/model";

/**
 * Approves the live write of an export (requirements R14.3 and R14.5). Capability:
 * `publishing.approve` for the programme, which the core team does not hold by default, with
 * the second factor wherever the access document requires one. The export must have been built
 * in a scratch copy and have passed its checks, and the approver states the hash of the files
 * they saw, which must be the files that were built. Then, through the website adapter, a branch
 * is made from the commit the preview was compared with, the files are committed to it and a
 * pull request is opened, which deploys the shared staging site. The adapter never merges. Only
 * one publishing pull request is open at a time, because every pull request redeploys the one
 * staging site; and where the main branch moved since the preview, nothing is written and a new
 * export is needed, so a change made meanwhile is never overwritten.
 */
export const approvePublication = defineCallable(approvePublicationContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "publishing.approve", "programme");
    const batch = await readBatch(db, input.batchId);
    if (batch.data.status !== "verified" || batch.data.verification?.passed !== true) {
      throw new AppError(
        "failed-precondition",
        "Only an export whose staging build passed its checks can be approved.",
      );
    }
    if (
      batch.data.verification.payloadSha256 !== batch.data.payloadSha256 ||
      input.payloadSha256 !== batch.data.payloadSha256
    ) {
      throw new AppError(
        "failed-precondition",
        "The files you approved are not the files that were built. Open the export again and review it.",
      );
    }
    const repository = websiteRepository();
    if (repository === null) throw new AppError("failed-precondition", PUBLISHING_NOT_CONFIGURED_MESSAGE);
    const files = await readBatchFiles(db, batch.id);
    const branch = `${PORTAL_BRANCH_PREFIX}${batch.id}`;
    let commitRef: string;
    let pull: Awaited<ReturnType<typeof repository.openPullRequest>>;
    try {
      const open = await repository.openPullRequests(PORTAL_BRANCH_PREFIX);
      if (open.length > 0) {
        throw new AppError(
          "failed-precondition",
          `Pull request #${open[0]?.number} of an earlier export is still open. Only one publishing pull request is open at a time, because each one redeploys the shared staging site.`,
        );
      }
      if ((await repository.branchHead(MAIN_BRANCH)) !== batch.data.baseCommit) {
        throw new AppError(
          "failed-precondition",
          "The website changed after this export was prepared. Nothing was written; prepare a new export so that the preview shows the website as it is.",
        );
      }
      try {
        await repository.createBranch(branch, batch.data.baseCommit);
      } catch (error) {
        // A branch left by an approval that failed half-way is used again only where it is untouched.
        if (!(error instanceof GitHubError && error.kind === "conflict")) throw error;
        if ((await repository.branchHead(branch)) !== batch.data.baseCommit) throw error;
      }
      const changed = files.filter((file) => file.diff.bytesChanged);
      commitRef = await repository.commitFiles(
        branch,
        batch.data.baseCommit,
        changed.map((file) => ({ path: file.path, content: file.content })),
        `Publish from the members' portal: ${batch.data.outputs.join(", ")} (export ${batch.id})`,
      );
      pull = await repository.openPullRequest({
        head: branch,
        base: MAIN_BRANCH,
        title: `${batch.data.syntheticData ? "[Synthetic, do not merge] " : ""}Publish from the members' portal: ${batch.data.outputs.join(", ")}`,
        body: pullRequestBody(batch, files, portalAddress()),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      await alertIntegrationFailure(db, "github", at);
      throw gitHubFailure(error);
    }

    await db.runTransaction(async (transaction) => {
      const current = await readBatch(db, batch.id, transaction);
      if (current.data.status !== "verified") {
        throw new AppError("failed-precondition", "The export changed while it was being approved.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "publication.approved",
          actor: { kind: "user", uid },
          entityType: "publicationBatch",
          entityId: batch.id,
          changes: [
            { field: "status", before: "verified", after: "staged" },
            { field: "pullRequestUrl", after: pull.url },
            { field: "payloadSha256", after: batch.data.payloadSha256 },
          ],
          at,
        },
        db,
      );
      transaction.update(current.reference, {
        status: "staged",
        approvedBy: uid,
        approvedAt: Timestamp.fromDate(at),
        branch,
        commitRef,
        pullRequestNumber: pull.number,
        pullRequestUrl: pull.url,
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
    });
    return { pullRequestUrl: pull.url, pullRequestNumber: pull.number };
  },
});
