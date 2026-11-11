import { createLaboratoryContract } from "@eegml/shared";
import {
  AppError,
  callerStamp,
  defineCallable,
  identityHashKey,
  readAccessDocument,
  requireCapability,
  writeAudit,
} from "../framework";
import { proposalOf, readRegistration, writeRegistration } from "../laboratories/registration";

/**
 * Creates a laboratory directly, without a request from a member. Capability: `labs.manage` for
 * the programme, which programme administrators and the core team hold, with the second factor
 * wherever the access document requires one.
 *
 * The laboratory takes the identifier of its name key at its institution, as a registered one
 * does, and a new institution is created with it. A laboratory that exists under that key
 * already is refused as a duplicate and nothing is written. In one transaction the function
 * writes the laboratory, the institution where it is new, their identity keys and an audit
 * entry for each record it creates.
 */
export const createLaboratory = defineCallable(createLaboratoryContract, {
  usesIdentityHashKey: true,
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const proposal = proposalOf(input);
    const secret = identityHashKey();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(context, access, "labs.manage", "programme");
      const registration = await readRegistration(db, transaction, proposal, secret);
      if (registration.existingLaboratoryId !== null) {
        throw new AppError(
          "already-exists",
          "A laboratory with this name at this institution exists already. Open it from the list of laboratories.",
        );
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "laboratory.created",
          actor: { kind: "user", uid },
          entityType: "laboratory",
          entityId: registration.laboratoryId,
          changes: [
            { field: "name", after: proposal.name },
            { field: "institutionId", after: proposal.institutionId },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const { institutionCreated } = writeRegistration(transaction, registration, stamp, "active");
      if (institutionCreated) {
        writeAudit(
          transaction,
          {
            action: "institution.created",
            actor: { kind: "user", uid },
            entityType: "institution",
            entityId: proposal.institutionId,
            changes: [{ field: "name", after: proposal.newInstitution?.name ?? null }],
            at,
            context: { causationId: auditEventId },
          },
          db,
        );
      }
      return { laboratoryId: registration.laboratoryId, institutionId: proposal.institutionId, institutionCreated };
    });
  },
});
