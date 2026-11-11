// The hand-over of tasks when a person claims an account (docs/DATA_MODEL.md, section 8). A
// person without an account is named on a task in `unclaimedParticipants`, with a role. The
// claim moves each such entry into the matching uid array of the account, in the transaction
// of the link, with an audit entry for each task, so the person reads and follows their tasks
// from the moment the account is linked.
import { COLLECTIONS, parseStoredDocument, TASK_PARTICIPANT_ROLES, type TaskDoc, taskDocSchema } from "@eegml/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { writeAudit } from "../framework/audit";
import { touchedFields, type WriteStamp } from "../framework/documents";
import { recordHistory } from "./model";

/** The most tasks one claim hands over. A person named on more is handed the rest by an administrator. */
export const HANDOVER_MAX = 400;

export interface UnclaimedTask {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: TaskDoc;
}

const ARRAY_OF_ROLE = {
  assignee: "assigneeUids",
  collaborator: "collaboratorUids",
  follower: "followerUids",
} as const;

/** The tasks that name a person in `unclaimedParticipants`, in any role, read in the transaction. */
export async function readUnclaimedTasks(
  db: Firestore,
  transaction: Transaction,
  personId: string,
): Promise<UnclaimedTask[]> {
  const found = new Map<string, UnclaimedTask>();
  for (const role of TASK_PARTICIPANT_ROLES) {
    const snapshot = await transaction.get(
      db
        .collection(COLLECTIONS.tasks.collectionPath())
        .where("unclaimedParticipants", "array-contains", { personId, role })
        .limit(HANDOVER_MAX),
    );
    for (const document of snapshot.docs) {
      const parsed = parseStoredDocument(taskDocSchema, document.data());
      if (parsed.success) found.set(document.id, { id: document.id, reference: document.ref, data: parsed.data });
    }
  }
  return [...found.values()].slice(0, HANDOVER_MAX);
}

/** Moves the entries of a person into the uid arrays of the account. Returns how many tasks changed. */
export function handOverTasks(
  db: Firestore,
  transaction: Transaction,
  tasks: readonly UnclaimedTask[],
  personId: string,
  uid: string,
  stamp: WriteStamp,
): number {
  for (const task of tasks) {
    const roles = task.data.unclaimedParticipants
      .filter((entry) => entry.personId === personId)
      .map((entry) => entry.role);
    const arrays: Partial<Record<(typeof ARRAY_OF_ROLE)[keyof typeof ARRAY_OF_ROLE], string[]>> = {};
    for (const role of roles) {
      const field = ARRAY_OF_ROLE[role];
      const current = arrays[field] ?? task.data[field];
      arrays[field] = current.includes(uid) ? current : [...current, uid];
    }
    const unclaimedParticipants = task.data.unclaimedParticipants.filter((entry) => entry.personId !== personId);
    const auditEventId = writeAudit(
      transaction,
      {
        action: "task.participantClaimed",
        actor: { kind: "user", uid: stamp.actor },
        entityType: "task",
        entityId: task.id,
        changes: [
          { field: "personId", before: personId },
          ...Object.entries(arrays).map(([field, after]) => ({
            field,
            before: task.data[field as keyof typeof task.data],
            after,
          })),
        ],
        at: stamp.at,
        context: { causationId: stamp.writeContext.auditEventId },
      },
      db,
    );
    const taskStamp = { ...stamp, writeContext: { ...stamp.writeContext, auditEventId } };
    transaction.update(task.reference, { ...arrays, unclaimedParticipants, ...touchedFields(taskStamp) });
    recordHistory(
      db,
      transaction,
      auditEventId,
      uid,
      "task.participantClaimed",
      { id: task.id, data: { ...task.data, ...arrays } },
      Object.keys(arrays).sort(),
      taskStamp,
    );
  }
  return tasks.length;
}
