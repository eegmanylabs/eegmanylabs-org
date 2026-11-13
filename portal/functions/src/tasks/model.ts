// What the functions of tasks share (docs/DATA_MODEL.md, section 8): reading lists, tasks and
// the statuses of tasks in a transaction, deciding what a caller may change, checking links and
// dependencies, turning a change into stored fields, and recording the history that a task shows.
import {
  type AuditChange,
  COLLECTIONS,
  type EntityType,
  entityPath,
  orderAt,
  orderKeysAfter,
  pageDocSchema,
  pageLevelFor,
  parseStoredDocument,
  programmePowersInEffect,
  type ResolvedAccess,
  readsTask,
  type SecondFactorFacts,
  type StatusDefinitionDoc,
  sessionScopeKeys,
  statusDefinitionDocSchema,
  type TaskDoc,
  type TaskListDoc,
  type TaskPatch,
  type TaskRole,
  taskAudienceKeys,
  taskDocSchema,
  taskListDocSchema,
  taskRole,
} from "@eegml/shared";
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { AppError, NOT_ALLOWED_MESSAGE } from "../framework";
import { touchedFields, type WriteStamp } from "../framework/documents";

export const LIST_NOT_FOUND_MESSAGE = "This task list does not exist, or your account may not open it.";
export const TASK_NOT_FOUND_MESSAGE = "This task does not exist, or your account may not open it.";

export interface StoredList {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: TaskListDoc;
}

export interface StoredTask {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: TaskDoc;
}

