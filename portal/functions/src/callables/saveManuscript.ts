import {
  COLLECTIONS,
  datasetDocSchema,
  manuscriptDocSchema,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  saveManuscriptContract,
  unitScopeKeys,
} from "@eegml/shared";
import { FieldValue } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  writeAudit,
} from "../framework";
import { readManuscript, requireNotArchived, requireOutputManager, requireReplication } from "../scientific/model";

/** The fields of a manuscript that a citation check covers, which stay while the check says anything but unverified. */
const CHECKED_BY_CITATION = ["title", "journal", "doi", "preprintDoi", "authorsShort"] as const;

/**
 * Creates or changes a scientific output (requirement R12.10): a Registered Report at Stage 1 or
 * Stage 2, a preprint, an article, a data paper, software or a dataset. Capability:
 * `replications.manage` for its replication, or for the programme for an output of the programme.
 *
 * A new output starts as `planned`, and its status moves only with an event
 * (`recordManuscriptEvent`). A Stage 2 report names its Stage 1 report, of the same replication;
 * the hypotheses it reports and the datasets it describes are of the same replication. Once a
 * citation check has passed, the fields it covers stay as they were checked. The identifier of
 * a new output is one that Firestore generates, which never takes the form an importer derives.
 */
export const saveManuscript = defineCallable(saveManuscriptContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    if (input.stage1ManuscriptId !== null && input.kind !== "stage2Rr") {
      throw new AppError("invalid-argument", "Only a Stage 2 report names a Stage 1 report.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const existing = input.manuscriptId === null ? null : await readManuscript(db, transaction, input.manuscriptId);
      const replicationId = existing === null ? input.replicationId : (existing.data.replicationId ?? null);
      if (existing !== null && (existing.data.replicationId ?? null) !== input.replicationId) {
        throw new AppError("invalid-argument", "An output stays with the replication it belongs to.");
      }
      requireOutputManager(context, access, replicationId);
      if (existing !== null) requireNotArchived(existing.data, "output");
      if (replicationId !== null) await requireReplication(db, transaction, replicationId);
      if (replicationId === null && (input.hypothesisIds.length > 0 || input.datasetIds.length > 0)) {
        throw new AppError(
          "invalid-argument",
          "An output of the programme names no hypotheses or datasets of a replication.",
        );
      }
      if (input.stage1ManuscriptId !== null) {
        const stage1 = parseStoredDocument(
          manuscriptDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.manuscripts.docPath(input.stage1ManuscriptId)))).data(),
        );
        if (
          !stage1.success ||
          stage1.data.kind !== "stage1Rr" ||
          (stage1.data.replicationId ?? null) !== replicationId
        ) {
          throw new AppError(
            "invalid-argument",
            "The Stage 1 report named is not a Stage 1 report of this replication.",
          );
        }
      }
      for (const hypothesisId of input.hypothesisIds) {
        const found = await transaction.get(
          db.doc(COLLECTIONS.replicationHypotheses.docPath(replicationId ?? "", hypothesisId)),
        );
        if (!found.exists) throw new AppError("invalid-argument", "A hypothesis named is not one of this replication.");
      }
      for (const datasetId of input.datasetIds) {
        const dataset = parseStoredDocument(
          datasetDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.datasets.docPath(datasetId)))).data(),
        );
        if (!dataset.success || dataset.data.replicationId !== replicationId) {
          throw new AppError("invalid-argument", "A dataset named is not one of this replication.");
        }
      }
      if (existing !== null && (existing.data.citationStatus ?? "unverified") !== "unverified") {
        const stored = existing.data;
        const changed = CHECKED_BY_CITATION.some((field) => (stored[field] ?? null) !== input[field]);
        if (changed) {
          throw new AppError(
            "failed-precondition",
            "The citation of this output has been checked, so its title, journal, DOIs and authors stay as they were checked.",
          );
        }
      }

      const reference =
        existing === null ? db.collection(COLLECTIONS.manuscripts.collectionPath()).doc() : existing.reference;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "manuscript.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "manuscript",
          entityId: reference.id,
          changes: [
            { field: "kind", before: existing?.data.kind ?? null, after: input.kind },
            { field: "title", before: existing?.data.title ?? null, after: input.title },
            { field: "stage1ManuscriptId", after: input.stage1ManuscriptId },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const optional = {
        journal: input.journal,
        doi: input.doi,
        preprintDoi: input.preprintDoi,
        osfUrl: input.osfUrl,
        authorsShort: input.authorsShort,
        stage1ManuscriptId: input.stage1ManuscriptId,
        repositoryUrl: input.repositoryUrl,
        outputVersion: input.outputVersion,
      };
      const lists = {
        hypothesisIds: input.hypothesisIds,
        datasetIds: input.datasetIds,
      };
      if (existing === null) {
        transaction.create(
          reference,
          manuscriptDocSchema.parse({
            ...createdFields("manuscripts", stamp),
            ...(replicationId === null ? {} : { replicationId }),
            title: input.title,
            kind: input.kind,
            status: "planned",
            statusHistoryId: null,
            ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null)),
            ...Object.fromEntries(Object.entries(lists).filter(([, value]) => value.length > 0)),
            custom: {},
            scopeKeys: replicationId === null ? [PROGRAMME_SCOPE_KEY] : unitScopeKeys(replicationId, null),
          }),
        );
      } else {
        const update: Record<string, unknown> = { title: input.title, kind: input.kind, ...touchedFields(stamp) };
        for (const [field, value] of Object.entries(optional)) update[field] = value ?? FieldValue.delete();
        for (const [field, value] of Object.entries(lists))
          update[field] = value.length > 0 ? value : FieldValue.delete();
        transaction.update(reference, update);
      }
      return { manuscriptId: reference.id };
    });
  },
});
