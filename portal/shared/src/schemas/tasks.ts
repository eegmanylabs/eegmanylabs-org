// Tasks (docs/DATA_MODEL.md, section 8): task lists, tasks and milestones, tags and reminders.
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  boundedRecord,
  customValuesSchema,
  documentBaseSchema,
  entityRefSchema,
  entityRefShape,
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

/** Where a record came from in an external system, such as the former task manager. */
const externalSourceShape = {
  system: keySchema,
  id: z.string().min(1).max(LIMITS.shortText),
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
export const taskParticipantRoleSchema = z.enum(["assignee", "collaborator", "follower"]);
export const taskDependencyKindSchema = z.enum(["finishToStart", "startToStart", "finishToFinish", "blocks"]);

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
  ancestorIds: z.array(idSchema).max(20),
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
  /** RFC 5545 text. */
  recurrenceRule: z.string().min(1).max(1_000).exactOptional(),
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
  source: z.strictObject({ ...externalSourceShape, url: urlSchema.exactOptional() }).exactOptional(),
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
});
export type TagDoc = z.output<typeof tagDocSchema>;

export const reminderChannelSchema = z.enum(["inApp", "email"]);

/** `reminders/{id}`: a reminder a user sets for themselves about a record. A function sets `sentAt`. */
export const reminderDocSchema = documentBaseSchema.extend({
  uid: uidSchema,
  ...entityRefShape,
  remindAt: timestampSchema,
  sentAt: timestampSchema.nullable(),
  channel: reminderChannelSchema,
});
export type ReminderDoc = z.output<typeof reminderDocSchema>;
