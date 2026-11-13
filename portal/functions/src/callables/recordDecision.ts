import {
  COLLECTIONS,
  decisionDocSchema,
  parseStoredDocument,
  personDocSchema,
  recordDecisionContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, callerStamp, defineCallable, readAccessDocument, writeAudit } from "../framework";
import { governanceScope, requireDeviationsInScope } from "../scientific/model";

/**
 * Appends an entry to the methodological decision log (requirement R12.6). Capability:
 * `replications.manage` for a replication or for the programme, `labs.manage` for a laboratory.
 *
 * The log never changes. A correction names the first entry of the decision it corrects, in the
 * same scope, and states its content in full; a decision that replaces another names it, in the
 * same scope, and the other then reads as superseded. A deviation named belongs to a
 * participation of the scope, which is how a decision answers a deviation.
 */
export const recordDecision = defineCallable(recordDecisionContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if ((input.kind === "correction") !== (input.correctsDecisionId !== null)) {
      throw new AppError(
        "invalid-argument",
        "A correction names the decision it corrects, and only a correction does.",
      );
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const scope = await governanceScope(db, transaction, context, access, input.scopeType, input.scopeId, {
        replication: "replications.manage",
        laboratory: "labs.manage",
        programme: "replications.manage",
      });
      const sameScope = async (id: string, what: string) => {
        const entry = parseStoredDocument(
          decisionDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.decisions.docPath(id)))).data(),
        );
        if (!entry.success || entry.data.scopeType !== input.scopeType || entry.data.scopeId !== input.scopeId) {
          throw new AppError("invalid-argument", `The decision ${what} is not in the log of this scope.`);
        }
        return entry.data;
      };
      if (input.correctsDecisionId !== null) {
        const corrected = await sameScope(input.correctsDecisionId, "corrected");
        if (corrected.kind === "correction") {
          throw new AppError("invalid-argument", "Correct the decision itself: name its first entry.");
        }
      }
      if (input.supersedesDecisionId !== null) await sameScope(input.supersedesDecisionId, "replaced");
      if (input.ownerPersonId !== null) {
        const owner = parseStoredDocument(
          personDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.persons.docPath(input.ownerPersonId)))).data(),
        );
        if (!owner.success) throw new AppError("invalid-argument", "The owner named is not in the directory.");
      }
      await requireDeviationsInScope(db, transaction, input.deviations, scope);

      const reference = db.collection(COLLECTIONS.decisions.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "decision.recorded",
          actor: { kind: "user", uid: context.uid },
          entityType: "decision",
          entityId: reference.id,
          changes: [
            { field: "kind", after: input.kind },
            { field: "status", after: input.status },
            ...(input.correctsDecisionId === null
              ? []
              : [{ field: "correctsDecisionId", after: input.correctsDecisionId }]),
            ...(input.supersedesDecisionId === null
              ? []
              : [{ field: "supersedesDecisionId", after: input.supersedesDecisionId }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.create(
        reference,
        decisionDocSchema.parse({
          schemaVersion: COLLECTIONS.decisions.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: context.uid,
          writeContext: stamp.writeContext,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          kind: input.kind,
          title: input.title,
          summary: input.summary,
          ...(input.rationale === null ? {} : { rationale: input.rationale }),
          ...(input.outcome === null ? {} : { outcome: input.outcome }),
          status: input.status,
          ...(input.ownerPersonId === null ? {} : { ownerPersonId: input.ownerPersonId }),
          ...(input.decidedAt === null ? {} : { decidedAt: input.decidedAt }),
          ...(input.supersedesDecisionId === null ? {} : { supersedesDecisionId: input.supersedesDecisionId }),
          ...(input.correctsDecisionId === null ? {} : { correctsDecisionId: input.correctsDecisionId }),
          deviations: input.deviations,
          recordedBy: context.uid,
          ...scope,
        }),
      );
      return { decisionId: reference.id };
    });
  },
});
