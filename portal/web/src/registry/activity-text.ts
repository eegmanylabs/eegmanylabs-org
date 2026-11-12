// What an entry of activity says in words: the action, and the fields of a task that changed,
// as the history of a task and the activity of a dashboard show them. An entry stores keys, and
// no key reaches the interface as it is stored.

/** The verb of each action that the activity records, to stand between a name and a title. */
export const ACTIVITY_ACTION_LABELS: Readonly<Record<string, string>> = {
  "page.edited": "edited",
  "task.created": "created",
  "task.updated": "changed",
  "task.moved": "moved",
  "task.statusChanged": "changed the status of",
  "task.participantClaimed": "joined",
  "qcAssessment.recorded": "recorded a quality-control assessment for",
};

/** The verb of an action, or a plain one for an action that is newer than this list. */
export function activityVerb(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? "changed";
}

/**
 * The label of each field of a task that a change can name, as the history of the task says it.
 * The participants without an account are the same people as those with one, to the reader.
 */
export const TASK_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: "the title",
  kind: "the kind",
  priority: "the priority",
  startAt: "the start date",
  dueAt: "the due date",
  estimateMinutes: "the estimate",
  progressPercent: "the progress",
  recurrenceRule: "the repetition",
  recurrenceSourceTaskId: "the repetition",
  assigneeUids: "the assignees",
  collaboratorUids: "the collaborators",
  followerUids: "the followers",
  unclaimedParticipants: "the participants without an account",
  dependsOn: "the dependencies",
  links: "the links",
  checklist: "the checklist",
  tagIds: "the tags",
  archivedAt: "whether it is archived",
  statusKey: "the status",
  description: "the description",
};

/** The fields of a change in words, each once, joined as a sentence joins them. */
export function changedFieldsText(fields: readonly string[]): string {
  const labels = [...new Set(fields.map((field) => TASK_FIELD_LABELS[field] ?? "a field"))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
