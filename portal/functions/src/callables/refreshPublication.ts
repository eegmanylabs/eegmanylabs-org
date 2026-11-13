import { refreshPublicationContract } from "@eegml/shared";
import { AppError, defineCallable, readAccessDocument, requireCapability } from "../framework";
import { PUBLISHING_NOT_CONFIGURED_MESSAGE, websiteRepository } from "../integrations/github/adapters";
import { alertIntegrationFailure } from "../notifications/alerts";
import { refreshBatch } from "../publishing/lifecycle";
import { gitHubFailure } from "../publishing/model";

/**
 * Reads the pull request of an export, or of its rollback, again, and records a merge or a
 * closing (requirement R14.5). Capability: `publishing.prepare` for the programme. The adapter
 * reads and never writes here. The scheduled `publicationsSweep` does the same every hour.
 */
export const refreshPublication = defineCallable(refreshPublicationContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "publishing.prepare", "programme");
    const repository = websiteRepository();
    if (repository === null) throw new AppError("failed-precondition", PUBLISHING_NOT_CONFIGURED_MESSAGE);
    try {
      return { status: await refreshBatch(db, repository, input.batchId, { kind: "user", uid }, at) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      await alertIntegrationFailure(db, "github", at);
      throw gitHubFailure(error);
    }
  },
});