export async function readList(db: Firestore, transaction: Transaction, listId: string): Promise<StoredList | null> {
  const reference = db.doc(COLLECTIONS.taskLists.docPath(listId));
  const snapshot = await transaction.get(reference);
  if (!snapshot.exists) return null;
  const parsed = parseStoredDocument(taskListDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return { id: listId, reference, data: parsed.data };
}

export async function readTask(db: Firestore, transaction: Transaction, taskId: string): Promise<StoredTask | null> {
  const reference = db.doc(COLLECTIONS.tasks.docPath(taskId));
  const snapshot = await transaction.get(reference);
  if (!snapshot.exists) return null;
  const parsed = parseStoredDocument(taskDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return { id: taskId, reference, data: parsed.data };
}

/** The statuses of tasks that the programme configures, by key. */
export async function taskStatuses(
  db: Firestore,
  transaction: Transaction,
): Promise<ReadonlyMap<string, StatusDefinitionDoc>> {
  const found = await transaction.get(
    db.collection(COLLECTIONS.statusDefinitions.collectionPath()).where("entityType", "==", "task"),
  );
  const statuses = new Map<string, StatusDefinitionDoc>();
  for (const document of found.docs) {
    const parsed = parseStoredDocument(statusDefinitionDocSchema, document.data());
    if (parsed.success) statuses.set(parsed.data.key, parsed.data);
  }
  return statuses;
}

/** Whether a status counts as finished: done or cancelled. */
export function isFinished(status: Pick<StatusDefinitionDoc, "category"> | undefined): boolean {
  return status?.category === "done" || status?.category === "cancelled";
}

/** The status a new task starts in: the default status of tasks, or the first by position. */
export function initialStatusKey(statuses: ReadonlyMap<string, StatusDefinitionDoc>): string {
  const current = [...statuses.values()].filter((status) => status.archivedAt === null);
  const chosen = current.find((status) => status.isDefault) ?? current.sort((a, b) => a.position - b.position)[0];
  if (chosen === undefined) {
    throw new AppError(
      "failed-precondition",
      "The statuses of tasks are not set up. Ask an administrator to install them.",
    );
  }
  return chosen.key;
}

/** The role of the caller on a task, or a refusal that does not tell whether the task exists. */
export function roleOn(
  access: ResolvedAccess,
  secondFactorVerified: boolean,
  uid: string,
  list: StoredList,
  task: Pick<TaskDoc, "scopeKeys" | "ownerUid" | "assigneeUids" | "collaboratorUids" | "followerUids">,
): Exclude<TaskRole, "none"> {
  const role = taskRole(access, { secondFactorVerified }, uid, list.data, task);
  if (role === "none") throw new AppError("not-found", TASK_NOT_FOUND_MESSAGE);
  return role;
}

const PARTICIPANT_FIELDS = new Set(["progressPercent", "estimateMinutes", "checklist", "followerUids"]);

/**
 * Refuses a change that the caller's role does not cover. A participant changes the progress,
 * the estimate and the checklist; a reader follows a task or stops following it, which adds or
 * removes the reader alone; and anyone but a manager changes the followers only so.
 */
export function requirePatchAllowed(role: Exclude<TaskRole, "none">, uid: string, current: TaskDoc, patch: TaskPatch) {
  const fields = Object.keys(patch).filter((field) => patch[field as keyof TaskPatch] !== undefined);
  if (role === "manager") return;
  const allowed = role === "participant" ? PARTICIPANT_FIELDS : new Set(["followerUids"]);
  if (fields.some((field) => !allowed.has(field))) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
  if (patch.followerUids !== undefined) {
    const before = new Set(current.followerUids);
    const after = new Set(patch.followerUids);
    const changed = [...new Set([...before, ...after])].filter(
      (follower) => before.has(follower) !== after.has(follower),
    );
    if (changed.some((follower) => follower !== uid)) {
      throw new AppError("permission-denied", "You may follow a task or stop following it, and nobody else.");
    }
  }
}

/** Refuses a change to a task whose list or itself is archived, apart from its restoration. */
export function requireOpen(list: StoredList, task: TaskDoc | null, patch: TaskPatch = {}): void {
  if (list.data.archivedAt !== null) {
    throw new AppError("failed-precondition", "This task list is archived. Restore it before changing its tasks.");
  }
  if (task !== null && task.archivedAt !== null && patch.archived !== false) {
    throw new AppError("failed-precondition", "This task is archived. Restore it before changing it.");
  }
}

/** Who asks for a change: whether a record a task names may be named is decided for them. */
export interface TaskCaller {
  readonly uid: string;
  readonly access: ResolvedAccess;
  readonly session: SecondFactorFacts;
}

const NOT_LINKABLE_MESSAGE = "A link names a record that does not exist, or your account may not open it.";
const NOT_A_DEPENDENCY_MESSAGE = "A dependency names a task that does not exist, or your account may not open it.";

/**
 * Whether the caller reads a record that a task links to, as the security rules decide it. The
 * replications, laboratories, members, datasets, hypotheses, protocols and manuscripts of the
 * programme are read by every member; a task or a page by its own decision; and any other record
 * by its scope keys.
 */
function readsLinked(caller: TaskCaller, entityType: EntityType, data: unknown): boolean {
  const { access, session, uid } = caller;
  if (access.suspended || !access.member) return false;
  switch (entityType) {
    case "replication":
    case "laboratory":
    case "person":
    case "dataset":
    case "hypothesis":
    case "protocol":
    case "manuscript":
      return true;
    case "task": {
      const task = parseStoredDocument(taskDocSchema, data);
      return task.success && readsTask(access, session, uid, task.data);
    }
    case "page": {
      const page = parseStoredDocument(pageDocSchema, data);
      return page.success && pageLevelFor(access, session, page.data) !== "none";
    }
    default: {
      const keys = typeof data === "object" && data !== null ? (data as { scopeKeys?: unknown }).scopeKeys : undefined;
      if (!Array.isArray(keys)) return false;
      if (access.programmeRoles.length > 0 && programmePowersInEffect(access, session)) return true;
      const held = new Set(sessionScopeKeys(access, session));
      return keys.some((key) => typeof key === "string" && held.has(key));
    }
  }
}

/**
 * Refuses links to records that do not exist or that the caller may not open, with one message
 * for both, so that a link tells nobody whether a record they may not open exists. Only the
 * links that the change adds are checked: a link kept from before stays, so a dataset that a task
 * named before the registry existed keeps its link and opens once it is registered.
 */
export async function checkLinks(
  db: Firestore,
  transaction: Transaction,
  caller: TaskCaller,
  links: readonly { readonly entityType: EntityType; readonly entityId: string }[],
  previous: readonly { readonly entityType: string; readonly entityId: string }[] = [],
): Promise<void> {
  const seen = new Set<string>();
  const kept = new Set(previous.map((link) => `${link.entityType} ${link.entityId}`));
  for (const link of links) {
    const key = `${link.entityType} ${link.entityId}`;
    if (seen.has(key)) throw new AppError("invalid-argument", "A task links to the same record once.");
    seen.add(key);
    if (kept.has(key)) continue;
    let path: string;
    try {
      path = entityPath(link.entityType, link.entityId);
    } catch {
      throw new AppError("invalid-argument", NOT_LINKABLE_MESSAGE);
    }
    const snapshot = await transaction.get(db.doc(path));
    if (!snapshot.exists || !readsLinked(caller, link.entityType, snapshot.data())) {
      throw new AppError("invalid-argument", NOT_LINKABLE_MESSAGE);
    }
  }
}

/** The most tasks the check of a dependency follows before it gives up. */
const DEPENDENCY_WALK_MAX = 500;

/**
 * Refuses dependencies on tasks that do not exist or that the caller may not open, with one
 * message for both, on the task itself, and any that would close a cycle: a task that the new
 * target depends on, directly or through others, is the task. `pending` holds the dependencies
 * that the same call gives other tasks, which count in place of their stored ones, so that two
 * changes of one call cannot close a cycle between them.
 */
export async function checkDependencies(
  db: Firestore,
  transaction: Transaction,
  caller: TaskCaller,
  taskId: string,
  dependsOn: Readonly<Record<string, string>>,
  previous: Readonly<Record<string, string>>,
  pending: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map(),
): Promise<void> {
  const added = Object.keys(dependsOn).filter((id) => !(id in previous));
  if (taskId in dependsOn) throw new AppError("invalid-argument", "A task cannot depend on itself.");
  const cache = new Map<string, { readonly data: unknown } | null>();
  const stored = async (id: string) => {
    if (!cache.has(id)) {
      const snapshot = await transaction.get(db.doc(COLLECTIONS.tasks.docPath(id)));
      cache.set(id, snapshot.exists ? { data: snapshot.data() } : null);
    }
    return cache.get(id) ?? null;
  };
  const dependenciesOf = async (id: string): Promise<Readonly<Record<string, string>>> => {
    const overlaid = pending.get(id);
    if (overlaid !== undefined) return overlaid;
    const value = ((await stored(id))?.data as { dependsOn?: unknown } | undefined)?.dependsOn;
    return typeof value === "object" && value !== null ? (value as Record<string, string>) : {};
  };
  for (const target of added) {
    const found = await stored(target);
    if (found === null || !readsLinked(caller, "task", found.data)) {
      throw new AppError("invalid-argument", NOT_A_DEPENDENCY_MESSAGE);
    }
  }
  const stack = [...added];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskId) {
      throw new AppError(
        "invalid-argument",
        "This dependency would close a cycle: the other task already waits for this one.",
      );
    }
    if (visited.has(current)) continue;
    visited.add(current);
    if (visited.size > DEPENDENCY_WALK_MAX) {
      throw new AppError("resource-exhausted", "The chain of dependencies is too long to check at once.");
    }
    stack.push(...Object.keys(await dependenciesOf(current)));
  }
}

