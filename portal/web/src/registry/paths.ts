// The addresses of the record pages, in one place.
import type { EntityType } from "@eegml/shared";

export const replicationPath = (studyKey: string): string => `/replications/${encodeURIComponent(studyKey)}`;

export const memberPath = (personId: string): string => `/members/${encodeURIComponent(personId)}`;

export const laboratoryPath = (laboratoryId: string): string => `/labs/${encodeURIComponent(laboratoryId)}`;

/** A page of the workspace. A thread of it is opened in its comment panel. */
export const pagePath = (pageId: string, threadId?: string): string =>
  `/pages/${encodeURIComponent(pageId)}${threadId === undefined ? "" : `?thread=${encodeURIComponent(threadId)}`}`;

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
  if (entityType === "page") return pagePath(entityId);
  if (entityType === "participation") return participationRecruitmentPath(entityId);
  return null;
}

/** The recruitment of the programme, with its rollups, as of a date where one is given. */
export const RECRUITMENT_PATH = "/recruitment";

/** The recruitment of one participation: its reports, its current values and its planned pauses. */
export const participationRecruitmentPath = (participationId: string): string =>
  `/recruitment/participations/${encodeURIComponent(participationId)}`;

/** The forecast of a replication. */
export const forecastPath = (studyKey: string): string => `/recruitment/forecast/${encodeURIComponent(studyKey)}`;

/** The categories of participant counts and their definitions. */
export const COUNT_CATEGORIES_PATH = "/recruitment/categories";
