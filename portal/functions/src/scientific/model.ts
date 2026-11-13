// What the callable functions of the scientific workflows share: reading the records they check
// and deciding who may write in a scope (docs/DATA_MODEL.md, section 11).
import {
  type Capability,
  COLLECTIONS,
  type DeviationRef,
  laboratoryDocSchema,
  type ManuscriptDoc,
  manuscriptDocSchema,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  participationDeviationDocSchema,
  participationDocSchema,
  type ResolvedAccess,
  replicationDocSchema,
  unitScopeKeys,
} from "@eegml/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { AppError, type AuthenticatedContext, requireCapability } from "../framework";

export const REPLICATION_NOT_FOUND_MESSAGE = "This replication does not exist.";
export const MANUSCRIPT_NOT_FOUND_MESSAGE = "This output does not exist.";

/** The scope of a record of the decision log or the incident registry. */
export interface GovernanceScope {
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
  readonly scopeKeys: string[];
}

/** Refuses a replication that does not exist or is archived. */
export async function requireReplication(db: Firestore, transaction: Transaction, studyKey: string): Promise<void> {
  const parsed = parseStoredDocument(
    replicationDocSchema,
    (await transaction.get(db.doc(COLLECTIONS.replications.docPath(studyKey)))).data(),
  );
  if (!parsed.success || parsed.data.archivedAt !== null) {
    throw new AppError("not-found", REPLICATION_NOT_FOUND_MESSAGE);
  }
}

/** Refuses a laboratory that does not exist or is archived. */
export async function requireLaboratory(db: Firestore, transaction: Transaction, laboratoryId: string): Promise<void> {
  const parsed = parseStoredDocument(
    laboratoryDocSchema,
    (await transaction.get(db.doc(COLLECTIONS.laboratories.docPath(laboratoryId)))).data(),
  );
  if (!parsed.success || parsed.data.archivedAt !== null) {
    throw new AppError("not-found", "This laboratory does not exist.");
  }
}

/**
 * Checks the caller's capability for a scope of the decision log or the incident registry, and
 * that the scope exists, and returns its scope fields. The programme as a whole is a scope of
 * the decision log alone.
 */
export async function governanceScope(
  db: Firestore,
  transaction: Transaction,
  context: AuthenticatedContext,
  access: ResolvedAccess,
  scopeType: "programme" | "replication" | "laboratory",
  scopeId: string,
  capabilities: { readonly replication: Capability; readonly laboratory: Capability; readonly programme: Capability },
): Promise<GovernanceScope> {
  if (scopeType === "programme") {
    requireCapability(context, access, capabilities.programme, "programme");
    return { replicationId: null, laboratoryId: null, scopeKeys: [PROGRAMME_SCOPE_KEY] };
  }
  if (scopeType === "replication") {
    requireCapability(context, access, capabilities.replication, { replicationId: scopeId });
    await requireReplication(db, transaction, scopeId);
    return { replicationId: scopeId, laboratoryId: null, scopeKeys: unitScopeKeys(scopeId, null) };
  }
  requireCapability(context, access, capabilities.laboratory, { laboratoryId: scopeId });
  await requireLaboratory(db, transaction, scopeId);
  return { replicationId: null, laboratoryId: scopeId, scopeKeys: unitScopeKeys(null, scopeId) };
}

/** Whether a participation belongs to a scope: to its replication or to its laboratory. */
function participationInScope(
  participation: { readonly replicationId: string; readonly laboratoryId: string },
  scope: Pick<GovernanceScope, "replicationId" | "laboratoryId">,
): boolean {
  return (
    (scope.replicationId !== null && participation.replicationId === scope.replicationId) ||
    (scope.laboratoryId !== null && participation.laboratoryId === scope.laboratoryId)
  );
}

/** Returns a participation of the scope, or refuses one that does not exist or lies outside it. */
export async function requireParticipationInScope(
  db: Firestore,
  transaction: Transaction,
  participationId: string,
  scope: Pick<GovernanceScope, "replicationId" | "laboratoryId">,
): Promise<{ readonly replicationId: string; readonly laboratoryId: string }> {
  const parsed = parseStoredDocument(
    participationDocSchema,
    (await transaction.get(db.doc(COLLECTIONS.participations.docPath(participationId)))).data(),
  );
  if (!parsed.success || !participationInScope(parsed.data, scope)) {
    throw new AppError("invalid-argument", "A participation named is not one of this replication or laboratory.");
  }
  return parsed.data;
}

/** Refuses a deviation that does not exist or belongs to a participation outside the scope. */
export async function requireDeviationsInScope(
  db: Firestore,
  transaction: Transaction,
  deviations: readonly DeviationRef[],
  scope: Pick<GovernanceScope, "replicationId" | "laboratoryId">,
): Promise<void> {
  for (const { participationId, deviationId } of deviations) {
    const parsed = parseStoredDocument(
      participationDeviationDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.participationDeviations.docPath(participationId, deviationId)))).data(),
    );
    if (!parsed.success || !participationInScope(parsed.data, scope)) {
      throw new AppError("invalid-argument", "A deviation named is not one of this replication or laboratory.");
    }
  }
}

export interface StoredManuscript {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: ManuscriptDoc;
}

/** Reads a manuscript in a transaction, or refuses with the message that it does not exist. */
export async function readManuscript(
  db: Firestore,
  transaction: Transaction,
  manuscriptId: string,
): Promise<StoredManuscript> {
  const reference = db.doc(COLLECTIONS.manuscripts.docPath(manuscriptId));
  const parsed = parseStoredDocument(manuscriptDocSchema, (await transaction.get(reference)).data());
  if (!parsed.success) throw new AppError("not-found", MANUSCRIPT_NOT_FOUND_MESSAGE);
  return { id: manuscriptId, reference, data: parsed.data };
}

/** Refuses a caller who may not manage an output: the leads of its replication, or the programme for one without. */
export function requireOutputManager(
  context: AuthenticatedContext,
  access: ResolvedAccess,
  replicationId: string | null | undefined,
): void {
  requireCapability(
    context,
    access,
    "replications.manage",
    replicationId === null || replicationId === undefined ? "programme" : { replicationId },
  );
}

/** Refuses a change to an archived record. */
export function requireNotArchived(data: { readonly archivedAt: unknown }, what: string): void {
  if (data.archivedAt !== null) {
    throw new AppError("failed-precondition", `This ${what} is archived. Restore it before changing it.`);
  }
}

/** A date of a calendar, as the start of that day in UTC, for a field that holds an instant. */
export function startOfDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
