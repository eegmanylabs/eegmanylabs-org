// The listing of the periodic access review (docs/SECURITY.md, section 6): every account that
// holds a role or a grant, what it holds, when it last signed in and which grants end soon. The
// hash of the listing binds an attestation to what the reviewer saw. Sign-in times are shown and
// left out of the hash, because a sign-in during the review changes no right.
import {
  ACCESS_REVIEW_EXPIRING_DAYS,
  type AccessReview,
  COLLECTIONS,
  capabilityGrantDocSchema,
  parseStoredDocument,
  recordGrantDocSchema,
  roleAssignmentDocSchema,
  sha256Hex,
} from "@eegml/shared";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

type ReviewedAccount = AccessReview["accounts"][number];

const LIST_MAX = 2_000;
const AUTH_BATCH = 100;

const iso = (value: { toDate(): Date } | null) => (value === null ? null : value.toDate().toISOString());

export interface AccessListing {
  readonly accounts: ReviewedAccount[];
  readonly listingSha256: string;
}

export async function accessListing(db: Firestore, auth: Auth, now: Date): Promise<AccessListing> {
  const soon = now.getTime() + ACCESS_REVIEW_EXPIRING_DAYS * 86_400_000;
  const expiring = (value: { toDate(): Date } | null) => value !== null && value.toDate().getTime() <= soon;
  const accounts = new Map<string, Omit<ReviewedAccount, "name" | "suspended" | "lastSignInAt">>();
  const accountOf = (uid: string) => {
    let account = accounts.get(uid);
    if (account === undefined) {
      account = { uid, roles: [], grants: [] };
      accounts.set(uid, account);
    }
    return account;
  };

  const [roles, capabilityGrants, recordGrants] = await Promise.all([
    db.collection(COLLECTIONS.roleAssignments.collectionPath()).limit(LIST_MAX).get(),
    db.collection(COLLECTIONS.capabilityGrants.collectionPath()).limit(LIST_MAX).get(),
    db.collection(COLLECTIONS.recordGrants.collectionPath()).limit(LIST_MAX).get(),
  ]);
  for (const document of roles.docs) {
    const role = parseStoredDocument(roleAssignmentDocSchema, document.data());
    if (!role.success || (role.data.status !== "active" && role.data.status !== "pendingApproval")) continue;
    accountOf(role.data.uid).roles.push({
      role: role.data.role,
      scopeType: role.data.scopeType,
      scopeId: role.data.scopeId,
      status: role.data.status,
      expiresAt: iso(role.data.expiresAt),
      expiringSoon: expiring(role.data.expiresAt),
    });
  }
  for (const document of capabilityGrants.docs) {
    const grant = parseStoredDocument(capabilityGrantDocSchema, document.data());
    if (!grant.success || grant.data.revokedAt !== null) continue;
    if (grant.data.expiresAt !== null && grant.data.expiresAt.toDate().getTime() <= now.getTime()) continue;
    accountOf(grant.data.uid).grants.push({
      kind: "capability",
      name: grant.data.capability,
      expiresAt: iso(grant.data.expiresAt),
      expiringSoon: expiring(grant.data.expiresAt),
    });
  }
  for (const document of recordGrants.docs) {
    const grant = parseStoredDocument(recordGrantDocSchema, document.data());
    if (!grant.success || grant.data.revokedAt !== null) continue;
    if (grant.data.expiresAt !== null && grant.data.expiresAt.toDate().getTime() <= now.getTime()) continue;
    accountOf(grant.data.uid).grants.push({
      kind: "record",
      name: `${grant.data.level} ${grant.data.entityType} ${grant.data.entityId}`,
      expiresAt: iso(grant.data.expiresAt),
      expiringSoon: expiring(grant.data.expiresAt),
    });
  }

  const uids = [...accounts.keys()].sort();
  const users = uids.length === 0 ? [] : await db.getAll(...uids.map((uid) => db.doc(COLLECTIONS.users.docPath(uid))));
  const personIds = users.map((user) => user.get("personId"));
  const linked = personIds.filter((id): id is string => typeof id === "string" && id !== "");
  const persons =
    linked.length === 0 ? [] : await db.getAll(...linked.map((id) => db.doc(COLLECTIONS.persons.docPath(id))));
  const personName = new Map(persons.map((person) => [person.id, person.get("displayName")] as const));
  const signIns = new Map<string, string | null>();
  for (let start = 0; start < uids.length; start += AUTH_BATCH) {
    const result = await auth.getUsers(uids.slice(start, start + AUTH_BATCH).map((uid) => ({ uid })));
    for (const record of result.users) {
      const last = record.metadata.lastSignInTime;
      signIns.set(record.uid, last === undefined || last === "" ? null : new Date(last).toISOString());
    }
  }

  const listed: ReviewedAccount[] = uids.map((uid, index) => {
    const name: unknown = personName.get(personIds[index]);
    const account = accountOf(uid);
    const order = (a: { expiresAt: string | null }, b: { expiresAt: string | null }) =>
      (a.expiresAt ?? "~").localeCompare(b.expiresAt ?? "~");
    return {
      uid,
      name: typeof name === "string" ? name : null,
      suspended: users[index]?.get("status") === "suspended",
      lastSignInAt: signIns.get(uid) ?? null,
      roles: [...account.roles].sort(
        (a, b) => `${a.role}${a.scopeId}`.localeCompare(`${b.role}${b.scopeId}`) || order(a, b),
      ),
      grants: [...account.grants].sort((a, b) => a.name.localeCompare(b.name) || order(a, b)),
    };
  });
  const hashed = listed.map(({ lastSignInAt: _signIn, ...rest }) => rest);
  return { accounts: listed, listingSha256: sha256Hex(JSON.stringify(hashed)) };
}
