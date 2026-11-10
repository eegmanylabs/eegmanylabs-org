// The roles that imported data implies for a person (decision D-005).
//
// Several source spreadsheets can be read by anyone who has the link, so an address found in
// them is evidence enough for ordinary membership and no more. A role with management powers
// that the data implies therefore starts as `pendingApproval`, and an administrator confirms it.
// The claim functions, the functions that confirm an entry and `seed:demo` all decide with the
// functions of this file.
import type { Role, RoleScopeType } from "./capabilities";
import { memberEntryCounts } from "./person-units";
import { PROGRAMME_KEY } from "./seed/lookups";

/** A role for a scope. */
export interface RoleScope {
  readonly role: Role;
  readonly scopeType: RoleScopeType;
  readonly scopeId: string;
}

/** A role that the records about a person imply for the person's account. */
export interface ImpliedRole extends RoleScope {
  readonly status: "active" | "pendingApproval";
}

type Stored = Readonly<Record<string, unknown>>;

const COORDINATING_ENTRY_ROLES: readonly unknown[] = ["coordinator", "pi"];
const LEADING_MEMBERSHIP_ROLES: readonly unknown[] = ["lead", "coLead"];

/**
 * The roles that one member entry of a laboratory implies: membership of the laboratory at
 * once, and its coordination, for a coordinator or a principal investigator, once approved.
 * An entry that is not confirmed, or that is archived, implies nothing.
 */
export function rolesOfMemberEntry(laboratoryId: string, entry: Stored | null): ImpliedRole[] {
  if (!memberEntryCounts(entry)) return [];
  const scope = { scopeType: "laboratory", scopeId: laboratoryId } as const;
  return [
    { role: "lab_member", ...scope, status: "active" },
    ...(COORDINATING_ENTRY_ROLES.includes(entry?.role)
      ? [{ role: "lab_coordinator", ...scope, status: "pendingApproval" } as const]
      : []),
  ];
}

/**
 * The role that one membership of a replication implies: its lead, once approved, for a
 * current membership in the role `lead` or `coLead` that is not archived. Whether the
 * membership itself is confirmed does not matter here, because the role awaits approval anyway.
 */
export function rolesOfMembership(replicationId: string, membership: Stored | null): ImpliedRole[] {
  if (membership === null || membership.archivedAt != null || membership.isCurrent !== true) return [];
  if (!LEADING_MEMBERSHIP_ROLES.includes(membership.role)) return [];
  return [{ role: "replication_lead", scopeType: "replication", scopeId: replicationId, status: "pendingApproval" }];
}

/** The role that the directory document of a person implies: the core team, once approved. */
export function rolesOfPerson(person: Stored): ImpliedRole[] {
  return person.isCoreTeam === true
    ? [{ role: "core_team", scopeType: "programme", scopeId: PROGRAMME_KEY, status: "pendingApproval" }]
    : [];
}

/** The implied roles without repeats. Where a role is implied twice for a scope, the active one holds. */
export function distinctRoles(roles: readonly ImpliedRole[]): ImpliedRole[] {
  const byKey = new Map<string, ImpliedRole>();
  for (const role of roles) {
    const key = `${role.role}\n${role.scopeType}\n${role.scopeId}`;
    if (byKey.get(key)?.status !== "active") byKey.set(key, role);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, role]) => role);
}
