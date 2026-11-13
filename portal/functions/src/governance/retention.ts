// The retention sweep (docs/DATA_MODEL.md, section 14). A period is a setting of
// `system/settings`; a target without one is never swept, and the sweep records that it deleted
// nothing for that reason. Only documents that have finished their work are eligible: a message
// that was sent or failed, a run that ended, a failure that was resolved, and an automatic
// version of a page with its chunks. The audit trail and source records are never touched.
import {
  COLLECTIONS,
  PROGRAMME_KEY,
  parseStoredDocument,
  type RetentionDecision,
  type RetentionOutcome,
  type RetentionTarget,
  retentionDecisions,
  retentionRunDocSchema,
  systemActor,
  systemSettingsDocSchema,
  systemWriteContext,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, type Query, Timestamp } from "firebase-admin/firestore";
import { type AuditActor, callerStamp, createdFields, writeAudit } from "../framework";

/** The most documents one sweep deletes of one target. A sweep that reaches it says that more remain. */
export const SWEEP_LIMIT = 1_000;
const BATCH_WRITES = 400;

const FINISHED_MAIL = new Set(["sent", "failed"]);
const FINISHED_AUTOMATION = new Set(["succeeded", "failed", "skipped"]);
const FINISHED_SYNC = new Set(["succeeded", "partial", "skipped", "failed", "deadLetter", "cancelled"]);

/** Each eligible document, with the documents beneath it that go with it. */
type Eligible = { readonly reference: DocumentReference; readonly children: readonly DocumentReference[] };

async function olderThan(
  query: Query,
  field: string,
  cutoff: Date,
  finished: (data: Record<string, unknown>) => boolean,
): Promise<Eligible[]> {
  const snapshot = await query.where(field, "<", Timestamp.fromDate(cutoff)).limit(SWEEP_LIMIT).get();
  return snapshot.docs
    .filter((document) => finished(document.data()))
    .map((document) => ({ reference: document.ref, children: [] }));
}

async function underEveryUser(db: Firestore, collection: string, field: string, cutoff: Date): Promise<Eligible[]> {
  const found: Eligible[] = [];
  for (const user of await db.collection(COLLECTIONS.users.collectionPath()).listDocuments()) {
    if (found.length >= SWEEP_LIMIT) break;
    found.push(...(await olderThan(user.collection(collection), field, cutoff, () => true)));
  }
  return found.slice(0, SWEEP_LIMIT);
}

async function automaticVersions(db: Firestore, cutoff: Date): Promise<Eligible[]> {
  const found: Eligible[] = [];
  for (const page of await db.collection(COLLECTIONS.pages.collectionPath()).listDocuments()) {
    if (found.length >= SWEEP_LIMIT) break;
    const versions = await page
      .collection(COLLECTIONS.pageVersions.collectionId)
      .where("kind", "==", "auto")
      .limit(SWEEP_LIMIT)
      .get();
    for (const version of versions.docs) {
      const created: unknown = version.get("createdAt");
      if (!(created instanceof Timestamp) || created.toDate() >= cutoff) continue;
      const chunks = await version.ref.collection(COLLECTIONS.pageVersionChunks.collectionId).listDocuments();
      found.push({ reference: version.ref, children: chunks });
    }
  }
  return found.slice(0, SWEEP_LIMIT);
}

async function eligibleOf(db: Firestore, target: RetentionTarget, cutoff: Date): Promise<Eligible[]> {
  const top = (path: string) => db.collection(path);
  switch (target) {
    case "pageVersionsAutomatic":
      return automaticVersions(db, cutoff);
    case "recents":
      return underEveryUser(db, COLLECTIONS.userRecents.collectionId, "updatedAt", cutoff);
    case "notifications":
      return underEveryUser(db, COLLECTIONS.userNotifications.collectionId, "createdAt", cutoff);
    case "mail":
      return olderThan(top(COLLECTIONS.mail.collectionPath()), "createdAt", cutoff, (data) =>
        FINISHED_MAIL.has(String(data.status)),
      );
    case "activity":
      return olderThan(top(COLLECTIONS.activity.collectionPath()), "createdAt", cutoff, () => true);
    case "automationRuns":
      return olderThan(top(COLLECTIONS.automationRuns.collectionPath()), "createdAt", cutoff, (data) =>
        FINISHED_AUTOMATION.has(String(data.status)),
      );
    case "syncRuns":
      return olderThan(top(COLLECTIONS.syncRuns.collectionPath()), "createdAt", cutoff, (data) =>
        FINISHED_SYNC.has(String(data.status)),
      );
    case "eventFailures":
      return olderThan(
        top(COLLECTIONS.eventFailures.collectionPath()),
        "createdAt",
        cutoff,
        (data) => data.resolvedAt != null,
      );
  }
}

