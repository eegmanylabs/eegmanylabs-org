// The link between an account and a person (decision D-005 and docs/DATA_MODEL.md, section 14):
// `persons.userId` and `claimedAt`, `users.personId`, the role assignments that the records
// about the person imply, and the access document, all in one transaction. A match in
// `claimProfile` and an approval in `reviewAccountClaim` both link through this file, and
// `unlinkAccountClaim` reverses what it wrote.
import {
  type AccessInputs,
  COLLECTIONS,
  distinctRoles,
  type ImpliedRole,
  type ResolvedAccess,
  rolesOfMemberEntry,
  rolesOfMembership,
  rolesOfPerson,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { type AccessDraft, commitAccess, draftAccess, withAssignment } from "../access/maintain";
import { writeAudit } from "../framework/audit";
import { touchedFields, type WriteStamp } from "../framework/documents";
import { assignmentIdOf, nextAssignment, readAssignments, type StoredAssignment } from "../roles/assignments";

type Stored = Readonly<Record<string, unknown>>;

/** Everything a link is decided from, read inside the transaction before its first write. */
export interface LinkReads {
  readonly uid: string;
  readonly personId: string;
  readonly personReference: DocumentReference;
  /** The directory document of the person, or null when there is none. */
  readonly person: Stored | null;
  readonly userReference: DocumentReference;
  readonly user: Stored | null;
  readonly implied: readonly ImpliedRole[];
  readonly assignments: ReadonlyMap<string, StoredAssignment>;
  readonly access: AccessDraft | null;
}

/** The records about a person that imply roles: the member entries and the memberships across parents. */
export async function impliedRolesOfPerson(
  db: Firestore,
  transaction: Transaction,
  personId: string,
  person: Stored,
): Promise<ImpliedRole[]> {
  const [entries, memberships] = await Promise.all([
    transaction.get(db.collectionGroup(COLLECTIONS.laboratoryMembers.collectionId).where("personId", "==", personId)),
    transaction.get(
      db
        .collectionGroup(COLLECTIONS.replicationMemberships.collectionId)
        .where("personId", "==", personId)
        .where("reviewStatus", "in", ["confirmed", "needsReview"]),
    ),
  ]);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return distinctRoles([
    ...entries.docs.flatMap((entry) => rolesOfMemberEntry(text(entry.get("laboratoryId")), entry.data())),
    ...memberships.docs.flatMap((membership) =>
      rolesOfMembership(text(membership.get("replicationId")), membership.data()),
    ),
    ...rolesOfPerson(person),
  ]).filter((role) => role.scopeId !== "");
}

/** Reads what a link between an account and a person needs. */
export async function readLink(
  db: Firestore,
  transaction: Transaction,
  uid: string,
  personId: string,
  at: Date,
): Promise<LinkReads> {
  const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
  const userReference = db.doc(COLLECTIONS.users.docPath(uid));
  const [personSnapshot, userSnapshot] = await transaction.getAll(personReference, userReference);
  const person = personSnapshot?.data() ?? null;
  const implied = person === null ? [] : await impliedRolesOfPerson(db, transaction, personId, person);
  const assignments = await readAssignments(
    db,
    transaction,
    implied.map((role) => assignmentIdOf(uid, role)),
  );
  return {
    uid,
    personId,
    personReference,
    person,
    userReference,
    user: userSnapshot?.data() ?? null,
    implied,
    assignments,
    access: await draftAccess(db, transaction, uid, at),
  };
}

/**
 * Why a person cannot be linked to an account, or null where it can.
 *
 * | Obstacle      | The person                                         |
 * |---------------|----------------------------------------------------|
 * | `missing`     | Does not exist                                     |
 * | `archived`    | Is archived                                        |
 * | `claimed`     | Is linked to another account                       |
 */
export function linkObstacle(reads: Pick<LinkReads, "person" | "uid">): "missing" | "archived" | "claimed" | null {
  if (reads.person === null) return "missing";
  if (reads.person.archivedAt != null) return "archived";
  const holder = reads.person.userId;
  return typeof holder === "string" && holder !== "" && holder !== reads.uid ? "claimed" : null;
}

export interface GrantedRoles {
  /** The role assignments that were created or put back in force. */
  readonly createdAssignmentIds: string[];
  /** The roles among them that await approval by an administrator. */
  readonly pendingRoles: ImpliedRole[];
  /** The inputs of the access document with those assignments in place. */
  readonly inputs: AccessInputs;
}

/**
 * Writes the role assignments that the records about a person imply for the person's account,
 * each with an audit entry of its own. An assignment that says so already is left alone.
 * `stamp` names the audit entry of the change that implied the roles.
 */
export function grantImpliedRoles(
  db: Firestore,
  transaction: Transaction,
  uid: string,
  implied: readonly ImpliedRole[],
  assignments: ReadonlyMap<string, StoredAssignment>,
  startingInputs: AccessInputs,
  stamp: WriteStamp,
): GrantedRoles {
  const createdAssignmentIds: string[] = [];
  const pendingRoles: ImpliedRole[] = [];
  let inputs = startingInputs;
  for (const role of implied) {
    const id = assignmentIdOf(uid, role);
    const stored = assignments.get(id);
    const next = nextAssignment(stored?.data ?? null, { ...role, uid }, stamp);
    if (next === null || stored === undefined) continue;
    transaction.set(stored.reference, next);
    createdAssignmentIds.push(id);
    if (next.status === "pendingApproval") pendingRoles.push(role);
    inputs = withAssignment(inputs, next);
    writeAudit(
      transaction,
      {
        action: next.status === "active" ? "role.granted" : "role.proposed",
        actor: { kind: "user", uid: stamp.actor },
        entityType: "user",
        entityId: uid,
        changes: [
          { field: "role", after: role.role },
          { field: "scopeType", after: role.scopeType },
          { field: "scopeId", after: role.scopeId },
          { field: "status", after: next.status },
        ],
        at: stamp.at,
        context: { causationId: stamp.writeContext.auditEventId },
      },
      db,
    );
  }
  return { createdAssignmentIds, pendingRoles, inputs };
}

export interface LinkResult {
  /** The role assignments that the link created or put back in force. An unlink revokes exactly these. */
  readonly createdAssignmentIds: string[];
  /** The roles among them that await approval by an administrator. */
  readonly pendingRoles: ImpliedRole[];
  readonly access: ResolvedAccess;
}

/**
 * Writes the link. `stamp` names the audit entry of the claim, and each role assignment that
 * the link creates gets an audit entry of its own.
 */
export function writeLink(db: Firestore, transaction: Transaction, reads: LinkReads, stamp: WriteStamp): LinkResult {
  if (reads.access === null || reads.person === null) throw new Error("A link needs a profile and a person.");
  const { uid, personId } = reads;
  transaction.update(reads.personReference, {
    userId: uid,
    claimedAt: Timestamp.fromDate(stamp.at),
    ...touchedFields(stamp),
  });
  transaction.update(reads.userReference, { personId, ...touchedFields(stamp) });

  const granted = grantImpliedRoles(db, transaction, uid, reads.implied, reads.assignments, reads.access.inputs, stamp);
  const { createdAssignmentIds, pendingRoles, inputs } = granted;

  const replicationIds = Array.isArray(reads.person.replicationIds)
    ? reads.person.replicationIds.filter((id): id is string => typeof id === "string")
    : [];
  reads.access.inputs = { ...inputs, personId, confirmedReplicationIds: replicationIds };
  const { resolved } = commitAccess(db, transaction, reads.access, stamp);
  return { createdAssignmentIds, pendingRoles, access: resolved };
}
