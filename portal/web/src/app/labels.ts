// How the interface names roles and instants. One place, so that every page uses the same words.
import type { Role } from "@eegml/shared";

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