/** Refuses participants who have no account with a membership, and people who do not exist. */
export async function checkParticipants(db: Firestore, transaction: Transaction, patch: TaskPatch): Promise<void> {
  const uids = new Set([
    ...(patch.assigneeUids ?? []),
    ...(patch.collaboratorUids ?? []),
    ...(patch.followerUids ?? []),
  ]);
  for (const uid of uids) {
    const access = await transaction.get(db.doc(COLLECTIONS.access.docPath(uid)));
    if (!access.exists || access.get("member") !== true || access.get("suspended") === true) {
      throw new AppError("invalid-argument", "A participant is not a member of the portal.");
    }
  }
  const entries = (patch.unclaimedParticipants ?? []).map((entry) => `${entry.personId} ${entry.role}`);
  if (new Set(entries).size !== entries.length) {
    throw new AppError("invalid-argument", "A person takes each role on a task once.");
  }
  for (const entry of patch.unclaimedParticipants ?? []) {
    const person = await transaction.get(db.doc(COLLECTIONS.persons.docPath(entry.personId)));
    if (!person.exists) throw new AppError("invalid-argument", "A participant names a person who does not exist.");
  }
}

const instant = (text: string) => Timestamp.fromDate(new Date(text));

/**
 * The stored fields of a change: an absent field stays, and null removes a field that may be
 * absent. A milestone keeps no start, estimate, progress, checklist or recurrence.
 */
