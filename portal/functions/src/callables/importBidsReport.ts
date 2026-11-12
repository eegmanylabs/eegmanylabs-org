import {
  COLLECTIONS,
  datasetDetailDocSchema,
  importBidsReportContract,
  parseStoredDocument,
  readBidsReport,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { readDataset, requireActive, requireForDataset } from "../datasets/model";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/**
 * Imports the JSON output of a bids-validator run (docs/DATA_MODEL.md, section 10), for a holder
 * of `datasets.manage` for the dataset's replication or laboratory. The validator runs next to
 * the data, at the laboratory or on a lead's machine; the portal never runs it and never sees the
 * recordings. The report is read by `readBidsReport` of the shared package, which knows the
 * output of the 1.x and the schema-based 2.x validators.
 *
 * The registry document, which every member reads, gets the validation status (valid where the
 * report has no error), the counts of errors, warnings and missing metadata, the validator's
 * version and the time. The condensed report and the list of missing metadata, which can name
 * participant labels in their locations, go into the restricted detail of the dataset. The audit
 * entry records the counts.
 */
export const importBidsReport = defineCallable(importBidsReportContract, {
  handler: async (input, context) => {
    const read = readBidsReport(input.report);
    if (!read.ok) throw new AppError("invalid-argument", read.message);
    const { report } = read;
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const detailReference = db.doc(COLLECTIONS.datasetDetail.docPath(input.datasetKey));
      const detail = parseStoredDocument(datasetDetailDocSchema, (await transaction.get(detailReference)).data());
      const bidsStatus = report.errorCount === 0 ? "valid" : "invalid";
      const auditEventId = writeAudit(
        transaction,
        {
          action: "bidsReport.imported",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [
            { field: "bidsStatus", before: dataset.data.bidsStatus, after: bidsStatus },
            { field: "errorCount", after: report.errorCount },
            { field: "warningCount", after: report.warningCount },
            { field: "missingMetadataCount", after: report.missingMetadata.length },
            ...withheldChanges(["detail.bidsReport", "detail.bidsMissingMetadata"]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.update(dataset.reference, {
        bidsStatus,
        bidsSummary: {
          errorCount: report.errorCount,
          warningCount: report.warningCount,
          validatorVersion: input.validatorVersion,
          validatedAt: Timestamp.fromDate(at),
          missingMetadataCount: report.missingMetadata.length,
        },
        ...touchedFields(stamp),
      });
      const base = detail.success ? detail.data : createdFields("datasetDetail", stamp);
      transaction.set(
        detailReference,
        datasetDetailDocSchema.parse({
          ...base,
          bidsReport: {
            format: report.format,
            validatorVersion: input.validatorVersion,
            importedAt: at.toISOString(),
            summary: report.summary,
            issues: report.issues,
          },
          bidsMissingMetadata: [...report.missingMetadata],
          ...touchedFields(stamp),
        }),
      );
      return {
        bidsStatus,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
        missingMetadataCount: report.missingMetadata.length,
      };
    });
  },
});
