// The rule that the programme never loses its last administrator.
import {
  COLLECTIONS,
  isProgrammeRole,
  parseStoredDocument,
  type RoleAssignmentDoc,
  roleAssignmentDocSchema,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { inForce } from "./assignments";

/**
 * The accounts, other than one, that are programme administrators in force at an instant and
 * are not suspended. Read inside the transaction, so that two administrators who remove each
 * other at the same moment cannot both succeed.
 */
export async function otherAdministrators(
  db: Firestore,
  transaction: Transaction,
  exceptUid: string,
  at: Date,
): Promise<string[]> {
  const found = await transaction.get(
    db.collection(COLLECTIONS.roleAssignments.collectionPath()).where("role", "==", "programme_admin"),
  );
  const uids = found.docs.flatMap((document) => {
    const parsed = parseStoredDocument(roleAssignmentDocSchema, document.data());
    return parsed.success &&
      parsed.data.scopeType === "programme" &&
      parsed.data.uid !== exceptUid &&
      inForce(parsed.data, at)
      ? [parsed.data.uid]
      : [];
  });
  const distinct = [...new Set(uids)];
  if (distinct.length === 0) return [];
  const profiles = await transaction.getAll(...distinct.map((uid) => db.doc(COLLECTIONS.users.docPath(uid))));
  return distinct.filter((_uid, index) => profiles[index]?.get("status") === "active");
}

export const LAST_ADMINISTRATOR_MESSAGE =
  "This account is the last active programme administrator. Make another account a programme administrator first.";

/** Whether any of an account's role assignments makes it programme staff at an instant. */
export function holdsProgrammeRole(
  assignments: readonly Pick<RoleAssignmentDoc, "role" | "status" | "expiresAt">[],
  at: Date,
): boolean {
  return assignments.some((assignment) => isProgrammeRole(assignment.role) && inForce(assignment, at));
}

export const PROGRAMME_STAFF_ACCOUNT_MESSAGE =
  "This account belongs to a programme administrator or a member of the core team. Only a programme administrator can change it.";