export function storedPatch(patch: TaskPatch, at: Date, kind: TaskDoc["kind"]): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const optional = (name: string, value: unknown) => {
    if (value === undefined) return;
    fields[name] = value === null ? FieldValue.delete() : value;
  };
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.kind !== undefined) fields.kind = patch.kind;
  if (patch.priority !== undefined) fields.priority = patch.priority;
  optional("startAt", patch.startAt === undefined ? undefined : patch.startAt === null ? null : instant(patch.startAt));
  optional("dueAt", patch.dueAt === undefined ? undefined : patch.dueAt === null ? null : instant(patch.dueAt));
  optional("estimateMinutes", patch.estimateMinutes);
  optional("progressPercent", patch.progressPercent);
  optional("recurrenceRule", patch.recurrenceRule);
  for (const name of ["assigneeUids", "collaboratorUids", "followerUids", "tagIds"] as const) {
    const value = patch[name];
    if (value !== undefined) fields[name] = [...new Set(value)];
  }
  for (const name of ["unclaimedParticipants", "dependsOn", "links", "checklist"] as const) {
    const value = patch[name];
    if (value !== undefined) fields[name] = value;
  }
  if (patch.archived !== undefined) fields.archivedAt = patch.archived ? Timestamp.fromDate(at) : null;
  if ((patch.kind ?? kind) === "milestone") {
    for (const name of ["startAt", "estimateMinutes", "progressPercent", "recurrenceRule"])
      fields[name] = FieldValue.delete();
    fields.checklist = {};
  }
  return fields;
}

/** The document a task becomes after a change, without the sentinels of the Admin SDK, for its schema to check. */
export function patchedTask(current: TaskDoc, stored: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...current };
  for (const [name, value] of Object.entries(stored)) {
    if (value instanceof FieldValue) delete next[name];
    else next[name] = value;
  }
  return next;
}

/** A stored value as an audit entry keeps it: an instant as ISO text. */
function plain(value: unknown): unknown {
  return value instanceof Timestamp ? value.toDate().toISOString() : value;
}

/** The changes of a task for its audit entry: each field the change names, with its value before and after. */
export function auditChangesOf(patch: TaskPatch, current: TaskDoc | null): AuditChange[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => {
      const field = name === "archived" ? "archivedAt" : name;
      const before = current === null ? undefined : (current as Readonly<Record<string, unknown>>)[field];
      return before === undefined ? { field, after: value } : { field, before: plain(before), after: value };
    });
}

/** The fields a change names, for the audit entry and the history of the task. */
export function changedFieldsOf(patch: TaskPatch): string[] {
  return Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => (name === "archived" ? "archivedAt" : name))
    .sort();
}

/**
 * Records a change in the history of a task: an entry of `activity` that names the actor and the
 * fields that changed, read by everyone who reads the task. The entry takes the identifier of
 * the audit entry, so a change has one history entry.
 */
