import {
  COLLECTIONS,
  countCategoryDocSchema,
  EXCLUSION_REASON_TERM_KIND,
  fileRecruitmentReportsContract,
  parseStoredDocument,
  participationDocSchema,
  type RecruitmentReportInput,
  type ReportFact,
  recruitmentReportDocSchema,
  shiftIsoDate,
  unitScopeKeys,
  vocabularyTermDocSchema,
} from "@eegml/shared";
import { type DocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";
import {
  participationsOfReplication,
  reportFactOf,
  reportsOfReplication,
  requireReportRoom,
  summaryReference,
  writeRecruitmentSummary,
} from "../recruitment/reports";

const NO_PARTICIPATION_MESSAGE = "This participation does not exist, or your account may not open it.";
const NOT_REPORTING_MESSAGE =
  "This laboratory has not confirmed its participation, so it has nothing to report yet. Its status must be confirmed or later.";
const REPLACED_MESSAGE =
  "The report you are replacing has been corrected or withdrawn already. Reload the page and work from the current report.";

/** The statuses of a participation that cannot report: it has not joined, or it declined. */
const NOT_REPORTING: ReadonlySet<string> = new Set(["invited", "interested", "declined"]);

/** Today in UTC, and tomorrow, which is the latest date a report may hold for anywhere on Earth. */
function latestAllowedDate(now: Date): string {
  return shiftIsoDate(now.toISOString().slice(0, 10), 1);
}

const describe = (report: RecruitmentReportInput) =>
  report.entryKind === "void" ? "withdrawal" : report.entryKind === "correction" ? "correction" : "report";

/**
 * Files recruitment reports, one for each participation that changed (D-009, D-019).
 *
 * | Report                               | Who may file it                                                    |
 * |--------------------------------------|--------------------------------------------------------------------|
 * | Lab-reported: new, correction, void  | Holders of `recruitment.report` for the laboratory or the replication: its members, coordinators and leads, the core team and administrators |
 * | Centrally verified: new, correction, void | Holders of `recruitment.verify` for the programme: administrators and the core team, with the second factor |
 *
 * Every category must exist, be current, and be global or of the report's replication; every
 * reason for exclusion must be a current term of the vocabulary of exclusion reasons. A
 * correction or a void names a report of the same participation and basis that nothing has
 * replaced yet, and a verification names a lab-reported report of the same participation that
 * still counts. A report holds for a date that has come. In one transaction the function writes
 * every report with its audit entry and recomputes the recruitment summary of each replication.
 * Nobody may change or delete a report afterwards: the security rules refuse every client write.
 */
export const fileRecruitmentReports = defineCallable(fileRecruitmentReportsContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const latest = latestAllowedDate(at);
    for (const report of input.reports) {
      if (report.asOfDate > latest) {
        throw new AppError(
          "invalid-argument",
          "A report holds for a date that has come. Choose today or an earlier date.",
        );
      }
    }
    const replaced = input.reports.flatMap((report) =>
      report.correctsReportId === undefined ? [] : [report.correctsReportId],
    );
    if (new Set(replaced).size !== replaced.length) {
      throw new AppError("invalid-argument", "Two of these reports replace the same report. Replace it once.");
    }

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);

      // The participations, read once each.
      const participationIds = [...new Set(input.reports.map((report) => report.participationId))];
      const participationSnapshots = await transaction.getAll(
        ...participationIds.map((id) => db.doc(COLLECTIONS.participations.docPath(id))),
      );
      const participations = new Map(
        participationSnapshots.map((snapshot) => {
          const parsed = snapshot.exists ? parseStoredDocument(participationDocSchema, snapshot.data()) : null;
          return [snapshot.id, parsed?.success === true ? parsed.data : null] as const;
        }),
      );

      // Authorisation, before anything else is read.
      for (const report of input.reports) {
        const participation = participations.get(report.participationId) ?? null;
        if (participation === null) throw new AppError("not-found", NO_PARTICIPATION_MESSAGE);
        if (report.basis === "centrallyVerified") {
          requireCapability(context, access, "recruitment.verify", "programme");
        } else {
          requireCapability(context, access, "recruitment.report", {
            replicationId: participation.replicationId,
            laboratoryId: participation.laboratoryId,
          });
        }
        if (participation.archivedAt !== null) {
          throw new AppError("failed-precondition", "This participation is archived, so it takes no reports.");
        }
        if (NOT_REPORTING.has(participation.status)) throw new AppError("failed-precondition", NOT_REPORTING_MESSAGE);
      }

      // The categories and the reasons that the reports name.
      const categoryKeys = [
        ...new Set(
          input.reports.flatMap((report) => Object.values(report.counts).flatMap((counts) => Object.keys(counts))),
        ),
      ];
      const reasonIds = [
        ...new Set(input.reports.flatMap((report) => report.exclusions.map((item) => item.reasonTermId))),
      ];
      const [categorySnapshots, reasonSnapshots] = await Promise.all([
        categoryKeys.length === 0
          ? Promise.resolve([] as DocumentSnapshot[])
          : transaction.getAll(...categoryKeys.map((key) => db.doc(COLLECTIONS.countCategories.docPath(key)))),
        reasonIds.length === 0
          ? Promise.resolve([] as DocumentSnapshot[])
          : transaction.getAll(...reasonIds.map((id) => db.doc(COLLECTIONS.vocabularyTerms.docPath(id)))),
      ]);
      const categories = new Map(
        categorySnapshots.map((snapshot) => {
          const parsed = snapshot.exists ? parseStoredDocument(countCategoryDocSchema, snapshot.data()) : null;
          return [snapshot.id, parsed?.success === true ? parsed.data : null] as const;
        }),
      );
      for (const snapshot of reasonSnapshots) {
        const parsed = snapshot.exists ? parseStoredDocument(vocabularyTermDocSchema, snapshot.data()) : null;
        if (
          parsed?.success !== true ||
          parsed.data.kind !== EXCLUSION_REASON_TERM_KIND ||
          parsed.data.isDeprecated ||
          parsed.data.archivedAt !== null
        ) {
          throw new AppError(
            "invalid-argument",
            "A reason for exclusion is not one the programme uses. Choose another.",
          );
        }
      }
      for (const report of input.reports) {
        const replicationId = participations.get(report.participationId)?.replicationId;
        for (const key of Object.values(report.counts).flatMap((counts) => Object.keys(counts))) {
          const category = categories.get(key) ?? null;
          if (category === null || category.archivedAt !== null) {
            throw new AppError("invalid-argument", `"${key}" is not a category of counts the programme uses.`);
          }
          if (category.replicationId !== undefined && category.replicationId !== replicationId) {
            throw new AppError("invalid-argument", `The category "${category.label}" belongs to another replication.`);
          }
        }
      }

      // The reports that corrections, voids and verifications name, and whether anything has replaced them.
      const named = [
        ...new Set(
          input.reports.flatMap((report) =>
            [report.correctsReportId, report.verifiesReportId].filter((id) => id !== undefined),
          ),
        ),
      ];
      const namedSnapshots =
        named.length === 0
          ? []
          : await transaction.getAll(...named.map((id) => db.doc(COLLECTIONS.recruitmentReports.docPath(id))));
      const namedReports = new Map(
        namedSnapshots.map((snapshot) => [snapshot.id, reportFactOf(snapshot.id, snapshot.data())]),
      );
      const replacements = await Promise.all(
        named.map((id) =>
          transaction.get(
            db.collection(COLLECTIONS.recruitmentReports.collectionPath()).where("correctsReportId", "==", id).limit(1),
          ),
        ),
      );
      const alreadyReplaced = new Set(named.filter((_, index) => replacements[index]?.empty === false));
      for (const report of input.reports) {
        if (report.correctsReportId !== undefined) {
          const target = namedReports.get(report.correctsReportId) ?? null;
          if (target === null || target.participationId !== report.participationId) {
            throw new AppError("not-found", "The report to replace does not exist for this participation.");
          }
          if (target.basis !== report.basis) {
            throw new AppError(
              "invalid-argument",
              "A lab-reported report is replaced by a lab report, and a verification by a verification.",
            );
          }
          if (target.entryKind === "void")
            throw new AppError("invalid-argument", "A withdrawal cannot itself be replaced.");
          if (alreadyReplaced.has(target.id)) throw new AppError("failed-precondition", REPLACED_MESSAGE);
        }
        if (report.verifiesReportId !== undefined) {
          const target = namedReports.get(report.verifiesReportId) ?? null;
          if (target === null || target.participationId !== report.participationId || target.basis !== "labReported") {
            throw new AppError("not-found", "The lab report to verify does not exist for this participation.");
          }
          if (target.entryKind === "void" || alreadyReplaced.has(target.id)) {
            throw new AppError("failed-precondition", REPLACED_MESSAGE);
          }
        }
      }

      // No participation holds more reports than its share, so that no laboratory fills the reports of its replication.
      for (const participationId of participationIds) {
        const adding = input.reports.filter((report) => report.participationId === participationId).length;
        await requireReportRoom(db, transaction, participationId, adding);
      }

      // Everything the summaries need, read before the first write.
      const replicationIds = [
        ...new Set(
          participationIds.map((id) => participations.get(id)?.replicationId).filter((id) => id !== undefined),
        ),
      ];
      const summaries = await Promise.all(
        replicationIds.map(async (replicationId) => ({
          replicationId,
          participations: await participationsOfReplication(db, transaction, replicationId),
          reports: await reportsOfReplication(db, transaction, replicationId),
          existing: await transaction.get(summaryReference(db, replicationId)),
        })),
      );

      // The writes.
      const reportIds: string[] = [];
      const filed: ReportFact[] = [];
      let lastStamp = callerStamp(uid, at, null);
      for (const report of input.reports) {
        const participation = participations.get(report.participationId);
        if (participation === null || participation === undefined) throw new Error("A participation went missing.");
        const reference = db.collection(COLLECTIONS.recruitmentReports.collectionPath()).doc();
        const auditEventId = writeAudit(
          transaction,
          {
            action: "recruitmentReport.filed",
            actor: { kind: "user", uid },
            entityType: "recruitmentReport",
            entityId: reference.id,
            changes: [
              { field: "participationId", after: report.participationId },
              { field: "basis", after: report.basis },
              { field: "entryKind", after: report.entryKind },
              { field: "reportKind", after: report.reportKind },
              { field: "asOfDate", after: report.asOfDate },
              { field: "correctsReportId", after: report.correctsReportId ?? null },
              { field: "verifiesReportId", after: report.verifiesReportId ?? null },
              { field: "counts", after: report.counts },
            ],
            at,
          },
          db,
        );
        const stamp = callerStamp(uid, at, auditEventId);
        lastStamp = stamp;
        const document = recruitmentReportDocSchema.parse({
          schemaVersion: COLLECTIONS.recruitmentReports.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: uid,
          writeContext: stamp.writeContext,
          participationId: report.participationId,
          replicationId: participation.replicationId,
          laboratoryId: participation.laboratoryId,
          scopeKeys: unitScopeKeys(participation.replicationId, participation.laboratoryId),
          asOfDate: report.asOfDate,
          ...(report.periodStart === undefined ? {} : { periodStart: report.periodStart }),
          ...(report.periodEnd === undefined ? {} : { periodEnd: report.periodEnd }),
          reportKind: report.reportKind,
          basis: report.basis,
          entryKind: report.entryKind,
          ...(report.correctsReportId === undefined ? {} : { correctsReportId: report.correctsReportId }),
          ...(report.verifiesReportId === undefined ? {} : { verifiesReportId: report.verifiesReportId }),
          counts: report.counts,
          exclusions: report.exclusions,
          ...(report.note === undefined ? {} : { note: report.note }),
          reportedBy: uid,
          source: "manual",
          dataOrigin: "live",
        });
        transaction.create(reference, document);
        reportIds.push(reference.id);
        const fact = reportFactOf(reference.id, document);
        if (fact === null) throw new Error(`The ${describe(report)} could not be read back.`);
        // The time of the transaction orders it after every stored report.
        filed.push({ ...fact, createdAtMillis: at.getTime() });
      }
      for (const summary of summaries) {
        await writeRecruitmentSummary(
          db,
          transaction,
          summary.replicationId,
          summary.participations.map((participation) => participation.id),
          [
            ...summary.reports,
            ...filed.filter(
              (fact) => participations.get(fact.participationId)?.replicationId === summary.replicationId,
            ),
          ],
          lastStamp,
          summary.existing,
        );
      }
      return { reportIds };
    });
  },
});
