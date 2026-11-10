import {
  COLLECTIONS,
  can,
  fold,
  type ListedUser,
  type ListUsersOutput,
  listUsersContract,
  parseStoredDocument,
  roleAssignmentDocSchema,
  type UserDoc,
  userDocSchema,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { AppError, defineCallable, NOT_ALLOWED_MESSAGE, readAccessDocument, requireSecondFactor } from "../framework";

/** The most accounts the list reads. The programme has a few hundred members. */
export const USERS_READ_MAX = 5_000;

/** Firestore takes at most 30 values in one `in` clause. */
const IN_CLAUSE_MAX = 30;

const chunks = <T>(values: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(values.length / size) }, (_value, index) =>
    values.slice(index * size, index * size + size),
  );

interface Candidate {
  readonly uid: string;
  readonly user: UserDoc;
  readonly personName: string | null;
}

/** The names of the linked persons, from the directory. */
async function personNames(db: Firestore, personIds: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const part of chunks([...new Set(personIds)], 100)) {
    const snapshots = await db.getAll(...part.map((id) => db.doc(COLLECTIONS.persons.docPath(id))));
    for (const snapshot of snapshots) {
      const name: unknown = snapshot.get("displayName");
      if (snapshot.exists && typeof name === "string" && name !== "") names.set(snapshot.id, name);
    }
  }
  return names;
}

/** The active and pending role assignments of some accounts. */
async function rolesOf(db: Firestore, uids: readonly string[]): Promise<Map<string, ListedUser["roles"]>> {
  const roles = new Map<string, ListedUser["roles"]>(uids.map((uid) => [uid, []]));
  for (const part of chunks(uids, IN_CLAUSE_MAX)) {
    const found = await db.collection(COLLECTIONS.roleAssignments.collectionPath()).where("uid", "in", part).get();
    for (const document of found.docs) {
      const parsed = parseStoredDocument(roleAssignmentDocSchema, document.data());
      if (!parsed.success) continue;
      const assignment = parsed.data;
      if (assignment.status !== "active" && assignment.status !== "pendingApproval") continue;
      roles.get(assignment.uid)?.push({
        assignmentId: document.id,
        role: assignment.role,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        status: assignment.status,
        expiresAt: assignment.expiresAt?.toDate().toISOString() ?? null,
      });
    }
  }
  for (const list of roles.values()) list.sort((a, b) => (a.assignmentId < b.assignmentId ? -1 : 1));
  return roles;
}

/**
 * Lists accounts for the administration console. Capability: `users.suspend` or
 * `roles.manage`, for the programme, with the second factor wherever the caller's access
 * document requires one.
 *
 * No security rule lets anyone read the profile of another account, so this function is the
 * list of accounts. It gives the verified address, and searches it, only to a caller who holds
 * `people.contact.read` for the programme, so that the search cannot be used to find out whether
 * an address has an account. It changes nothing.
 */
export const listUsers = defineCallable(listUsersContract, {
  handler: async (input, context): Promise<ListUsersOutput> => {
    const { db } = context;
    const access = await readAccessDocument(db, context.uid);
    requireSecondFactor(context, access);
    if (!can(access, "users.suspend", "programme") && !can(access, "roles.manage", "programme")) {
      throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
    }
    const addressesShown = can(access, "people.contact.read", "programme");

    const stored = await db.collection(COLLECTIONS.users.collectionPath()).limit(USERS_READ_MAX).get();
    const wanted = input.uids === undefined ? null : new Set(input.uids);
    const users = stored.docs.flatMap((document) => {
      if (wanted !== null && !wanted.has(document.id)) return [];
      const parsed = parseStoredDocument(userDocSchema, document.data());
      if (!parsed.success) {
        context.logger.warn("an account profile does not fit its schema", { uid: document.id });
        return [];
      }
      return input.status === undefined || parsed.data.status === input.status
        ? [{ uid: document.id, user: parsed.data }]
        : [];
    });
    const names = await personNames(
      db,
      users.flatMap(({ user }) => (user.personId === null ? [] : [user.personId])),
    );
    const candidates: Candidate[] = users.map(({ uid, user }) => ({
      uid,
      user,
      personName: user.personId === null ? null : (names.get(user.personId) ?? null),
    }));

    const search = fold(input.search);
    const matching =
      search === ""
        ? candidates
        : candidates.filter((candidate) =>
            [
              candidate.personName,
              candidate.user.displayName,
              addressesShown ? candidate.user.emailLower : null,
            ].some((text) => text !== null && fold(text).includes(search)),
          );
    const sortKey = (candidate: Candidate) =>
      fold(candidate.personName ?? candidate.user.displayName ?? (addressesShown ? candidate.user.emailLower : "~"));
    matching.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

    const page = matching.slice(input.offset, input.offset + input.limit);
    const roles = await rolesOf(
      db,
      page.map((candidate) => candidate.uid),
    );
    return {
      users: page.map(({ uid, user, personName }) => ({
        uid,
        displayName: user.displayName,
        emailLower: addressesShown ? user.emailLower : null,
        status: user.status,
        personId: user.personId,
        personName,
        lastSeenAt: user.lastSeenAt.toDate().toISOString(),
        roles: roles.get(uid) ?? [],
      })),
      total: matching.length,
      addressesShown,
    };
  },
});
