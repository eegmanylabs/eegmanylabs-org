// How the interface names roles and instants. One place, so that every page uses the same words.
import type { ProgrammeDecision, Role } from "@eegml/shared";

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  programme_admin: "Programme administrator",
  core_team: "Core team",
  replication_lead: "Replication lead",
  lab_coordinator: "Laboratory coordinator",
  lab_member: "Laboratory member",
  external_collaborator: "External collaborator",
};

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

/** An instant as people in the programme read it, for example "10 Nov 2026, 14:05". */
export function formatDateTime(value: Date | string): string {
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

export function formatDate(value: Date | string): string {
  return date.format(typeof value === "string" ? new Date(value) : value);
}

const longDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });

/**
 * Where a decision of the programme is written down, in words a member reads: "Programme
 * decisions of 13 November 2026, migration question 1". The path of the documentation stays in
 * the stored record and in the audit trail.
 */
export function decisionReference(decision: ProgrammeDecision): string {
  const day = longDate.format(new Date(`${decision.decidedOn}T00:00:00Z`));
  const question = /question (\d+)$/.exec(decision.reference)?.[1];
  const numbered = /decision (\d+)$/.exec(decision.reference)?.[1];
  const which =
    question !== undefined
      ? `, migration question ${question}`
      : numbered !== undefined
        ? `, decision ${numbered}`
        : "";
  return `Programme decisions of ${day}${which}`;
}

/** The day of a decision, as the interface shows days: "13 Nov 2026". */
export function decisionDay(decision: ProgrammeDecision): string {
  return formatDate(new Date(`${decision.decidedOn}T12:00:00Z`));
}