export function recordHistory(
  db: Firestore,
  transaction: Transaction,
  eventId: string,
  actorUid: string | null,
  action: string,
  task: {
    readonly id: string;
    readonly data: Pick<
      TaskDoc,
      "title" | "replicationId" | "laboratoryId" | "scopeKeys" | "assigneeUids" | "collaboratorUids" | "followerUids"
    >;
  },
  changedFields: readonly string[],
  stamp: WriteStamp,
): void {
  transaction.set(
    db.doc(COLLECTIONS.activity.docPath(eventId)),
    COLLECTIONS.activity.schema.parse({
      schemaVersion: COLLECTIONS.activity.schemaVersion,
      createdAt: Timestamp.fromDate(stamp.at),
      createdBy: stamp.actor,
      writeContext: stamp.writeContext,
      actorUid,
      action,
      entityType: "task",
      entityId: task.id,
      title: task.data.title,
      changedFields: [...changedFields],
      replicationId: task.data.replicationId,
      laboratoryId: task.data.laboratoryId,
      scopeKeys: taskAudienceKeys(task.data),
    }),
  );
}

/** The accounts newly named in an array, apart from the caller. */
export function newlyNamed(before: readonly string[], after: readonly string[] | undefined, caller: string): string[] {
  if (after === undefined) return [];
  return after.filter((uid) => !before.includes(uid) && uid !== caller);
}

/** The entry of the status history of a task, read by everyone who reads the task. */
export function statusHistoryEntry(
  task: {
    readonly id: string;
    readonly data: Pick<
      TaskDoc,
      "replicationId" | "laboratoryId" | "scopeKeys" | "assigneeUids" | "collaboratorUids" | "followerUids"
    >;
  },
  fromStatusKey: string | null,
  toStatusKey: string,
  actor: string,
  stamp: WriteStamp,
  reason: string | undefined,
  source: "manual" | "automation" = "manual",
) {
  const now = Timestamp.fromDate(stamp.at);
  return COLLECTIONS.statusHistory.schema.parse({
    schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
    createdAt: now,
    createdBy: stamp.actor,
    writeContext: stamp.writeContext,
    entityType: "task",
    entityId: task.id,
    fromStatusKey,
    toStatusKey,
    effectiveAt: now,
    recordedAt: now,
    changedBy: actor,
    ...(reason === undefined ? {} : { reason }),
    source,
    replicationId: task.data.replicationId,
    laboratoryId: task.data.laboratoryId,
    scopeKeys: taskAudienceKeys(task.data),
  });
}

/** The order keys of the tasks beside which a task is placed: the tasks of a list beneath one parent, in order. */
export async function siblingsOf(
  db: Firestore,
  transaction: Transaction,
  listId: string,
  parentId: string | null,
  exceptTaskId: string | null,
): Promise<{ readonly id: string; readonly reference: DocumentReference; readonly order: string }[]> {
  const found = await transaction.get(
    db
      .collection(COLLECTIONS.tasks.collectionPath())
      .where("listId", "==", listId)
      .where("parentId", "==", parentId)
      .limit(1_000),
  );
  return found.docs
    .filter((snapshot) => snapshot.id !== exceptTaskId)
    .map((snapshot) => ({ id: snapshot.id, reference: snapshot.ref, order: String(snapshot.get("order")) }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * The order key of a task placed at `index` among its siblings. Where two neighbours share a key,
 * which an import can leave behind, the siblings are numbered again in the same transaction.
 */
export function placeAmong(
  transaction: Transaction,
  siblings: readonly { readonly reference: DocumentReference; readonly order: string }[],
  index: number,
  stamp: WriteStamp,
): string {
  const placed = orderAt(
    siblings.map((sibling) => sibling.order),
    index,
  );
  if (placed !== null) return placed;
  const keys = orderKeysAfter(null, siblings.length + 1);
  const position = Math.max(0, Math.min(index, siblings.length));
  siblings.forEach((sibling, at) => {
    const key = keys[at < position ? at : at + 1] as string;
    transaction.update(sibling.reference, { order: key, ...touchedFields(stamp) });
  });
  return keys[position] as string;
}
