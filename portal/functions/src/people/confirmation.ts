// What the two functions that confirm an entry about a person share: who may confirm, and the
// roles that a confirmed entry implies for the person's account.
import { type Capability, COLLECTIONS, type ImpliedRole, type ResolvedAccess } from "@eegml/shared";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { type AccessDraft, commitAccess, draftAccess } from "../access/maintain";
import { grantImpliedRoles } from "../claims/link";
import { requireCapability } from "../framework/authorise";
import type { AuthenticatedContext } from "../framework/context";
import type { WriteStamp } from "../framework/documents";
import { holdersOf, notifyAll, writeNotification } from "../notifications/notify";
import { assignmentIdOf, readAssignments, type StoredAssignment } from "../roles/assignments";

/**
 * Decides whether the caller may confirm an entry about a person, and says in whose name: the
 * person concerned confirms for themselves, and a holder of the capability for the programme
 * as a whole confirms as an administrator, with the second factor where it is required.
 */
export function confirmingAs(
  context: AuthenticatedContext,
  access: ResolvedAccess,
  person: DocumentSnapshot,
  capability: Capability,
  options: { readonly personMayConfirm: boolean },
): "person" | "administrator" {
  if (options.personMayConfirm && access.member && person.exists && person.get("userId") === context.uid)
    return "person";
  requireCapability(context, access, capability, "programme");
  return "administrator";
}

/** The account of the person and what its implied roles are decided from, read inside the transaction. */
export interface AccountOfPerson {
  readonly uid: string;
  readonly implied: readonly ImpliedRole[];
  readonly assignments: ReadonlyMap<string, StoredAssignment>;
  readonly draft: AccessDraft;
  /** Whoever approves roles, read only where a role will await approval. */
  readonly roleManagers: readonly string[];
}

/** Reads the account that a person is linked to, if any, with the stored assignments of the roles an entry implies. */
export async function readAccountOfPerson(
  db: Firestore,
  transaction: Transaction,
  person: DocumentSnapshot,
  implied: readonly ImpliedRole[],
  at: Date,
): Promise<AccountOfPerson | null> {
  const holder: unknown = person.get("userId");
  if (typeof holder !== "string" || holder === "") return null;
  const draft = await draftAccess(db, transaction, holder, at);
  if (draft === null) return null;
  const assignments = await readAssignments(
    db,
    transaction,
    implied.map((role) => assignmentIdOf(holder, role)),
  );
  const roleManagers = implied.some((role) => role.status === "pendingApproval")
    ? await holdersOf(db, transaction, "roles.manage")
    : [];
  return { uid: holder, implied, assignments, draft, roleManagers };
}

/**
 * Writes what a confirmation means for the person's account: the implied role assignments,
 * the access document, a notification for the person where somebody else confirmed, and one
 * for whoever approves roles where a role now awaits approval.
 */
export function writeAccountOfPerson(
  db: Firestore,
  transaction: Transaction,
  account: AccountOfPerson,
  change: {
    readonly confirmedReplicationIds?: readonly string[];
    readonly notification: {
      readonly entityType: "laboratory" | "replication";
      readonly entityId: string;
      readonly kind: string;
    };
  },
  stamp: WriteStamp,
): void {
  const granted = grantImpliedRoles(
    db,
    transaction,
    account.uid,
    account.implied,
    account.assignments,
    account.draft.inputs,
    stamp,
  );
  account.draft.inputs =
    change.confirmedReplicationIds === undefined
      ? granted.inputs
      : { ...granted.inputs, confirmedReplicationIds: change.confirmedReplicationIds };
  commitAccess(db, transaction, account.draft, stamp);
  const eventId = stamp.writeContext.auditEventId;
  if (eventId === null) return;
  if (account.uid !== stamp.actor) {
    writeNotification(
      db,
      transaction,
      {
        uid: account.uid,
        type: "statusChange",
        entityType: change.notification.entityType,
        entityId: change.notification.entityId,
        eventId,
        payload: { kind: change.notification.kind },
      },
      stamp,
    );
  }
  if (granted.pendingRoles.length > 0) {
    notifyAll(
      db,
      transaction,
      account.roleManagers.filter((manager) => manager !== stamp.actor && manager !== account.uid),
      {
        type: "roleDecision",
        entityType: "user",
        entityId: account.uid,
        eventId,
        payload: { kind: "rolesAwaitApproval", count: granted.pendingRoles.length },
      },
      stamp,
    );
  }
}

/** The identifiers that a stored array field holds. */
export function storedIds(snapshot: DocumentSnapshot, field: string): string[] {
  const value: unknown = snapshot.get(field);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export const personPath = (personId: string): string => COLLECTIONS.persons.docPath(personId);
