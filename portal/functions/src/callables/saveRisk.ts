import { COLLECTIONS, parseStoredDocument, type RiskDoc, riskDocSchema, saveRiskContract } from "@eegml/shared";
import { type DocumentReference, FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  writeAudit,
} from "../framework";
import { governanceScope, requireNotArchived, startOfDay } from "../scientific/model";

const RISK_NOT_FOUND_MESSAGE = "This risk does not exist, or your account may not change it.";

/**
 * Enters a risk in the register of a replication, a laboratory or the programme (requirement
 * R7.8), or changes one. Capability: `participations.manage` for the scope of the risk, which
 * the leads of a replication, the coordinators of a laboratory and programme staff hold. A risk
 * stays in the scope it was entered in. A risk that is closed records when; one opened again
 * clears that date. The owner named is a person of the directory. The risk and its audit entry
 * are written in one transaction.
 */
export const saveRisk = defineCallable(saveRiskContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      let existing: { readonly reference: DocumentReference; readonly data: RiskDoc } | null = null;
      if (input.riskId !== null) {
        const reference = db.doc(COLLECTIONS.risks.docPath(input.riskId));
        const parsed = parseStoredDocument(riskDocSchema, (await transaction.get(reference)).data());
        if (!parsed.success) throw new AppError("not-found", RISK_NOT_FOUND_MESSAGE);
        existing = { reference, data: parsed.data };
      }
      if (
        existing !== null &&
        (existing.data.scopeType !== input.scopeType || existing.data.scopeId !== input.scopeId)
      ) {
        throw new AppError("invalid-argument", "A risk stays in the register it was entered in.");
      }
      const scope = await governanceScope(db, transaction, context, access, input.scopeType, input.scopeId, {
        replication: "participations.manage",
        laboratory: "participations.manage",
        programme: "participations.manage",
      });
      if (existing !== null) requireNotArchived(existing.data, "risk");
      if (input.ownerPersonId !== null) {
        const owner = await transaction.get(db.doc(COLLECTIONS.persons.docPath(input.ownerPersonId)));
        if (!owner.exists) throw new AppError("invalid-argument", "The owner named is not a person of the directory.");
      }

      const reference = existing?.reference ?? db.collection(COLLECTIONS.risks.collectionPath()).doc();
      const closing = input.status === "closed";
      const closedAt = closing ? (existing?.data.closedAt ?? Timestamp.fromDate(at)) : null;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "risk.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "risk",
          entityId: reference.id,
          changes: [
            { field: "status", before: existing?.data.status ?? null, after: input.status },
            { field: "likelihood", before: existing?.data.likelihood ?? null, after: input.likelihood },
            { field: "impact", before: existing?.data.impact ?? null, after: input.impact },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const optional = {
        description: input.description,
        mitigation: input.mitigation,
        ownerPersonId: input.ownerPersonId,
        reviewAt: input.reviewAt === null ? null : Timestamp.fromDate(startOfDay(input.reviewAt)),
      };
      const fields = {
        title: input.title,
        likelihood: input.likelihood,
        impact: input.impact,
        status: input.status,
        closedAt,
      };
      if (existing === null) {
        transaction.create(
          reference,
          riskDocSchema.parse({
            ...createdFields("risks", stamp),
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            ...fields,
            ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null)),
            identifiedAt: Timestamp.fromDate(at),
            pageId: null,
            ...scope,
          }),
        );
      } else {
        const update: Record<string, unknown> = { ...fields, ...touchedFields(stamp) };
        for (const [field, value] of Object.entries(optional)) update[field] = value ?? FieldValue.delete();
        transaction.update(reference, update);
      }
      return { riskId: reference.id };
    });
  },
});
