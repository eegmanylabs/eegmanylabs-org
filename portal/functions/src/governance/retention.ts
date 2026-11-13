// The retention sweep (docs/DATA_MODEL.md, section 14). A period is a setting of
// `system/settings`; a target without one is never swept, and the sweep records that it deleted
// nothing for that reason. Only documents that have finished their work are eligible: a message
// that was sent or failed, a run that ended, a failure that was resolved, and an automatic
// version of a page with its chunks. The audit trail is never touched.
//
// One target is no setting but a decision of the programme (docs/MIGRATION_PLAN.md, section 11,
// question 20): the raw material of the migration is kept until an administrator marks the
// migration verified and for one year after, and then the outreach records of source F for people
// who never joined are deleted: the outreach contact, the raw rows behind it, and the values of
// the change log entries about them, which become a marker. What becomes of the other raw records
// after that year was not decided, so the sweep deletes nothing else.
//
// "Never joined" is the project's reading, recorded in the same section of the plan: a contact
// that names no person, whose address resolves to no person through the email index at the time
// of the sweep, and whose row no open review item names. Contacts are written by an import that
// stops running once the migration is verified, so each is resolved again here: a person who
// joined after the last import, or whose match waits in the queue, keeps their record.
import {
  COLLECTIONS,
  MIGRATION_RETENTION_DECISION,
  OUTREACH_RETENTION_TARGET,
  OUTREACH_SOURCE_KEY,
  outreachRetentionCutoff,
  PROGRAMME_KEY,
  parseStoredDocument,
  personEmailIndexId,
  type RetentionDecision,
  type RetentionOutcome,
  type RetentionTarget,
  retentionDecisions,
  retentionRunDocSchema,
  systemActor,
  systemSettingsDocSchema,
  systemWriteContext,
} from "@eegml/shared";
import { type DocumentReference, FieldPath, type Firestore, type Query, Timestamp } from "firebase-admin/firestore";
import { type AuditActor, callerStamp, createdFields, identityHashKey, writeAudit } from "../framework";

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

/** The value that stands in the change log, and in nothing else, for a value of an outreach record that was deleted. */
export const RETAINED_NO_LONGER_MARKER = "[deleted under the retention of the migration]";

const markValues = (state: unknown): Record<string, string> | null =>
  state === null || typeof state !== "object"
    ? null
    : Object.fromEntries(Object.keys(state as Record<string, unknown>).map((key) => [key, RETAINED_NO_LONGER_MARKER]));

/** The most change log entries one query names by their source records. */
const ANY_OF_MAX = 30;

/** Whether an address belongs to a known person: answered through the keyed email index. */
export type PersonOfAddress = (address: string) => Promise<boolean>;

/** Resolves an address through `personEmailIndex`, with the key of this environment, read only when an address needs it. */
export function emailIndexResolver(db: Firestore, secret: () => string = () => identityHashKey()): PersonOfAddress {
  return async (address) => {
    const entry = await db.doc(COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(address, secret()))).get();
    const ids: unknown = entry.get("personIds");
    return entry.exists && Array.isArray(ids) && ids.length > 0;
  };
}

/** The contacts that one page of the sweep reads. */
const CONTACT_PAGE = 500;

/** The source records that an open review item of source F names: their contacts wait for a decision. */
async function rowsUnderReview(db: Firestore): Promise<Set<string>> {
  const open = await db
    .collection(COLLECTIONS.reconciliationItems.collectionPath())
    .where("sourceKey", "==", OUTREACH_SOURCE_KEY)
    .where("status", "==", "open")
    .get();
  const named = new Set<string>();
  for (const item of open.docs) {
    const candidates: unknown = item.get("candidates");
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates as { sourceRecordId?: unknown }[]) {
      if (typeof candidate.sourceRecordId === "string") named.add(candidate.sourceRecordId);
    }
  }
  return named;
}

/**
 * The outreach records of source F for people who never joined, which the retention of the
 * migration deletes: each contact that names no person, whose address resolves to nobody and whose
 * row no open item names, with the revisions of the raw row behind it and their continuations,
 * and the entries of the change log that name those rows. The importer leaves `personId` out of an
 * unmatched contact, so the contacts are read page by page and the field is looked at here.
 */
