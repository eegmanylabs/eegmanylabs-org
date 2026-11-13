// The kinds of document that a retention sweep may delete (docs/DATA_MODEL.md, section 14), and
// what a sweep makes of the configured periods. A period is a setting of `system/settings`, keyed
// by the target below, which only programme administrators change. Nothing has a default: a
// target without a period is never swept, and the sweep says so.

/** The targets of a sweep. The audit trail and source records are never among them. */
export const RETENTION_TARGETS = [
  "pageVersionsAutomatic",
  "recents",
  "notifications",
  "mail",
  "activity",
  "automationRuns",
  "syncRuns",
  "eventFailures",
] as const;
export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

export const RETENTION_TARGET_LABELS: Readonly<Record<RetentionTarget, string>> = {
  pageVersionsAutomatic: "Automatic versions of pages",
  recents: "Recently visited records",
  notifications: "Notifications",
  mail: "Sent and failed messages of the outbox",
  activity: "Activity entries",
  automationRuns: "Finished automation runs",
  syncRuns: "Finished synchronisation runs",
  eventFailures: "Resolved event failures",
};

/** The longest period a setting may state: about ten years. */
export const RETENTION_MAX_DAYS = 3_650;
/** The shortest period: a sweep never removes what is younger than a week. */
export const RETENTION_MIN_DAYS = 7;

export interface RetentionDecision {
  readonly target: RetentionTarget;
  readonly periodDays: number | null;
  /** Documents older than this instant may be deleted. Null where nothing may be. */
  readonly cutoff: Date | null;
}

/**
 * What a sweep may do with each target under the configured periods. A period that is missing,
 * not a whole number, or outside the permitted range deletes nothing.
 */
export function retentionDecisions(retention: Readonly<Record<string, number>>, now: Date): RetentionDecision[] {
  return RETENTION_TARGETS.map((target) => {
    const days = retention[target];
    const valid =
      typeof days === "number" && Number.isInteger(days) && days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS;
    return valid
      ? { target, periodDays: days, cutoff: new Date(now.getTime() - days * 86_400_000) }
      : { target, periodDays: null, cutoff: null };
  });
}

/** The quarter of a year that an instant falls in, as the period of an access review: `2026-Q4`. */
export function reviewPeriodOf(at: Date): string {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}
