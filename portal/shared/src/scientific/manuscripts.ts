// The life of a manuscript (requirements R12.4 and R12.10): which status an event of each kind
// may move it to, and which milestone an event reaches. Stage 1 and Stage 2 Registered Reports
// follow the same steps, and a Stage 1 report accepted in principle is the start of its Stage 2.
import type {
  ManuscriptDecisionOutcome,
  ManuscriptEventKind,
  ManuscriptMilestone,
  ManuscriptStatus,
} from "../schemas/outputs";

/** The statuses an event of each kind may move a manuscript to. An event may also leave it where it is. */
export const STATUSES_AFTER_EVENT: Readonly<Record<ManuscriptEventKind, readonly ManuscriptStatus[]>> = {
  submission: ["submitted", "underReview"],
  reviewRound: ["underReview"],
  decision: ["inPrincipleAcceptance", "accepted", "revising", "rejected"],
  revision: ["drafting", "revising", "submitted", "underReview"],
  acceptance: ["inPrincipleAcceptance", "accepted"],
  publication: ["published"],
  other: ["planned", "drafting", "withdrawn"],
};

/** The status that the outcome of a decision gives a manuscript. */
export const STATUS_OF_DECISION: Readonly<Record<ManuscriptDecisionOutcome, ManuscriptStatus>> = {
  accept: "accepted",
  inPrincipleAcceptance: "inPrincipleAcceptance",
  minorRevision: "revising",
  majorRevision: "revising",
  reject: "rejected",
};

/** The status an event moves a manuscript to by default, which the person recording it may change. */
export function suggestedStatus(
  kind: ManuscriptEventKind,
  outcome: ManuscriptDecisionOutcome | null,
): ManuscriptStatus | null {
  if (kind === "decision") return outcome === null ? null : STATUS_OF_DECISION[outcome];
  if (kind === "submission") return "submitted";
  if (kind === "reviewRound") return "underReview";
  if (kind === "acceptance") return "accepted";
  if (kind === "publication") return "published";
  return null;
}

/** The milestone that a manuscript reaches when it moves to a status, if any. */
export function milestoneReachedBy(status: ManuscriptStatus): ManuscriptMilestone | null {
  if (status === "submitted" || status === "underReview") return "submission";
  if (status === "inPrincipleAcceptance" || status === "accepted") return "acceptance";
  if (status === "published") return "publication";
  return null;
}

/** The labels of the milestones of a manuscript, as a task names them. */
export const MILESTONE_LABELS: Readonly<Record<ManuscriptMilestone, string>> = {
  submission: "Submission",
  acceptance: "Acceptance",
  publication: "Publication",
};