async function remove(db: Firestore, eligible: readonly Eligible[]): Promise<void> {
  // Children first, so that an interrupted sweep never leaves chunks without their version.
  const references = [...eligible.flatMap((item) => item.children), ...eligible.map((item) => item.reference)];
  for (let start = 0; start < references.length; start += BATCH_WRITES) {
    const batch = db.batch();
    for (const reference of references.slice(start, start + BATCH_WRITES)) batch.delete(reference);
    await batch.commit();
  }
}

async function sweepOne(db: Firestore, decision: RetentionDecision, dryRun: boolean): Promise<RetentionOutcome> {
  if (decision.cutoff === null || decision.periodDays === null) {
    return {
      target: decision.target,
      periodDays: null,
      eligible: 0,
      deleted: 0,
      note: "No period is configured, so nothing was deleted.",
    };
  }
  const eligible = await eligibleOf(db, decision.target, decision.cutoff);
  if (!dryRun) await remove(db, eligible);
  const more = eligible.length >= SWEEP_LIMIT ? " More remain for the next sweep." : "";
  return {
    target: decision.target,
    periodDays: decision.periodDays,
    eligible: eligible.length,
    deleted: dryRun ? 0 : eligible.length,
    note: `${dryRun ? "Dry run: nothing was deleted." : `Older than ${decision.periodDays} days.`}${more}`,
  };
}

/** Sweeps every target under the periods of the settings. */
export async function sweepRetention(
  db: Firestore,
  retention: Readonly<Record<string, number>>,
  now: Date,
  dryRun: boolean,
): Promise<RetentionOutcome[]> {
  const outcomes: RetentionOutcome[] = [];
  for (const decision of retentionDecisions(retention, now)) outcomes.push(await sweepOne(db, decision, dryRun));
  return outcomes;
}

/** The periods of `system/settings`, or none where the document does not exist yet. */
export async function retentionSettings(db: Firestore): Promise<Readonly<Record<string, number>>> {
  const settings = await db.doc(COLLECTIONS.systemSettings.docPath()).get();
  const parsed = settings.exists ? parseStoredDocument(systemSettingsDocSchema, settings.data()) : null;
  return parsed?.success === true ? parsed.data.retention : {};
}

/**
 * Sweeps, and records the run with its audit entry. The record says for each target what was
 * eligible, what was deleted and why nothing was where nothing was.
 */
export async function runAndRecordSweep(
  db: Firestore,
  options: {
    readonly trigger: "schedule" | "manual";
    readonly dryRun: boolean;
    readonly actor: AuditActor;
    readonly at: Date;
  },
): Promise<{ runId: string; outcomes: RetentionOutcome[] }> {
  const outcomes = await sweepRetention(db, await retentionSettings(db), options.at, options.dryRun);
  const reference = db.collection(COLLECTIONS.retentionRuns.collectionPath()).doc();
  const batch = db.batch();
  const auditEventId = writeAudit(
    batch,
    {
      action: "retention.swept",
      actor: options.actor,
      entityType: "programme",
      entityId: PROGRAMME_KEY,
      changes: outcomes.map((outcome) => ({ field: outcome.target, after: outcome.deleted })),
      at: options.at,
    },
    db,
  );
  const stamp =
    options.actor.kind === "user"
      ? callerStamp(options.actor.uid, options.at, auditEventId)
      : {
          at: options.at,
          actor: systemActor("retentionSweep"),
          writeContext: systemWriteContext("system", auditEventId),
        };
  batch.create(
    reference,
    retentionRunDocSchema.parse({
      ...createdFields("retentionRuns", stamp),
      trigger: options.trigger,
      dryRun: options.dryRun,
      startedAt: Timestamp.fromDate(options.at),
      finishedAt: Timestamp.now(),
      outcomes,
    }),
  );
  await batch.commit();
  return { runId: reference.id, outcomes };
}
