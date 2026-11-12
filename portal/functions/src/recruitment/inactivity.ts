// Inactivity alerts of recruitment (docs/DATA_MODEL.md, sections 7 and 8). A scheduled sweep
// finds the participations that are collecting and have filed no report for a number of days,
// tells the coordinators of the laboratory and the leads of the replication in the portal, and
// opens one follow-up task for each participation and each spell without reports.
//
// | Step | What it does |
// |------|--------------|
// | Since | The day of the last report filed for the participation, of any kind and basis, or the day it started collecting where it has filed none |
// | Due | A participation is flagged once `days` whole days have passed since then |
// | Task | `inactivityFollowUpTaskId` of the participation and that day: the same spell gives the same task, so a sweep that runs again, or twice, opens nothing new. A later report starts a new spell |
// | List | The follow-ups of a laboratory go in one list of that laboratory, which the sweep creates when it first needs it |
// | People | The coordinators of the laboratory are assigned and the leads of the replication collaborate, so both read the task, and both are notified once |
import {
  accessDocSchema,
  COLLECTIONS,
  dateOnlyInstant,
  daysBetween,
  inactivityFollowUpTaskId,
  laboratoryDocSchema,
  parseStoredDocument,
  participationDocSchema,
  recruitmentFollowUpListId,
  shiftIsoDate,
  statusHistoryDocSchema,
  systemActor,
  systemWriteContext,
  taskDocSchema,
  taskListDocSchema,
  taskListScope,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "../framework/audit";
import { createdFields, type WriteStamp } from "../framework/documents";
import { notifyAll } from "../notifications/notify";
import {
  initialStatusKey,
  placeAmong,
  recordHistory,
  siblingsOf,
  statusHistoryEntry,
  taskStatuses,
} from "../tasks/model";

/** The days without a report after which a participation is flagged, where the deployment sets none. */
export const DEFAULT_INACTIVITY_DAYS = 30;

/** The days a follow-up task gives its assignees. */
export const FOLLOW_UP_DAYS = 7;

/** The name of the list that holds the follow-ups of a laboratory. */
export const FOLLOW_UP_LIST_NAME = "Recruitment follow-up";

const ACTOR = systemActor("recruitmentInactivity");

export interface InactivitySweep {
  readonly checked: number;
  readonly flagged: number;
  readonly alreadyFlagged: number;
}

const dayOf = (instant: Date) => instant.toISOString().slice(0, 10);

/** The day from which a participation has been silent: its last filed report, or the start of its collection. */
async function silentSince(
  db: Firestore,
  participationId: string,
  statusHistoryId: string | null,
): Promise<string | null> {
  const reports = await db
    .collection(COLLECTIONS.recruitmentReports.collectionPath())
    .where("participationId", "==", participationId)
    .limit(5_000)
    .get();
  let latest: Date | null = null;
  for (const report of reports.docs) {
    const created = report.get("createdAt");
    if (created instanceof Timestamp && (latest === null || created.toDate() > latest)) latest = created.toDate();
  }
  if (latest !== null) return dayOf(latest);
  if (statusHistoryId === null) return null;
  const entry = parseStoredDocument(
    statusHistoryDocSchema,
    (await db.doc(COLLECTIONS.statusHistory.docPath(statusHistoryId)).get()).data(),
  );
  return entry.success ? dayOf(entry.data.effectiveAt.toDate()) : null;
}

/** The accounts whose access document lists a value in one of its arrays: the coordinators of a laboratory, the leads of a replication. */
export async function accountsListing(
  db: Firestore,
  field: "coordinatorLaboratoryIds" | "leadReplicationIds",
  value: string,
): Promise<string[]> {
  const found = await db
    .collection(COLLECTIONS.access.collectionPath())
    .where(field, "array-contains", value)
    .limit(100)
    .get();
  return found.docs
    .filter((document) => {
      const parsed = parseStoredDocument(accessDocSchema, document.data());
      return parsed.success && parsed.data.member && !parsed.data.suspended;
    })
    .map((document) => document.id)
    .sort();
}

/**
 * Flags every collecting participation that has filed no report for `days` days at `now`. Each
 * participation is handled in a transaction of its own, which creates the task only where it
 * does not exist, so a repeated run opens nothing twice.
 */
export async function flagInactiveParticipations(db: Firestore, now: Date, days: number): Promise<InactivitySweep> {
  const today = dayOf(now);
  const collecting = await db
    .collection(COLLECTIONS.participations.collectionPath())
    .where("status", "==", "collecting")
    .limit(1_000)
    .get();
  let flagged = 0;
  let alreadyFlagged = 0;
  for (const found of collecting.docs) {
    const participation = parseStoredDocument(participationDocSchema, found.data());
    if (!participation.success || participation.data.archivedAt !== null) continue;
    const { replicationId, laboratoryId, statusHistoryId } = participation.data;
    const since = await silentSince(db, found.id, statusHistoryId);
    if (since === null || daysBetween(since, today) < days) continue;
    const coordinators = await accountsListing(db, "coordinatorLaboratoryIds", laboratoryId);
    const leads = (await accountsListing(db, "leadReplicationIds", replicationId)).filter(
      (uid) => !coordinators.includes(uid),
    );
    const taskId = inactivityFollowUpTaskId(found.id, since);
    const listId = recruitmentFollowUpListId(laboratoryId);
    const outcome = await db.runTransaction(async (transaction) => {
      const taskReference = db.doc(COLLECTIONS.tasks.docPath(taskId));
      const listReference = db.doc(COLLECTIONS.taskLists.docPath(listId));
      const [task, list, laboratory] = await transaction.getAll(
        taskReference,
        listReference,
        db.doc(COLLECTIONS.laboratories.docPath(laboratoryId)),
      );
      if (task?.exists === true) return "existing";
      const statuses = await taskStatuses(db, transaction);
      const siblings = list?.exists === true ? await siblingsOf(db, transaction, listId, null, null) : [];
      const parsedLaboratory = parseStoredDocument(laboratoryDocSchema, laboratory?.data());
      const laboratoryName = parsedLaboratory.success ? parsedLaboratory.data.name : laboratoryId;
      const silentDays = daysBetween(since, today);
      const title = `Recruitment report overdue: ${replicationId} at ${laboratoryName}`;

      const auditEventId = writeAudit(
        transaction,
        {
          action: "recruitment.inactivityFlagged",
          actor: { kind: "system" },
          entityType: "participation",
          entityId: found.id,
          changes: [
            { field: "silentSince", after: since },
            { field: "taskId", after: taskId },
          ],
          at: now,
          idempotencyKey: `recruitmentInactivity:${taskId}`,
        },
        db,
      );
      const stamp: WriteStamp = { at: now, actor: ACTOR, writeContext: systemWriteContext("automation", auditEventId) };
      const scope = taskListScope("laboratory", laboratoryId);
      if (list?.exists !== true) {
        transaction.create(
          listReference,
          taskListDocSchema.parse({
            ...createdFields("taskLists", stamp),
            name: FOLLOW_UP_LIST_NAME,
            kind: "project",
            ownerUid: null,
            scopeType: "laboratory",
            scopeId: laboratoryId,
            ...scope,
          }),
        );
      }
      const statusKey = initialStatusKey(statuses);
      const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
      const order = placeAmong(transaction, siblings, siblings.length, stamp);
      const data = taskDocSchema.parse({
        ...createdFields("tasks", stamp),
        listId,
        ownerUid: null,
        parentId: null,
        ancestorIds: [],
        order,
        kind: "task",
        title,
        mentionUids: [],
        statusKey,
        statusHistoryId: historyReference.id,
        priority: "high",
        dueAt: Timestamp.fromDate(new Date(dateOnlyInstant(shiftIsoDate(today, FOLLOW_UP_DAYS)))),
        completedAt: null,
        assigneeUids: coordinators,
        collaboratorUids: leads,
        followerUids: [],
        unclaimedParticipants: [],
        dependsOn: {},
        links: [{ entityType: "participation", entityId: found.id }],
        checklist: {},
        tagIds: [],
        custom: {},
        ...scope,
      });
      transaction.create(taskReference, data);
      const stored = { id: taskId, data };
      transaction.set(
        historyReference,
        statusHistoryEntry(stored, null, statusKey, ACTOR, stamp, undefined, "automation"),
      );
      recordHistory(db, transaction, auditEventId, null, "task.created", stored, ["title"], stamp);
      notifyAll(
        db,
        transaction,
        [...coordinators, ...leads],
        {
          type: "recruitmentInactive",
          entityType: "participation",
          entityId: found.id,
          eventId: auditEventId,
          payload: {
            kind: "recruitmentInactive",
            title,
            replicationId,
            laboratoryId,
            participationId: found.id,
            silentSince: since,
            silentDays,
            taskId,
          },
        },
        stamp,
      );
      return "created";
    });
    if (outcome === "created") flagged += 1;
    else alreadyFlagged += 1;
  }
  return { checked: collecting.size, flagged, alreadyFlagged };
}
