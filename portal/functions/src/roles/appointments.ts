// Who appointed whom a programme administrator, for the two-person rules of erasure and of the
// sensitive grants (docs/SECURITY.md, section 6). A second administrator only counts as a second
// pair of eyes when the first did not make them one, directly or through an administrator they
// made, within the cool-off period. Without this, one administrator could appoint a second
// account of their own and approve their own request with it at once.
import {
  COLLECTIONS,
  PROGRAMME_KEY,
  parseStoredDocument,
  roleAssignmentDocSchema,
  roleAssignmentId,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";

/** Days for which an appointment ties the appointee to the administrator who made it. */
export const APPOINTMENT_COOL_OFF_DAYS = 14;

/** The longest chain of appointments followed. Longer chains are treated as tied. */
const CHAIN_MAX = 8;

export const APPOINTED_BY_REQUESTER_MESSAGE = `This needs two programme administrators of whom neither appointed the other, directly or through another administrator, in the last ${APPOINTMENT_COOL_OFF_DAYS} days.`;

/**
 * The accounts that appointed `uid` a programme administrator, nearest first, following each
 * appointment made within the cool-off period. The chain ends at an appointment older than the
 * period, at one made by trusted code rather than an account, and at an account that is no
 * administrator. A chain longer than `CHAIN_MAX`, or one that cannot be read, is reported as
 * `exhausted`, which `tiedByAppointment` treats as tied.
 */
export async function appointersOf(
  db: Firestore,
  transaction: Transaction,
  uid: string,
  at: Date,
): Promise<{ readonly uids: readonly string[]; readonly exhausted: boolean }> {
  const since = at.getTime() - APPOINTMENT_COOL_OFF_DAYS * 86_400_000;
  const uids: string[] = [];
  let current = uid;
  for (let depth = 0; depth < CHAIN_MAX; depth += 1) {
    const snapshot = await transaction.get(
      db.doc(
        COLLECTIONS.roleAssignments.docPath(roleAssignmentId(current, "programme_admin", "programme", PROGRAMME_KEY)),
      ),
    );
    if (!snapshot.exists) return { uids, exhausted: false };
    const parsed = parseStoredDocument(roleAssignmentDocSchema, snapshot.data());
    if (!parsed.success) return { uids, exhausted: true };
    const { grantedBy, grantedAt } = parsed.data;
    if (grantedBy === null || grantedAt === null || grantedBy.startsWith("system:")) return { uids, exhausted: false };
    if (grantedAt.toMillis() < since) return { uids, exhausted: false };
    if (uids.includes(grantedBy) || grantedBy === uid) return { uids, exhausted: false };
    uids.push(grantedBy);
    current = grantedBy;
  }
  return { uids, exhausted: true };
}

/**
 * Whether two accounts are tied by a recent appointment in either direction: one appointed the
 * other, directly or through administrators it appointed, within the cool-off period.
 */
export async function tiedByAppointment(
  db: Firestore,
  transaction: Transaction,
  first: string,
  second: string,
  at: Date,
): Promise<boolean> {
  const [ofSecond, ofFirst] = [
    await appointersOf(db, transaction, second, at),
    await appointersOf(db, transaction, first, at),
  ];
  return ofSecond.exhausted || ofFirst.exhausted || ofSecond.uids.includes(first) || ofFirst.uids.includes(second);
}
