// One run of the referential-integrity checker from a function: it reads the collections the
// checker names, runs `checkIntegrity` of the shared package and writes the report with its
// findings to `integrityReports`. The command `integrity:check` of the tools does the same from
// a trusted machine.
import {
  type CheckedDocument,
  COLLECTIONS,
  type CollectionEntry,
  checkIntegrity,
  INTEGRITY_COLLECTIONS,
  type IntegrityCollection,
  integrityRecords,
  integrityRunId,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";

/** The actor recorded on a report that the scheduled function writes. */
export const INTEGRITY_ACTOR = systemActor("integritySweep");

/** Reads every document of the collections the checker follows. */
export async function readIntegritySnapshot(db: Firestore): Promise<Map<IntegrityCollection, CheckedDocument[]>> {
  const snapshot = new Map<IntegrityCollection, CheckedDocument[]>();
  for (const key of INTEGRITY_COLLECTIONS) {
    const entry: CollectionEntry = COLLECTIONS[key];
    const nested = entry.path.split("/").length > 2;
    const result = nested
      ? await db.collectionGroup(entry.collectionId).get()
      : await db.collection(entry.collectionPath()).get();
    snapshot.set(
      key,
      result.docs.map((document) => ({ path: document.ref.path, data: document.data() })),
    );
  }
  return snapshot;
}

export interface IntegrityRunSummary {
  readonly runId: string;
  readonly findings: number;
}

/** Runs every check and writes the report. A run that finds nothing still writes its report. */
export async function runIntegrityCheck(db: Firestore, startedAt: Date): Promise<IntegrityRunSummary> {
  const runId = integrityRunId(startedAt, "scheduled");
  const findings = checkIntegrity(await readIntegritySnapshot(db));
  const records = integrityRecords({
    runId,
    startedAt: Timestamp.fromDate(startedAt),
    finishedAt: Timestamp.now(),
    actor: INTEGRITY_ACTOR,
    writeContext: systemWriteContext(),
    findings,
  });
  for (let start = 0; start < records.findings.length; start += 400) {
    const batch = db.batch();
    for (const finding of records.findings.slice(start, start + 400)) {
      batch.create(
        db.doc(COLLECTIONS.integrityReportFindings.docPath(runId, finding.id)),
        COLLECTIONS.integrityReportFindings.schema.parse(finding.data),
      );
    }
    await batch.commit();
  }
  // The report is written last, so a report that exists has every finding it lists.
  await db
    .doc(COLLECTIONS.integrityReports.docPath(runId))
    .create(COLLECTIONS.integrityReports.schema.parse(records.report));
  return { runId, findings: findings.length };
}
