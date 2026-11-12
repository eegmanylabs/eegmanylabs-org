// The quality-control task of a dataset, opened through the tasks of phase 4 when the data of
// the dataset first arrives: the first listing, scanned or uploaded, that finds files. The task
// takes an identifier derived from the dataset key (`datasetQcTaskId`), so a second arrival, a
// repeated scan or a retried call opens nothing new. It goes in the list "Dataset quality
// control" of the replication, which is created when it is first needed, is assigned to the
// coordinators of the laboratory (or to the leads where the dataset names no laboratory), names
// the leads as collaborators and links to the dataset.
import {
  COLLECTIONS,
  type DatasetDoc,
  datasetQcListId,
  datasetQcTaskId,
  dateOnlyInstant,
  shiftIsoDate,
  taskDocSchema,
  taskListDocSchema,
  taskListScope,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";
import { notifyAll } from "../notifications/notify";
import { accountsListing } from "../recruitment/inactivity";
import {
  initialStatusKey,
  placeAmong,
  recordHistory,
  siblingsOf,
  statusHistoryEntry,
  taskStatuses,
} from "../tasks/model";

export const QC_LIST_NAME = "Dataset quality control";

/** The days a quality-control task gives its assignees. */
export const QC_TASK_DAYS = 14;

export interface QcParticipants {
  readonly assignees: readonly string[];
  readonly collaborators: readonly string[];
}

/** Who the task of a dataset goes to. Read before the transaction, from the access documents. */
export async function qcParticipants(
  db: Firestore,
  dataset: Pick<DatasetDoc, "replicationId" | "laboratoryId">,
): Promise<QcParticipants> {
  const leads = await accountsListing(db, "leadReplicationIds", dataset.replicationId);
  if (dataset.laboratoryId === null) return { assignees: leads, collaborators: [] };
  const coordinators = await accountsListing(db, "coordinatorLaboratoryIds", dataset.laboratoryId);
  return coordinators.length === 0
    ? { assignees: leads, collaborators: [] }
    : { assignees: coordinators, collaborators: leads.filter((uid) => !coordinators.includes(uid)) };
}

/** What the transaction read to open the task, or null where the task exists already. */
export interface QcTaskPlan {
  readonly taskReference: DocumentReference;
  readonly listReference: DocumentReference;
  readonly listExists: boolean;
  readonly statusKey: string;
  readonly siblings: Awaited<ReturnType<typeof siblingsOf>>;
}

/** Reads, in the transaction and before its first write, what opening the task needs. */
export async function prepareQcTask(
  db: Firestore,
  transaction: Transaction,
  datasetKey: string,
  replicationId: string,
): Promise<QcTaskPlan | null> {
  const taskReference = db.doc(COLLECTIONS.tasks.docPath(datasetQcTaskId(datasetKey)));
  const listId = datasetQcListId(replicationId);
  const listReference = db.doc(COLLECTIONS.taskLists.docPath(listId));
  const [task, list] = await transaction.getAll(taskReference, listReference);
  if (task?.exists === true) return null;
  const statuses = await taskStatuses(db, transaction);
  const listExists = list?.exists === true;
  const siblings = listExists ? await siblingsOf(db, transaction, listId, null, null) : [];
  return { taskReference, listReference, listExists, statusKey: initialStatusKey(statuses), siblings };
}

/** Writes the task, its list where it is new, its history and the notifications, after the reads. */
export function writeQcTask(
  db: Firestore,
  transaction: Transaction,
  plan: QcTaskPlan,
  dataset: { readonly id: string; readonly data: Pick<DatasetDoc, "replicationId" | "title"> },
  participants: QcParticipants,
  auditEventId: string,
  stamp: WriteStamp,
): string {
  const scope = taskListScope("replication", dataset.data.replicationId);
  if (!plan.listExists) {
    transaction.create(
      plan.listReference,
      taskListDocSchema.parse({
        ...createdFields("taskLists", stamp),
        name: QC_LIST_NAME,
        kind: "project",
        ownerUid: null,
        scopeType: "replication",
        scopeId: dataset.data.replicationId,
        ...scope,
      }),
    );
  }
  const title = `Quality control of ${dataset.id}`;
  const today = stamp.at.toISOString().slice(0, 10);
  const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
  const order = placeAmong(transaction, plan.siblings, plan.siblings.length, stamp);
  const data = taskDocSchema.parse({
    ...createdFields("tasks", stamp),
    listId: plan.listReference.id,
    ownerUid: null,
    parentId: null,
    ancestorIds: [],
    order,
    kind: "task",
    title,
    mentionUids: [],
    statusKey: plan.statusKey,
    statusHistoryId: historyReference.id,
    priority: "medium",
    dueAt: Timestamp.fromDate(new Date(dateOnlyInstant(shiftIsoDate(today, QC_TASK_DAYS)))),
    completedAt: null,
    assigneeUids: [...participants.assignees],
    collaboratorUids: [...participants.collaborators],
    followerUids: [],
    unclaimedParticipants: [],
    dependsOn: {},
    links: [{ entityType: "dataset", entityId: dataset.id }],
    checklist: {},
    tagIds: [],
    custom: {},
    ...scope,
  });
  transaction.create(plan.taskReference, data);
  const stored = { id: plan.taskReference.id, data };
  transaction.set(
    historyReference,
    statusHistoryEntry(stored, null, plan.statusKey, stamp.actor, stamp, undefined, "automation"),
  );
  recordHistory(db, transaction, auditEventId, null, "task.created", stored, ["title"], stamp);
  notifyAll(
    db,
    transaction,
    [...participants.assignees, ...participants.collaborators],
    {
      type: "assignment",
      entityType: "task",
      entityId: plan.taskReference.id,
      eventId: auditEventId,
      payload: { kind: "taskAssigned", title, actorUid: null },
    },
    stamp,
  );
  return plan.taskReference.id;
}