async function outreachOfOutsiders(
  db: Firestore,
  personOfAddress: PersonOfAddress,
): Promise<{
  readonly eligible: readonly Eligible[];
  readonly changes: readonly DocumentReference[];
  readonly kept: number;
}> {
  const underReview = await rowsUnderReview(db);
  const eligible: Eligible[] = [];
  const recordIds = new Set<string>();
  let kept = 0;
  let after: string | null = null;
  for (;;) {
    let query = db
      .collection(COLLECTIONS.outreachContacts.collectionPath())
      .orderBy(FieldPath.documentId())
      .limit(CONTACT_PAGE);
    if (after !== null) query = query.startAfter(after);
    const page = await query.get();
    for (const contact of page.docs) {
      if (eligible.length >= SWEEP_LIMIT) break;
      const personId: unknown = contact.get("personId");
      if (typeof personId === "string") continue;
      const recordId: unknown = contact.get("sourceRecordId");
      if (typeof recordId !== "string") continue;
      const record = await db.doc(COLLECTIONS.sourceRecords.docPath(recordId)).get();
      // Only the outreach of source F is the subject of the decision. A contact of another source stays.
      if (!record.exists || record.get("sourceKey") !== OUTREACH_SOURCE_KEY) continue;
      const address: unknown = contact.get("contactEmail");
      if (underReview.has(recordId) || (typeof address === "string" && (await personOfAddress(address)))) {
        kept += 1;
        continue;
      }
      const revisions = await db
        .collection(COLLECTIONS.sourceRecords.collectionPath())
        .where("sourceKey", "==", OUTREACH_SOURCE_KEY)
        .where("tabKey", "==", record.get("tabKey"))
        .where("rowKey", "==", record.get("rowKey"))
        .get();
      const children: DocumentReference[] = [];
      for (const revision of revisions.docs) {
        recordIds.add(revision.id);
        children.push(
          ...(await revision.ref.collection(COLLECTIONS.sourceRecordRawChunks.collectionId).listDocuments()),
          revision.ref,
        );
      }
      eligible.push({ reference: contact.ref, children });
    }
    const last = page.docs.at(-1);
    if (last === undefined || page.size < CONTACT_PAGE || eligible.length >= SWEEP_LIMIT) break;
    after = last.id;
  }
  const ids = [...recordIds];
  const changes: DocumentReference[] = [];
  for (let start = 0; start < ids.length; start += ANY_OF_MAX) {
    const page = await db
      .collectionGroup(COLLECTIONS.importBatchChanges.collectionId)
      .where("sourceRecordIds", "array-contains-any", ids.slice(start, start + ANY_OF_MAX))
      .get();
    changes.push(...page.docs.map((change) => change.ref));
  }
  return { eligible, changes, kept };
}

/**
 * What the retention of the migration does at an instant. Nothing goes before the migration is
 * marked verified and the year after it has passed.
 */
async function sweepMigration(
  db: Firestore,
  verifiedAt: Date | null,
  now: Date,
  dryRun: boolean,
  personOfAddress: PersonOfAddress,
): Promise<RetentionOutcome> {
  const outcome = { target: OUTREACH_RETENTION_TARGET, periodDays: null, decision: MIGRATION_RETENTION_DECISION };
  const cutoff = outreachRetentionCutoff(verifiedAt);
  if (cutoff === null) {
    return {
      ...outcome,
      eligible: 0,
      deleted: 0,
      note: "The migration is not marked verified, so its raw material is kept and nothing was deleted.",
    };
  }
  if (now < cutoff) {
    return {
      ...outcome,
      eligible: 0,
      deleted: 0,
      note: "Kept for one year after the migration was marked verified, so nothing was deleted.",
    };
  }
  const { eligible, changes, kept } = await outreachOfOutsiders(db, personOfAddress);
  if (!dryRun) {
    // The change log keeps its entries, with a marker in place of each value of the deleted rows.
    for (let start = 0; start < changes.length; start += BATCH_WRITES) {
      const batch = db.batch();
      for (const reference of changes.slice(start, start + BATCH_WRITES)) {
        const change = await reference.get();
        batch.update(reference, { before: markValues(change.get("before")), after: markValues(change.get("after")) });
      }
      await batch.commit();
    }
    await remove(db, eligible);
  }
  const more = eligible.length >= SWEEP_LIMIT ? " More remain for the next sweep." : "";
  const keptNote =
    kept === 0
      ? ""
      : ` ${kept} contact${kept === 1 ? " was" : "s were"} kept, because the address matches a person or a review item names the row.`;
  return {
    ...outcome,
    eligible: eligible.length,
    deleted: dryRun ? 0 : eligible.length,
    note: `${dryRun ? "Dry run: nothing was deleted." : "The outreach records of people who never joined, one year after the migration was marked verified."}${keptNote}${more}`,
  };
}

/** Sweeps every target under the periods of the settings, and the raw material of the migration under its decision. */
export async function sweepRetention(
  db: Firestore,
  settings: Pick<RetentionSettings, "retention" | "migrationVerifiedAt">,
  now: Date,
  dryRun: boolean,
  personOfAddress: PersonOfAddress = emailIndexResolver(db),
): Promise<RetentionOutcome[]> {
  const outcomes: RetentionOutcome[] = [];
  for (const decision of retentionDecisions(settings.retention, now))
    outcomes.push(await sweepOne(db, decision, dryRun));
  outcomes.push(await sweepMigration(db, settings.migrationVerifiedAt, now, dryRun, personOfAddress));
  return outcomes;
}

export interface RetentionSettings {
  readonly retention: Readonly<Record<string, number>>;
  /** When the migration was marked verified, or null while it is not. */
  readonly migrationVerifiedAt: Date | null;
  /** The account that marked it, or null while it is not marked. */
  readonly migrationVerifiedBy: string | null;
}

/** The periods of `system/settings` and the mark of the migration, or none where the document does not exist yet. */
export async function retentionSettings(db: Firestore): Promise<RetentionSettings> {
  const settings = await db.doc(COLLECTIONS.systemSettings.docPath()).get();
  const parsed = settings.exists ? parseStoredDocument(systemSettingsDocSchema, settings.data()) : null;
  if (parsed?.success !== true) return { retention: {}, migrationVerifiedAt: null, migrationVerifiedBy: null };
  return {
    retention: parsed.data.retention,
    migrationVerifiedAt: parsed.data.migrationVerifiedAt?.toDate() ?? null,
    migrationVerifiedBy: parsed.data.migrationVerifiedBy ?? null,
  };
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
