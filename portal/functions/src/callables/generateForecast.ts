import {
  COLLECTIONS,
  FORECAST_METHOD_VERSION,
  forecastRecruitment,
  forecastRunDocSchema,
  forecastRunMaps,
  generateForecastContract,
  shiftIsoDate,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";
import { participationsOfReplication, pausesOfReplication, reportsOfReplication } from "../recruitment/reports";

/**
 * Runs the recruitment forecast of a replication under stated assumptions and stores the run
 * (docs/DATA_MODEL.md, section 15). Capability: `replications.manage` for the replication, held
 * by its leads, the core team and administrators.
 *
 * The function reads the participations, every report and the planned pauses of the replication
 * itself and computes the forecast with `forecastRecruitment` of the shared package, the same
 * method the forecast page runs in the browser, so a stored run never rests on figures that a
 * browser sent. The active participations must belong to the replication, and the inputs must
 * hold for a date that has come. The run is labelled projected, names its method and the date
 * of its inputs, and never changes once stored.
 */
export const generateForecast = defineCallable(generateForecastContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const { replicationId, assumptions } = input;
    if (assumptions.inputsAsOf > shiftIsoDate(at.toISOString().slice(0, 10), 1)) {
      throw new AppError("invalid-argument", "A forecast starts from reports up to a date that has come.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(context, access, "replications.manage", { replicationId });
      const replication = await transaction.get(db.doc(COLLECTIONS.replications.docPath(replicationId)));
      if (!replication.exists) throw new AppError("not-found", "This replication does not exist.");
      const participations = await participationsOfReplication(db, transaction, replicationId);
      const known = new Set(participations.map((participation) => participation.id));
      if (assumptions.activeParticipationIds.some((id) => !known.has(id))) {
        throw new AppError("invalid-argument", "An active participation named is not one of this replication.");
      }
      const reports = await reportsOfReplication(db, transaction, replicationId);
      const pauses = await pausesOfReplication(db, transaction, replicationId);
      const result = forecastRecruitment(participations, reports, pauses, assumptions);
      const maps = forecastRunMaps(assumptions, result);
      const reference = db.collection(COLLECTIONS.forecastRuns.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "forecast.generated",
          actor: { kind: "user", uid },
          entityType: "replication",
          entityId: replicationId,
          changes: [
            { field: "forecastRunId", after: reference.id },
            { field: "inputsAsOf", after: assumptions.inputsAsOf },
            { field: "methodVersion", after: FORECAST_METHOD_VERSION },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      transaction.create(
        reference,
        forecastRunDocSchema.parse({
          schemaVersion: COLLECTIONS.forecastRuns.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: uid,
          writeContext: stamp.writeContext,
          replicationId,
          generatedAt: Timestamp.fromDate(at),
          generatedBy: uid,
          methodVersion: FORECAST_METHOD_VERSION,
          assumptions: maps.assumptions,
          scenarios: maps.scenarios,
          inputsAsOf: assumptions.inputsAsOf,
          dataOrigin: "projected",
        }),
      );
      return { forecastRunId: reference.id };
    });
  },
});
