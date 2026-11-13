// The listing of the periodic access review (docs/SECURITY.md, section 6): every account that
// holds a role, a grant, the membership of a group or a confirmed place on a replication team,
// what it holds, who appointed it, when it last signed in and which grants end soon, and the
// overrides of the capability matrix. These are every source the access resolver
// (shared/src/access-store.ts) reads, so an account whose access comes from any of them is
// listed, and a change to any of them changes the hash. The hash binds an attestation to what
// the reviewer saw. Sign-in times are shown and left out of the hash, because a sign-in during
// the review changes no right.
//
// Only rights in force are read, page by page to the end. A listing longer than one review can
// hold says so with `truncated`, and attestAccessReview refuses it.
import {
  ACCESS_REVIEW_ACCOUNTS_MAX,
  ACCESS_REVIEW_EXPIRING_DAYS,
  type AccessReview,
  COLLECTIONS,
  capabilityField,
  capabilityGrantDocSchema,
  GRANTABLE_CAPABILITIES,
  groupDocSchema,
  parseStoredDocument,
  recordGrantDocSchema,
  roleAssignmentDocSchema,
  roleCapabilitiesDocSchema,
  sha256Hex,
} from "@eegml/shared";
import type { Auth } from "firebase-admin/auth";
import {
  FieldPath,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase-admin/firestore";

type ReviewedAccount = AccessReview["accounts"][number];

const PAGE = 500;
const AUTH_BATCH = 100;

const iso = (value: { toDate(): Date } | null) => (value === null ? null : value.toDate().toISOString());

/** Every document a query matches, read page by page in the order of document identifiers. */
async function readAll(query: Query): Promise<QueryDocumentSnapshot[]> {
  const found: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  for (;;) {
    const ordered = query.orderBy(FieldPath.documentId()).limit(PAGE);
    const page: QuerySnapshot = await (cursor === null ? ordered : ordered.startAfter(cursor)).get();
    found.push(...page.docs);
    if (page.size < PAGE) return found;
    cursor = page.docs[page.docs.length - 1] ?? null;
  }
}

export interface AccessListing {
  readonly accounts: ReviewedAccount[];
  readonly overrides: AccessReview["overrides"];
  readonly truncated: boolean;
  readonly listingSha256: string;
}

export async function accessListing(db: Firestore, auth: Auth, now: Date): Promise<AccessListing> {
  const soon = now.getTime() + ACCESS_REVIEW_EXPIRING_DAYS * 86_400_000;
  const expiring = (value: { toDate(): Date } | null) => value !== null && value.toDate().getTime() <= soon;
  type Draft = Pick<ReviewedAccount, "uid" | "roles" | "grants" | "groups" | "teamReplicationIds">;
  const accounts = new Map<string, Draft>();
  const accountOf = (uid: string) => {
    let account = accounts.get(uid);
    if (account === undefined) {
      account = { uid, roles: [], grants: [], groups: [], teamReplicationIds: [] };
      accounts.set(uid, account);
    }
    return account;
  };

  const [roles, capabilityGrants, recordGrants, groups, overrides, accessDocuments] = await Promise.all([
    readAll(
      db.collection(COLLECTIONS.roleAssignments.collectionPath()).where("status", "in", ["active", "pendingApproval"]),
    ),
    readAll(db.collection(COLLECTIONS.capabilityGrants.collectionPath()).where("revokedAt", "==", null)),
    readAll(db.collection(COLLECTIONS.recordGrants.collectionPath()).where("revokedAt", "==", null)),
    readAll(db.collection(COLLECTIONS.groups.collectionPath())),
    readAll(db.collection(COLLECTIONS.roleCapabilities.collectionPath())),
    // The resolved access documents carry the confirmed team memberships of linked people.
    readAll(db.collection(COLLECTIONS.access.collectionPath())),
  ]);
  for (const document of roles) {
    const role = parseStoredDocument(roleAssignmentDocSchema, document.data());
    if (!role.success || (role.data.status !== "active" && role.data.status !== "pendingApproval")) continue;
    accountOf(role.data.uid).roles.push({
      role: role.data.role,
      scopeType: role.data.scopeType,
      scopeId: role.data.scopeId,
      status: role.data.status,
      grantedBy: role.data.grantedBy,
      expiresAt: iso(role.data.expiresAt),
      expiringSoon: expiring(role.data.expiresAt),
    });
  }
  for (const document of capabilityGrants) {
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
  for (const document of recordGrants) {
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
  for (const document of groups) {
    const group = parseStoredDocument(groupDocSchema, document.data());
    if (!group.success) continue;
    for (const uid of group.data.memberUids) {
      accountOf(uid).groups.push({
        groupId: document.id,
        name: group.data.name,
        role: group.data.roles[uid] ?? "member",
      });
    }
  }
  for (const document of accessDocuments) {
    const team: unknown = document.get("teamReplicationIds");
    const ids = Array.isArray(team) ? team.filter((id): id is string => typeof id === "string") : [];
    if (ids.length > 0) accountOf(document.id).teamReplicationIds.push(...ids);
  }
  const overrideList: AccessReview["overrides"] = overrides
    .flatMap((document) => {
      const parsed = parseStoredDocument(roleCapabilitiesDocSchema, document.data());
      if (!parsed.success) return [];
      return Object.entries(parsed.data.overrides).flatMap(([field, allowed]) => {
        // Named as everywhere else in the console, `people.contact.read`, not by its stored field.
        const capability = GRANTABLE_CAPABILITIES.find((name) => capabilityField(name) === field) ?? field;
        return typeof allowed === "boolean" ? [{ role: parsed.data.role, capability, allowed }] : [];
      });
    })
    .sort((a, b) => `${a.role} ${a.capability}`.localeCompare(`${b.role} ${b.capability}`));

  const allUids = [...accounts.keys()].sort();
  const truncated = allUids.length > ACCESS_REVIEW_ACCOUNTS_MAX;
  const uids = allUids.slice(0, ACCESS_REVIEW_ACCOUNTS_MAX);
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
      roles: [...account.roles]
        .sort((a, b) => `${a.role}${a.scopeId}`.localeCompare(`${b.role}${b.scopeId}`) || order(a, b))
        .slice(0, 200),
      grants: [...account.grants].sort((a, b) => a.name.localeCompare(b.name) || order(a, b)).slice(0, 200),
      groups: [...account.groups].sort((a, b) => a.groupId.localeCompare(b.groupId)).slice(0, 200),
      teamReplicationIds: [...new Set(account.teamReplicationIds)].sort().slice(0, 200),
    };
  });
  const hashed = {
    accounts: listed.map(({ lastSignInAt: _signIn, ...rest }) => rest),
    overrides: overrideList,
    truncated,
  };
  return { accounts: listed, overrides: overrideList, truncated, listingSha256: sha256Hex(JSON.stringify(hashed)) };
}
