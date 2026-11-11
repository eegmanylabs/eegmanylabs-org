// The addresses of the record pages, in one place.
import type { EntityType } from "@eegml/shared";

export const replicationPath = (studyKey: string): string => `/replications/${encodeURIComponent(studyKey)}`;

export const memberPath = (personId: string): string => `/members/${encodeURIComponent(personId)}`;

export const laboratoryPath = (laboratoryId: string): string => `/labs/${encodeURIComponent(laboratoryId)}`;

/** The parameter of the laboratories list that opens its dialog to register or create a laboratory. */
export const LABORATORY_DIALOG_PARAMETER = "dialog";

/** The laboratories list with the dialog to register a laboratory, or to create one, open. */
export const laboratoryDialogPath = (dialog: "register" | "create"): string =>
  `/labs?${LABORATORY_DIALOG_PARAMETER}=${dialog}`;

/** The page of a record that the portal has a page for, or null. */
export function recordPath(entityType: EntityType, entityId: string): string | null {
  if (entityType === "replication") return replicationPath(entityId);
  if (entityType === "person") return memberPath(entityId);
  if (entityType === "laboratory") return laboratoryPath(entityId);
  return null;
}
