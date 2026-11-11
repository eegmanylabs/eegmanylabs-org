// Tasks (docs/DATA_MODEL.md, section 8): task lists, tasks and milestones, tags and reminders.
import { parseRecurrenceRule } from "../recurrence";
import { TASK_MAX_ANCESTORS } from "../task-tree";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  boundedRecord,
  customValuesSchema,
  documentBaseSchema,
  entityRefSchema,
  idListSchema,
  idSchema,
  keySchema,
  LIMITS,
  mapKeySchema,
  provenanceShape,
  richTextSchema,
  scopeFieldsShape,
  shortTextSchema,
  uidListSchema,
  uidSchema,
  urlSchema,
} from "./base";

export const taskListKindSchema = z.enum(["project", "personal", "template"]);
export const taskScopeTypeSchema = z.enum(["programme", "replication", "laboratory", "group", "user"]);

/** Where a record came from in an external system, such as the former task manager, and its address there. */
const externalSourceShape = {
  system: keySchema,
  id: z.string().min(1).max(LIMITS.shortText),
  url: urlSchema.exactOptional(),
};

/** `taskLists/{id}`: a list tied to the programme, a replication, a laboratory or a group, or personal to one user. */
export const taskListDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  kind: taskListKindSchema,
  /** The owner of a personal list, and null for every other list. */
  ownerUid: uidSchema.nullable(),
  scopeType: taskScopeTypeSchema,
  scopeId: idSchema,
  /** The template from which the list was created. */
  templateSourceId: idSchema.exactOptional(),
  ...scopeFieldsShape,
  source: z.strictObject(externalSourceShape).exactOptional(),
  ...provenanceShape,
});
export type TaskListDoc = z.output<typeof taskListDocSchema>;

export const taskKindSchema = z.enum(["task", "milestone"]);
export const taskPrioritySchema = z.enum(["none", "low", "medium", "high", "urgent"]);
export const TASK_PARTICIPANT_ROLES = ["assignee", "collaborator", "follower"] as const;
export const taskParticipantRoleSchema = z.enum(TASK_PARTICIPANT_ROLES);
export const taskDependencyKindSchema = z.enum(["finishToStart", "startToStart", "finishToFinish", "blocks"]);

/** The text of a recurrence rule in the subset of RFC 5545 that the portal schedules (recurrence.ts). */
export const recurrenceRuleSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((text) => parseRecurrenceRule(text) !== null, {
    error:
      "Expected a rule such as FREQ=WEEKLY;BYDAY=MO,WE: daily, weekly on days or monthly by day, with an interval and an end",
  });

export const taskChecklistItemSchema = z.strictObject({
  label: shortTextSchema,
  done: z.boolean(),
  /** A fractional index, which places an item between two others by writing one entry. */
  order: z.string().min(1).max(100),
});

/**
 * `tasks/{id}`: a task, or a milestone, which is a dated checkpoint without duration. A task
 * appears once in `dependsOn`, which is keyed by task identifier, and never names itself there.
 * `statusKey` and `statusHistoryId` change through a callable function.
 */
export const taskDocSchema = documentBaseSchema.extend({
  listId: idSchema,
  /** Copied from a personal list, and null in every other list. */
  ownerUid: uidSchema.nullable(),
  parentId: idSchema.nullable(),
  ancestorIds: z.array(idSchema).max(TASK_MAX_ANCESTORS),
  /** A fractional index, which places a task between two others by writing one document. */
  order: z.string().min(1).max(100),
  kind: taskKindSchema,
  title: shortTextSchema,
  description: richTextSchema.exactOptional(),
  mentionUids: uidListSchema,
  statusKey: keySchema,
  statusHistoryId: idSchema.nullable(),
  priority: taskPrioritySchema,
  startAt: timestampSchema.exactOptional(),
  dueAt: timestampSchema.exactOptional(),
  completedAt: timestampSchema.nullable(),
  estimateMinutes: z.number().int().min(0).max(1_000_000).exactOptional(),
  progressPercent: z.number().int().min(0).max(100).exactOptional(),
  /** RFC 5545 text, in the subset that `parseRecurrenceRule` reads. */
  recurrenceRule: recurrenceRuleSchema.exactOptional(),
  recurrenceSourceTaskId: idSchema.exactOptional(),
  assigneeUids: uidListSchema,
  collaboratorUids: uidListSchema,
  followerUids: uidListSchema,
  /** Participants who have no account yet. The claim function moves each into the matching uid array. */
  unclaimedParticipants: z.array(z.strictObject({ personId: idSchema, role: taskParticipantRoleSchema })).max(100),
  dependsOn: boundedRecord(mapKeySchema, taskDependencyKindSchema, 100),
  links: z.array(entityRefSchema).max(100),
  checklist: boundedRecord(mapKeySchema, taskChecklistItemSchema, 200),
  tagIds: idListSchema,
  custom: customValuesSchema,
  ...scopeFieldsShape,
  source: z.strictObject(externalSourceShape).exactOptional(),
  ...provenanceShape,
});
export type TaskDoc = z.output<typeof taskDocSchema>;

/** `tags/{nameHash}`: a shared tag, applied through the `tagIds` array of a tagged document. */
export const tagDocSchema = documentBaseSchema.extend({
  name: z.string().min(1).max(100),
  /** The lookup fold of the name. */
  nameFolded: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+$/, { error: "Expected a folded name" }),
  colour: z.string().min(1).max(32).exactOptional(),
  ...provenanceShape,
});
export type TagDoc = z.output<typeof tagDocSchema>;

export const reminderChannelSchema = z.enum(["inApp", "email"]);

/**
 * The records a reminder may be about: those whose readers the reminder sweep decides as the
 * security rules do, so that a reminder never tells its owner about a record they may not open.
 */
export const reminderEntityTypeSchema = z.enum(["task"]);

/** The most reminders a user holds that are not sent yet. */
export const REMINDERS_PER_USER_MAX = 200;
/** How far in the past a reminder may be set, which leaves room for a slow clock: an hour. */
export const REMINDER_PAST_MINUTES = 60;
/** How far ahead a reminder may be set: two years. */
export const REMINDER_HORIZON_DAYS = 730;

/** `reminders/{id}`: a reminder a user sets for themselves about a record. A function sets `sentAt`. */
export const reminderDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  entityType: reminderEntityTypeSchema,
  entityId: idSchema,
  remindAt: timestampSchema,
  sentAt: timestampSchema.nullable(),
  channel: reminderChannelSchema,
});
export type ReminderDoc = z.output<typeof reminderDocSchema>;
