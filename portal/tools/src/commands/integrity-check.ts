// integrity:check [--production --project <identifier>]
//
// Runs the referential-integrity checker of the shared package over the collections it names and
// writes the report with its findings to `integrityReports`, as the scheduled function
// `integritySweep` does every night. It reads and reports only: a person decides what to
// correct. The findings carry identifiers and counts, never a personal value.
import {
  type CheckedDocument,
  COLLECTIONS,
  type CollectionEntry,
  checkIntegrity,
  INTEGRITY_COLLECTIONS,
  type IntegrityCollection,
  type IntegrityFinding,
  integrityRecords,
  integrityRunId,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";

/** The actor recorded on a report that this command writes. */
export const INTEGRITY_CHECK_ACTOR = systemActor("integrityCheck");

export interface IntegrityCheckResult {
  readonly runId: string;
  readonly findings: readonly IntegrityFinding[];
}

/** Reads the collections, runs every check and writes the report, the findings first. */
export async function checkAndRecordIntegrity(
  db: Firestore,
  startedAt: Date = new Date(),
): Promise<IntegrityCheckResult> {
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
  const findings = checkIntegrity(snapshot);
  const runId = integrityRunId(startedAt, "tools");
  const records = integrityRecords({
    runId,
    startedAt: Timestamp.fromDate(startedAt),
    finishedAt: Timestamp.now(),
    actor: INTEGRITY_CHECK_ACTOR,
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
  await db
    .doc(COLLECTIONS.integrityReports.docPath(runId))
    .create(COLLECTIONS.integrityReports.schema.parse(records.report));
  return { runId, findings };
}

const USAGE = "Usage: integrity:check [--production --project <identifier>]";

export const integrityCheckCommand: Command = {
  name: "integrity:check",
  summary: "Check references, identifiers, account links and derived values, and write an integrity report.",
  async run(args) {
    let production = false;
    let projectId: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--production") production = true;
      else if (argument === "--project") {
        projectId = args[index + 1];
        if (projectId === undefined || projectId.startsWith("--"))
          throw new ToolRefusal(`--project needs a value.\n\n${USAGE}`);
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    if (target.kind === "production") db = connectToProject(target.projectId).db;
    else {
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const { runId, findings } = await checkAndRecordIntegrity(db);
    const counts = new Map<string, number>();
    for (const finding of findings) counts.set(finding.check, (counts.get(finding.check) ?? 0) + 1);
    console.log(
      `integrity:check in ${target.projectId}: report ${runId}, ${findings.length} findings` +
        (findings.length === 0 ? "." : `: ${[...counts].map(([check, count]) => `${check} ${count}`).join(", ")}.`),
    );
    return undefined;
  },
};
