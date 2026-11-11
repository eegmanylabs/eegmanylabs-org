// What the functions of recruitment share (docs/DATA_MODEL.md, sections 5, 7 and 15): reading
// the reports of a replication as the resolver of the shared package reads them, and the summary
// of a replication that every member may read, recomputed in the transaction that files a report.
import {
  COLLECTIONS,
  isFirestoreTimestamp,
  type ParticipationFacts,
  type PauseFact,
  parseStoredDocument,
  participationDocSchema,
  plannedPauseDocSchema,
  type ReportFact,
  recruitmentReportDocSchema,
  replicationSummaryDocSchema,
  summaryTotals,
} from "@eegml/shared";
import {
  type DocumentSnapshot,
  type Firestore,
  type Query,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { createdFields, touchedFields, type WriteStamp } from "../framework/documents";
import { AppError } from "../framework/errors";

/**
 * The most reports of one replication that a transaction reads. A summary or a forecast of more
 * is refused, never worked out from part of the reports.
 */
export const REPLICATION_REPORTS_MAX = 5_000;

/**
 * The most reports one participation holds: weekly reports with their corrections for several
 * years. It keeps one laboratory from filling the reports of its replication on its own.
 */
export const PARTICIPATION_REPORTS_MAX = 400;

const TOO_MANY_REPORTS_MESSAGE =
  "This replication holds more reports than its summary can be worked out from. Ask a programme administrator to review its reports.";

/** The kind of the summary that holds recruitment totals. */
export const RECRUITMENT_SUMMARY_KIND = "recruitment";

/** A date after every report, so that a summary holds the latest value of every key. */
const LATEST = "9999-12-31";

/** A stored report as the resolver reads it. */
export function reportFactOf(id: string, data: unknown): ReportFact | null {
  const parsed = parseStoredDocument(recruitmentReportDocSchema, data);
  if (!parsed.success) return null;
  const report = parsed.data;
  return {
    id,
    participationId: report.participationId,
    asOfDate: report.asOfDate,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    reportKind: report.reportKind,
    basis: report.basis,
    entryKind: report.entryKind,
    correctsReportId: report.correctsReportId,
    verifiesReportId: report.verifiesReportId,
    counts: report.counts,
    exclusions: report.exclusions,
    createdAtMillis: isFirestoreTimestamp(report.createdAt) ? report.createdAt.toMillis() : 0,
    dataOrigin: report.dataOrigin,
  };
}

type Reader = Pick<Transaction, "get"> | null;

async function query(reader: Reader, target: Query) {
  return reader === null ? target.get() : reader.get(target);
}

/** The reports of a replication, as stored, or a refusal where there are more than `most`. */
export async function reportsOfReplication(
  db: Firestore,
  reader: Reader,
  replicationId: string,
  most: number = REPLICATION_REPORTS_MAX,
): Promise<ReportFact[]> {
  const found = await query(
    reader,
    db
      .collection(COLLECTIONS.recruitmentReports.collectionPath())
      .where("replicationId", "==", replicationId)
      .limit(most + 1),
  );
  // A partial set would let the reports that fall outside it vanish from every figure unseen.
  if (found.size > most) throw new AppError("resource-exhausted", TOO_MANY_REPORTS_MESSAGE);
  return found.docs.map((document) => reportFactOf(document.id, document.data())).filter((fact) => fact !== null);
}

/** The participations of a replication, as rollups and forecasts read them. */
export async function participationsOfReplication(
  db: Firestore,
  reader: Reader,
  replicationId: string,
): Promise<ParticipationFacts[]> {
  const found = await query(
    reader,
    db.collection(COLLECTIONS.participations.collectionPath()).where("replicationId", "==", replicationId).limit(1_000),
  );
  const facts: ParticipationFacts[] = [];
  for (const document of found.docs) {
    const parsed = parseStoredDocument(participationDocSchema, document.data());
    if (!parsed.success || parsed.data.archivedAt !== null) continue;
    facts.push({
      id: document.id,
      replicationId: parsed.data.replicationId,
      laboratoryId: parsed.data.laboratoryId,
      status: parsed.data.status,
      countryCode: null,
      institutionId: null,
      targetNMain: parsed.data.targetNMain ?? null,
      targetNRest: parsed.data.targetNRest ?? null,
    });
  }
  return facts.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The planned pauses of a replication that are not archived. */
export async function pausesOfReplication(db: Firestore, reader: Reader, replicationId: string): Promise<PauseFact[]> {
  const found = await query(
    reader,
    db.collection(COLLECTIONS.plannedPauses.collectionPath()).where("replicationId", "==", replicationId).limit(1_000),
  );
  const pauses: PauseFact[] = [];
  for (const document of found.docs) {
    const parsed = parseStoredDocument(plannedPauseDocSchema, document.data());
    if (!parsed.success || parsed.data.archivedAt !== null) continue;
    pauses.push({
      participationId: parsed.data.participationId,
      startsOn: parsed.data.startsOn,
      endsOn: parsed.data.endsOn,
    });
  }
  return pauses;
}

/**
 * Writes the recruitment summary of a replication from its participations and every report,
 * those of this transaction included. Lab-reported and verified totals stay apart, an unknown
 * value stays absent, and `reporting` says how many participations state each value.
 */
export async function writeRecruitmentSummary(
  db: Firestore,
  transaction: Transaction,
  replicationId: string,
  participationIds: readonly string[],
  reports: readonly ReportFact[],
  stamp: WriteStamp,
  existing: DocumentSnapshot,
): Promise<void> {
  const { totals, reporting, latestAsOfDate } = summaryTotals(participationIds, reports, LATEST);
  const fields = {
    replicationId,
    kind: RECRUITMENT_SUMMARY_KIND,
    totals,
    reporting,
    participationCount: participationIds.length,
    reportCount: reports.length,
    latestAsOfDate,
    computedAt: Timestamp.fromDate(stamp.at),
  };
  const reference = db.doc(COLLECTIONS.replicationSummaries.docPath(replicationId, RECRUITMENT_SUMMARY_KIND));
  if (existing.exists) {
    const created = existing.data() ?? {};
    transaction.set(
      reference,
      replicationSummaryDocSchema.parse({
        schemaVersion: COLLECTIONS.replicationSummaries.schemaVersion,
        createdAt: created.createdAt,
        createdBy: created.createdBy,
        archivedAt: null,
        ...touchedFields(stamp),
        ...fields,
      }),
    );
  } else {
    transaction.set(
      reference,
      replicationSummaryDocSchema.parse({ ...createdFields("replicationSummaries", stamp), ...fields }),
    );
  }
}

/** The reference of the recruitment summary of a replication, to read before the first write. */
export function summaryReference(db: Firestore, replicationId: string) {
  return db.doc(COLLECTIONS.replicationSummaries.docPath(replicationId, RECRUITMENT_SUMMARY_KIND));
}

/**
 * Refuses more reports for a participation that would then hold more than `most`, so that no
 * laboratory fills the reports of its replication on its own. Read in the transaction that files them.
 */
export async function requireReportRoom(
  db: Firestore,
  transaction: Transaction,
  participationId: string,
  adding: number,
  most: number = PARTICIPATION_REPORTS_MAX,
): Promise<void> {
  const counted = await transaction.get(
    db
      .collection(COLLECTIONS.recruitmentReports.collectionPath())
      .where("participationId", "==", participationId)
      .count(),
  );
  if (counted.data().count + adding > most) {
    throw new AppError(
      "resource-exhausted",
      `A participation holds at most ${most} reports, and this one has reached it. Ask a programme administrator to review its reports.`,
    );
  }
}
