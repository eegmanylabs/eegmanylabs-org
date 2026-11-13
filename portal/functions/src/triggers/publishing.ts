// The schedule of publishing (docs/INTEGRATIONS.md, section 6).
//
// | Function            | Runs                 | Does |
// |---------------------|----------------------|------|
// | `publicationsSweep` | Every hour           | Reads the pull request of every export that waits on GitHub and records a merge or a closing |
import { FUNCTIONS_REGION } from "@eegml/shared";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/scheduler";
import { firestore } from "../framework/admin";
import { websiteRepository } from "../integrations/github/adapters";
import { alertIntegrationFailure } from "../notifications/alerts";
import { sweepPublications } from "../publishing/lifecycle";

export const publicationsSweep = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Europe/London", region: FUNCTIONS_REGION, retryCount: 1 },
  async (event) => {
    const repository = websiteRepository();
    if (repository === null) return;
    const db = firestore();
    const at = new Date(event.scheduleTime);
    try {
      const changed = await sweepPublications(db, repository, at);
      logger.info("publications sweep finished", { changed });
    } catch (error) {
      await alertIntegrationFailure(db, "github", at);
      throw error;
    }
  },
);
