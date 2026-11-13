// How the publishing pages name what they show. One place, so the list and an export agree.
import type { PublicationBatchStatus, PublicOutput } from "@eegml/shared";

export const OUTPUT_LABELS: Readonly<Record<PublicOutput, string>> = {
  members: "Member and core team listings",
  laboratories: "Laboratory listing",
  replications: "Replication summaries",
  publications: "Publications",
  milestones: "Milestones",
  recruitment: "Aggregate recruitment",
};

export const STATUS_LABELS: Readonly<Record<PublicationBatchStatus, string>> = {
  previewed: "Previewed, awaiting the staging build",
  verified: "Staging build passed, awaiting approval",
  staged: "Pull request open",
  published: "Published",
  rolledBack: "Rolled back",
  withdrawn: "Withdrawn",
  failed: "Failed",
};

/** What happens next for an export in each state, in one sentence. */
export const NEXT_STEP: Readonly<Record<PublicationBatchStatus, string>> = {
  previewed:
    "Build the site from these files in a scratch copy on a trusted machine. The page updates when the report is recorded.",
  verified:
    "An administrator with the right to approve publications checks the difference and approves the live write.",
  staged:
    "The pull request deploys the shared staging site. A maintainer checks eegmanylabs.dev and merges it; the portal never merges.",
  published:
    "The website shows these files. A rollback is proposed as a pull request that restores what they replaced.",
  rolledBack: "A maintainer merged the rollback, so the website shows the files as they were before.",
  withdrawn: "Nothing of this export reaches the website.",
  failed: "Nothing of this export reaches the website. Correct what the reason names and prepare a new export.",
};

/**
 * Whether a pull request is one of the in-memory fake of the website repository, whose addresses
 * are on a reserved host that never resolves. Such a link opens nothing, and no live site is
 * deployed from it.
 */
export function isFakePullRequest(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".invalid");
  } catch {
    return false;
  }
}

/** What happens next for a staged export whose pull request is on the fake repository. */
export const FAKE_STAGED_STEP =
  "The pull request is on the fake website repository that the emulators use, not on GitHub, so no site is deployed. With the real adapter, it would deploy the shared staging site for a maintainer to check and merge; the portal never merges.";

/** The command that builds the staging site from an export, as a person runs it from a trusted machine. */
export function verifyCommand(batchId: string): string {
  return `npm run publish:verify -- --batch ${batchId}`;
}
