// Role assignments as documents (docs/DATA_MODEL.md, section 3): one per account, role and
// scope, whose `status` says whether it is in force and whose `history` keeps its earlier
// periods. Every function that grants, proposes or revokes a role builds the document here.
import {
  COLLECTIONS,
  LIMITS,
  parseStoredDocument,
  type RoleAssignmentDoc,
  type RoleScope,
  roleAssignmentDocSchema,
  roleAssignmentId,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { createdFields, touchedFields, type WriteStamp } from "../framework/documents";

/** A role that a function wants an account to hold, in force or awaiting approval. */
export interface WantedAssignment extends RoleScope {
  readonly uid: string;
  readonly status: "active" | "pendingApproval";
  readonly reason?: string | undefined;
  readonly expiresAt?: Date | null | undefined;
}

export interface StoredAssignment {
  readonly id: string;
  readonly reference: DocumentReference;
  /** The document as stored, or null when the account has never held the role for the scope. */
  readonly data: RoleAssignmentDoc | null;
}

export const assignmentIdOf = (uid: string, scope: RoleScope): string =>
  roleAssignmentId(uid, scope.role, scope.scopeType, scope.scopeId);

/** Reads role assignments by identifier, inside the transaction. A stored document that does not fit its schema is a fault. */
export async function readAssignments(
  db: Firestore,
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, StoredAssignment>> {
  const unique = [...new Set(ids)];
  const references = unique.map((id) => db.doc(COLLECTIONS.roleAssignments.docPath(id)));
  const snapshots = references.length === 0 ? [] : await transaction.getAll(...references);
  const stored = new Map<string, StoredAssignment>();
  snapshots.forEach((snapshot, index) => {
    const id = unique[index] ?? snapshot.id;
    let data: RoleAssignmentDoc | null = null;
    if (snapshot.exists) {
      const parsed = parseStoredDocument(roleAssignmentDocSchema, snapshot.data());
      if (!parsed.success) throw parsed.error;
      data = parsed.data;
    }
    stored.set(id, { id, reference: snapshot.ref, data });
  });
  return stored;
}

/** Whether an assignment is in force at an instant: active and not past its expiry time. */
export function inForce(assignment: Pick<RoleAssignmentDoc, "status" | "expiresAt"> | null, at: Date): boolean {
  return (
    assignment !== null &&
    assignment.status === "active" &&
    (assignment.expiresAt === null || assignment.expiresAt.toMillis() > at.getTime())
  );
}

function earlierPeriod(stored: RoleAssignmentDoc): RoleAssignmentDoc["history"][number] {
  return {
    status: stored.status,
    grantedBy: stored.grantedBy,
    grantedAt: stored.grantedAt,
    expiresAt: stored.expiresAt,
    revokedBy: stored.revokedBy,
    revokedAt: stored.revokedAt,
    ...(stored.reason === undefined ? {} : { reason: stored.reason }),
  };
}

/**
 * The document that makes an account hold a role as wanted, or null where the stored
 * assignment already says so.
 *
 * | Stored                | Wanted `active`                        | Wanted `pendingApproval`            |
 * |-----------------------|----------------------------------------|-------------------------------------|
 * | Nothing               | A new active assignment                | A new assignment that awaits approval |
 * | Awaiting approval     | Becomes active: this is the approval   | Unchanged                           |
 * | Active and in force   | Unchanged, unless the expiry time differs | Unchanged: never set back to pending |
 * | Revoked or expired    | The earlier period goes to `history`, then as for nothing | The same        |
 */
export function nextAssignment(
  stored: RoleAssignmentDoc | null,
  wanted: WantedAssignment,
  stamp: WriteStamp,
): RoleAssignmentDoc | null {
  const now = Timestamp.fromDate(stamp.at);
  const expiresAt = wanted.expiresAt == null ? null : Timestamp.fromDate(wanted.expiresAt);
  const granting = wanted.status === "active";
  const period = {
    status: wanted.status,
    grantedBy: granting ? stamp.actor : null,
    grantedAt: granting ? now : null,
    expiresAt,
    revokedBy: null,
    revokedAt: null,
  };
  const reason = wanted.reason === undefined ? {} : { reason: wanted.reason };
  if (stored === null) {
    return roleAssignmentDocSchema.parse({
      ...createdFields("roleAssignments", stamp),
      uid: wanted.uid,
      role: wanted.role,
      scopeType: wanted.scopeType,
      scopeId: wanted.scopeId,
      ...period,
      ...reason,
      history: [],
    });
  }
  const live = inForce(stored, stamp.at);
  if (stored.status === "pendingApproval" && !granting) return null;
  if (live && !granting) return null;
  if (live && granting) {
    const sameExpiry = (stored.expiresAt?.toMillis() ?? null) === (expiresAt?.toMillis() ?? null);
    if (wanted.expiresAt === undefined || sameExpiry) return null;
    return roleAssignmentDocSchema.parse({ ...stored, ...touchedFields(stamp), expiresAt });
  }
  const { reason: _earlierReason, ...kept } = stored;
  const ended = stored.status !== "pendingApproval";
  return roleAssignmentDocSchema.parse({
    ...kept,
    ...touchedFields(stamp),
    ...period,
    ...reason,
    history: ended ? [...stored.history, earlierPeriod(stored)].slice(-LIMITS.list) : stored.history,
  });
}

/** The document of an assignment once it is revoked. Null where it is neither active nor pending. */
export function revokedAssignment(
  stored: RoleAssignmentDoc,
  reason: string,
  stamp: WriteStamp,
): RoleAssignmentDoc | null {
  if (stored.status !== "active" && stored.status !== "pendingApproval") return null;
  return roleAssignmentDocSchema.parse({
    ...stored,
    ...touchedFields(stamp),
    status: "revoked",
    revokedBy: stamp.actor,
    revokedAt: Timestamp.fromDate(stamp.at),
    reason,
  });
}
