import {
  COLLECTIONS,
  manuscriptDocSchema,
  nestedEntityId,
  parseStoredDocument,
  processingRunDocSchema,
  programmePowersInEffect,
  recordHypothesisFindingContract,
  replicationHypothesisDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import { requireNotArchived } from "../scientific/model";

/**
 * Records an original statistic or a result of a hypothesis with its provenance (requirement
 * R12.1), for a holder of `replications.manage` for the replication. The text is written exactly
 * as given, with the source, the place in it, the recorder and the request time beside it, so a
 * finding is never stored without where it comes from and nothing is prefilled.
 *
 * A lead records nothing once the result is reviewed or the hypothesis is verified, as the
 * security rules decide for the rest of its content; programme staff still may. A new result or
 * new original statistics clear the review, which covered what they replace, and return a
 * verified hypothesis to review. An analysis run or an output
 * named as the source belongs to the hypothesis's replication, and a run tests the hypothesis.
 */
export const recordHypothesisFinding = defineCallable(recordHypothesisFindingContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const { provenance } = input;
    if (provenance.source === "analysisRun" && provenance.analysisRunId === null) {
      throw new AppError("invalid-argument", "Name the analysis run the value comes from.");
    }
    if (provenance.source === "manuscript" && provenance.manuscriptId === null) {
      throw new AppError("invalid-argument", "Name the output the value comes from.");
    }
    if (
      input.finding === "originalStatistics" &&
      (provenance.source === "analysisRun" || provenance.source === "manuscript")
    ) {
      throw new AppError(
        "invalid-argument",
        "An original statistic comes from the original study: its article, its supplement, its authors or a reanalysis.",
      );
    }
    if (input.finding === "originalStatistics" && input.analysisStatus !== null) {
      throw new AppError("invalid-argument", "The state of the analysis belongs to a result.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      requireCapability(context, access, "replications.manage", { replicationId: input.replicationId });
      const reference = db.doc(COLLECTIONS.replicationHypotheses.docPath(input.replicationId, input.hypothesisId));
      const parsed = parseStoredDocument(replicationHypothesisDocSchema, (await transaction.get(reference)).data());
      if (!parsed.success) throw new AppError("not-found", "This hypothesis does not exist.");
      const hypothesis = parsed.data;
      requireNotArchived(hypothesis, "hypothesis");
      const staff =
        programmePowersInEffect(access, { secondFactorVerified: context.secondFactorVerified }) &&
        access.programmeRoles.some((role) => role === "programme_admin" || role === "core_team");
      if (!staff && (hypothesis.resultReviewedBy !== null || hypothesis.scientificReviewStatus === "verified")) {
        throw new AppError(
          "failed-precondition",
          "This hypothesis has been reviewed or verified. Ask the core team to record a change.",
        );
      }
      if (provenance.analysisRunId !== null) {
        const run = parseStoredDocument(
          processingRunDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.processingRuns.docPath(provenance.analysisRunId)))).data(),
        );
        if (
          !run.success ||
          run.data.replicationId !== input.replicationId ||
          !run.data.hypothesisIds.includes(input.hypothesisId)
        ) {
          throw new AppError("invalid-argument", "The analysis run named is not one that tests this hypothesis.");
        }
      }
      if (provenance.manuscriptId !== null) {
        const manuscript = parseStoredDocument(
          manuscriptDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.manuscripts.docPath(provenance.manuscriptId)))).data(),
        );
        if (!manuscript.success || manuscript.data.replicationId !== input.replicationId) {
          throw new AppError("invalid-argument", "The output named is not one of this replication.");
        }
      }

      const textField = input.finding === "originalStatistics" ? "originalStatistics" : "resultSummary";
      const provenanceField =
        input.finding === "originalStatistics" ? "originalStatisticsProvenance" : "resultProvenance";
      // A review and a verification cover the whole reviewed content, the original statistics as
      // much as the result (`reviewedContent()` in the security rules), so whoever changes either
      // clears the review, and a verified hypothesis goes back to review.
      const reviewCleared = hypothesis.resultReviewedBy !== null || hypothesis.resultReviewedAt !== null;
      const verificationLifted = hypothesis.scientificReviewStatus === "verified";
      const auditEventId = writeAudit(
        transaction,
        {
          action: "hypothesis.findingRecorded",
          actor: { kind: "user", uid: context.uid },
          entityType: "hypothesis",
          entityId: nestedEntityId(input.replicationId, input.hypothesisId),
          changes: [
            { field: textField, before: hypothesis[textField] ?? null, after: input.text },
            { field: `${provenanceField}.source`, after: provenance.source },
            { field: `${provenanceField}.locator`, after: provenance.locator },
            ...(input.analysisStatus === null
              ? []
              : [{ field: "analysisStatus", before: hypothesis.analysisStatus, after: input.analysisStatus }]),
            ...(reviewCleared ? [{ field: "resultReviewedBy", before: hypothesis.resultReviewedBy, after: null }] : []),
            ...(verificationLifted
              ? [{ field: "scientificReviewStatus", before: "verified", after: "underReview" }]
              : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const recorded = {
        source: provenance.source,
        locator: provenance.locator,
        ...(provenance.url === null ? {} : { url: provenance.url }),
        ...(provenance.analysisRunId === null ? {} : { analysisRunId: provenance.analysisRunId }),
        ...(provenance.manuscriptId === null ? {} : { manuscriptId: provenance.manuscriptId }),
        recordedBy: context.uid,
        recordedAt: Timestamp.fromDate(at),
      };
      transaction.update(reference, {
        [textField]: input.text,
        [provenanceField]: recorded,
        ...(input.analysisStatus === null ? {} : { analysisStatus: input.analysisStatus }),
        ...(reviewCleared ? { resultReviewedBy: null, resultReviewedAt: null } : {}),
        ...(verificationLifted ? { scientificReviewStatus: "underReview" } : {}),
        ...touchedFields(stamp),
      });
      return { hypothesisId: input.hypothesisId };
    });
  },
});
