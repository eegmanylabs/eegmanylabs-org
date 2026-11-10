// What an account may do: how `access/{uid}` is resolved, and how it is read.
//
// `resolveAccess` computes the access document of an account from its role assignments, the
// capability matrix and its overrides, named grants, record grants, groups, the person it is
// linked to and whether it is suspended. It is pure, and the function that maintains
// `access/{uid}` writes its result. `can` reads that document for the interface, which uses it
// to decide what to show, and for callable functions, which use it to authorise. Neither grants
// anything by itself: security rules read the same document on every request.
import {
  CAPABILITIES,
  CAPABILITY_DEFINITIONS,
  type Capability,
  type CapabilityOverrides,
  capabilityField,
  effectiveRoleCapabilities,
  type GrantableCapability,
  isProgrammeRole,
  type ProgrammeRole,
  type Role,
  type RoleScopeType,
  SCOPE_TYPES_OF_ROLE,
} from "./capabilities";
import {
  entityRefId,
  groupScopeKey,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  PROGRAMME_SCOPE_KEY,
  replicationScopeKey,
  roleScopeKey,
  userScopeKey,
} from "./ids";
import type { documentBaseSchema } from "./schemas/base";
import type {
  AccessDoc,
  CapabilityGrantDoc,
  PendingRole,
  RecordGrantDoc,
  RoleAssignmentDoc,
  RoleCapabilitiesDoc,
  UserDoc,
} from "./schemas/identity";
import type { FirestoreTimestamp } from "./timestamp";
import type { z } from "./zod";

/** `access/{uid}` as the data model defines it, with `secondFactorRequired`. */
export type AccessDocument = AccessDoc;

type StandardField = keyof z.output<typeof documentBaseSchema>;

/** The part of the access document that `resolveAccess` decides. The writer adds the standard fields. */
export type ResolvedAccess = Omit<AccessDocument, StandardField>;

/** What the rules and the functions need to know about a caller's session. */
export interface SessionFacts {
  /** When the caller signed in, in seconds since the epoch, as the sign-in token states it. */
  readonly authTimeSeconds: number | null;
}

export type AccountStanding = "active" | "suspended" | "session-ended";

/**
 * Whether an account may act, from its access document. This is the same decision that
 * `isActive()` makes in portal/firestore.rules, so functions and rules refuse the same callers.
 * An account that has no access document yet is active: it has been granted nothing.
 */
export function accountStanding(
  access: Pick<AccessDocument, "suspended" | "sessionsValidAfter"> | null,
  session: SessionFacts,
): AccountStanding {
  if (access === null) return "active";
  if (access.suspended) return "suspended";
  if (access.sessionsValidAfter !== null) {
    const signedInAt = session.authTimeSeconds === null ? null : session.authTimeSeconds * 1000;
    if (signedInAt === null || signedInAt < access.sessionsValidAfter.toMillis()) return "session-ended";
  }
  return "active";
}

/** Everything the access document of one account is resolved from. */
export interface AccessInputs {
  readonly uid: string;
  /** The instant of the resolution. An assignment or a grant that has expired by then confers nothing. */
  readonly now: Date;
  /** `status` and `mfaEnrolled` of `users/{uid}`. */
  readonly user: Pick<UserDoc, "status" | "mfaEnrolled">;
  /** The person that an approved claim links the account to, or null. */
  readonly personId: string | null;
  /** The instant before which sessions are refused. It is carried over unchanged. */
  readonly sessionsValidAfter: FirestoreTimestamp | null;
  /** The role assignments of the account, in any status. */
  readonly roleAssignments: readonly Pick<
    RoleAssignmentDoc,
    "uid" | "role" | "scopeType" | "scopeId" | "status" | "expiresAt"
  >[];
  /** The named capability grants of the account. */
  readonly capabilityGrants: readonly Pick<CapabilityGrantDoc, "uid" | "capability" | "expiresAt" | "revokedAt">[];
  /** The stored overrides of the default capability matrix, for any roles. */
  readonly roleCapabilities: readonly Pick<RoleCapabilitiesDoc, "role" | "overrides">[];
  /** The records shared with the account. */
  readonly recordGrants: readonly Pick<
    RecordGrantDoc,
    "uid" | "entityType" | "entityId" | "level" | "expiresAt" | "revokedAt"
  >[];
  /** The keys of the groups that list the account among their members. */
  readonly groupKeys: readonly string[];
  /** The replications in which the linked person has a current, confirmed membership. */
  readonly confirmedReplicationIds: readonly string[];
}

const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function unexpired(expiresAt: FirestoreTimestamp | null, now: Date): boolean {
  return expiresAt === null || expiresAt.toMillis() > now.getTime();
}

function assignmentScopeKey(scopeType: RoleScopeType, scopeId: string): string {
  switch (scopeType) {
    case "programme":
      return PROGRAMME_SCOPE_KEY;
    case "replication":
      return replicationScopeKey(scopeId);
    case "laboratory":
      return laboratoryScopeKey(scopeId);
    case "group":
      return groupScopeKey(scopeId);
  }
}

function comparePendingRoles(a: PendingRole, b: PendingRole): number {
  const left = `${a.role}\n${a.scopeType}\n${a.scopeId}`;
  const right = `${b.role}\n${b.scopeType}\n${b.scopeId}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Resolves the access document of one account.
 *
 * | Input                                   | Confers                                                        |
 * |-----------------------------------------|----------------------------------------------------------------|
 * | An assignment with the status `active` that has not expired | Its role, for its scope                  |
 * | A pending, revoked or expired assignment | Nothing. A pending one is listed in `pendingRoles`            |
 * | An assignment for another account, or of a role and scope type that do not go together | Nothing |
 * | A named grant that is neither revoked nor expired | Its capability, for the programme as a whole          |
 * | A record grant that is neither revoked nor expired | The record, in `sharedRecordKeys`, and in `editableRecordKeys` at the level `edit` |
 * | A suspended account                     | Nothing at all: no membership, no scope and no capability      |
 *
 * An account that holds a programme role or a named grant must enrol a second factor. Until
 * `mfaEnrolled` is true, `secondFactorRequired` says so and the powers of the programme roles
 * and of the grants are withheld: their capabilities, the `programme` scope key and their role
 * keys. The roles stay listed in `programmeRoles`, so that the interface can explain what is
 * missing. Arrays are sorted and free of duplicates, so two resolutions of the same inputs are
 * equal and a writer can skip a write that would change nothing.
 */
export function resolveAccess(inputs: AccessInputs): ResolvedAccess {
  const { uid, now } = inputs;
  if (inputs.user.status === "suspended") {
    return {
      member: false,
      personId: inputs.personId,
      programmeRoles: [],
      leadReplicationIds: [],
      teamReplicationIds: [],
      coordinatorLaboratoryIds: [],
      memberLaboratoryIds: [],
      contactReplicationIds: [],
      contactLaboratoryIds: [],
      groupKeys: [],
      scopeKeys: [],
      manageScopeKeys: [],
      sharedRecordKeys: [],
      editableRecordKeys: [],
      pendingRoles: [],
      capabilities: {},
      mfaEnrolled: inputs.user.mfaEnrolled,
      secondFactorRequired: false,
      sessionsValidAfter: inputs.sessionsValidAfter,
      suspended: true,
    };
  }

  const own = inputs.roleAssignments.filter(
    (assignment) => assignment.uid === uid && SCOPE_TYPES_OF_ROLE[assignment.role].includes(assignment.scopeType),
  );
  const active = own.filter((assignment) => assignment.status === "active" && unexpired(assignment.expiresAt, now));
  const grants = inputs.capabilityGrants.filter(
    (candidate) => candidate.uid === uid && candidate.revokedAt === null && unexpired(candidate.expiresAt, now),
  );
  const records = inputs.recordGrants.filter(
    (candidate) => candidate.uid === uid && candidate.revokedAt === null && unexpired(candidate.expiresAt, now),
  );

  const roles = new Set<Role>(active.map((assignment) => assignment.role));
  const programmeRoles = [...roles].filter(isProgrammeRole).sort();
  const secondFactorRequired = programmeRoles.length > 0 || grants.length > 0;
  /** Whether the powers of the programme roles and of the named grants are in effect. */
  const privileged = !secondFactorRequired || inputs.user.mfaEnrolled;

  const hasMemberRole = [...roles].some((role) => role !== "external_collaborator");
  const member = hasMemberRole || (inputs.personId !== null && !roles.has("external_collaborator"));

  const scopeIdsOf = (role: Role) =>
    sortedUnique(active.filter((assignment) => assignment.role === role).map((assignment) => assignment.scopeId));
  const leadReplicationIds = scopeIdsOf("replication_lead");
  const coordinatorLaboratoryIds = scopeIdsOf("lab_coordinator");
  const memberLaboratoryIds = scopeIdsOf("lab_member");
  const teamReplicationIds =
    member && inputs.personId !== null
      ? sortedUnique(inputs.confirmedReplicationIds.filter((id) => !leadReplicationIds.includes(id)))
      : [];
  const groupKeys = sortedUnique([
    ...inputs.groupKeys,
    ...active.filter((assignment) => assignment.scopeType === "group").map((assignment) => assignment.scopeId),
  ]);

  const overridesOf = new Map<Role, CapabilityOverrides>(
    inputs.roleCapabilities.map((stored) => [stored.role, stored.overrides]),
  );
  const held = new Map<GrantableCapability, Set<string>>();
  const hold = (capability: GrantableCapability, scope: string) => {
    const scopes = held.get(capability) ?? new Set<string>();
    scopes.add(scope);
    held.set(capability, scopes);
  };
  for (const assignment of active) {
    const programmeWide = isProgrammeRole(assignment.role);
    if (programmeWide && !privileged) continue;
    for (const capability of effectiveRoleCapabilities(assignment.role, overridesOf.get(assignment.role))) {
      const everywhere = programmeWide || CAPABILITY_DEFINITIONS[capability].level === "member";
      hold(capability, everywhere ? PROGRAMME_SCOPE_KEY : assignmentScopeKey(assignment.scopeType, assignment.scopeId));
    }
  }
  if (privileged) for (const candidate of grants) hold(candidate.capability, PROGRAMME_SCOPE_KEY);

  const capabilities: ResolvedAccess["capabilities"] = {};
  for (const [capability, scopes] of [...held].sort(([a], [b]) => (a < b ? -1 : 1))) {
    capabilities[capabilityField(capability)] = scopes.has(PROGRAMME_SCOPE_KEY)
      ? [PROGRAMME_SCOPE_KEY]
      : sortedUnique(scopes);
  }

  // The units in which a role of the account itself confers sight of contact details. A holder
  // of the capability for the programme as a whole is no part of this: the rules ask for the
  // programme powers of such a session, second factor included.
  const contactScopes = held.get("people.contact.read") ?? new Set<string>();
  const contactReplicationIds = leadReplicationIds.filter((id) => contactScopes.has(replicationScopeKey(id)));
  const contactLaboratoryIds = sortedUnique([...coordinatorLaboratoryIds, ...memberLaboratoryIds]).filter((id) =>
    contactScopes.has(laboratoryScopeKey(id)),
  );
  const effectiveRoles = [...roles].filter((role) => privileged || !isProgrammeRole(role));
  const scopeKeys = sortedUnique([
    userScopeKey(uid),
    ...(member ? [MEMBERS_SCOPE_KEY] : []),
    ...(privileged && programmeRoles.length > 0 ? [PROGRAMME_SCOPE_KEY] : []),
    ...[...leadReplicationIds, ...teamReplicationIds].map(replicationScopeKey),
    ...[...coordinatorLaboratoryIds, ...memberLaboratoryIds].map(laboratoryScopeKey),
    ...groupKeys.map(groupScopeKey),
    ...effectiveRoles.map(roleScopeKey),
  ]);

  return {
    member,
    personId: inputs.personId,
    programmeRoles: programmeRoles as ProgrammeRole[],
    leadReplicationIds,
    teamReplicationIds,
    coordinatorLaboratoryIds,
    memberLaboratoryIds,
    contactReplicationIds,
    contactLaboratoryIds,
    groupKeys,
    scopeKeys,
    manageScopeKeys: sortedUnique([
      ...leadReplicationIds.map(replicationScopeKey),
      ...coordinatorLaboratoryIds.map(laboratoryScopeKey),
    ]),
    sharedRecordKeys: sortedUnique(records.map((record) => entityRefId(record.entityType, record.entityId))),
    editableRecordKeys: sortedUnique(
      records
        .filter((record) => record.level === "edit")
        .map((record) => entityRefId(record.entityType, record.entityId)),
    ),
    pendingRoles: own
      .filter((assignment) => assignment.status === "pendingApproval")
      .map(({ role, scopeType, scopeId }) => ({ role, scopeType, scopeId }))
      .sort(comparePendingRoles),
    capabilities,
    mfaEnrolled: inputs.user.mfaEnrolled,
    secondFactorRequired,
    sessionsValidAfter: inputs.sessionsValidAfter,
    suspended: false,
  };
}

/**
 * The scope keys that stand for the powers of a programme role: the programme as a whole and
 * the two programme roles. An access document lists them once a second factor is enrolled, and
 * they count only in a session that satisfies `secondFactorRequired`.
 */
export const PROGRAMME_POWER_SCOPE_KEYS: readonly string[] = [
  PROGRAMME_SCOPE_KEY,
  roleScopeKey("programme_admin"),
  roleScopeKey("core_team"),
];

/** What the rules and the functions need to know about the second factor of a session. */
export interface SecondFactorFacts {
  /** Whether the sign-in token says that a second factor was verified in this session. */
  readonly secondFactorVerified: boolean;
}

/**
 * Whether the powers of a programme role or of a named grant are in effect in a session: a
 * factor is enrolled, and the session presents it wherever the access document requires one.
 * This is the decision that `programmePowers()` makes in portal/firestore.rules.
 */
export function programmePowersInEffect(
  access: Pick<AccessDocument, "mfaEnrolled" | "secondFactorRequired">,
  session: SecondFactorFacts,
): boolean {
  return access.mfaEnrolled && (!access.secondFactorRequired || session.secondFactorVerified);
}

/**
 * The scope keys that an account holds in a session. A document whose audience is the programme
 * as a whole is for programme administrators and the core team, whose powers need the second
 * factor, so the keys of `PROGRAMME_POWER_SCOPE_KEYS` are left out of a session that lacks it.
 * The rules compare `scopeKeys` of a document with these keys, and a function that filters by
 * scope does the same.
 */
export function sessionScopeKeys(
  access: Pick<AccessDocument, "scopeKeys" | "mfaEnrolled" | "secondFactorRequired" | "suspended">,
  session: SecondFactorFacts,
): string[] {
  if (access.suspended) return [];
  return programmePowersInEffect(access, session)
    ? [...access.scopeKeys]
    : access.scopeKeys.filter((key) => !PROGRAMME_POWER_SCOPE_KEYS.includes(key));
}

/** The access document of an account that has been granted nothing: what a first sign-in creates. */
export function emptyAccess(): ResolvedAccess {
  return {
    member: false,
    personId: null,
    programmeRoles: [],
    leadReplicationIds: [],
    teamReplicationIds: [],
    coordinatorLaboratoryIds: [],
    memberLaboratoryIds: [],
    contactReplicationIds: [],
    contactLaboratoryIds: [],
    groupKeys: [],
    scopeKeys: [],
    manageScopeKeys: [],
    sharedRecordKeys: [],
    editableRecordKeys: [],
    pendingRoles: [],
    capabilities: {},
    mfaEnrolled: false,
    secondFactorRequired: false,
    sessionsValidAfter: null,
    suspended: false,
  };
}

/** The record a capability is asked for: its replication, its laboratory and its group, where it has them. */
export interface RecordScope {
  readonly replicationId?: string | null;
  readonly laboratoryId?: string | null;
  readonly groupKey?: string | null;
}

/**
 * Where a capability is asked for.
 *
 * | Scope          | The account must hold the capability                                        |
 * |----------------|-----------------------------------------------------------------------------|
 * | `"programme"`  | For the programme as a whole                                                |
 * | A record scope | For the programme as a whole, or for the replication, the laboratory or the group of the record |
 * | `"anywhere"`   | In at least one scope. For the interface only, to decide whether to show an entry: never authorise with it |
 */
export type CapabilityScope = "programme" | "anywhere" | RecordScope;

/**
 * Whether an account holds a capability in a scope, from its access document. A suspended
 * account holds none. `portal.use` belongs to every account that is not suspended, whatever the
 * scope. Callable functions authorise with this, and security rules make the same decision
 * from the same document.
 */
export function can(
  access: Pick<AccessDocument, "suspended" | "capabilities">,
  capability: Capability,
  scope: CapabilityScope,
): boolean {
  if (access.suspended) return false;
  if (capability === "portal.use") return true;
  const held = access.capabilities[capabilityField(capability)] ?? [];
  if (scope === "anywhere") return held.length > 0;
  if (held.includes(PROGRAMME_SCOPE_KEY)) return true;
  if (scope === "programme") return false;
  return (
    (scope.replicationId != null && held.includes(replicationScopeKey(scope.replicationId))) ||
    (scope.laboratoryId != null && held.includes(laboratoryScopeKey(scope.laboratoryId))) ||
    (scope.groupKey != null && held.includes(groupScopeKey(scope.groupKey)))
  );
}

/** What the interface knows about the current account. */
export interface AccountState {
  readonly signedIn: boolean;
  /** The account's access document, or null when it is not known or does not exist. */
  readonly access: Pick<AccessDocument, "suspended" | "capabilities"> | null;
}

/**
 * The capabilities the interface may show something for: those the account holds in at least
 * one scope. A signed-in account whose access document is not known yet may use the portal and
 * nothing else. This decides what is shown and never what is allowed.
 */
export function capabilitiesOf(state: AccountState): ReadonlySet<Capability> {
  if (!state.signedIn) return new Set();
  const { access } = state;
  if (access === null) return new Set<Capability>(["portal.use"]);
  return new Set(CAPABILITIES.filter((capability) => can(access, capability, "anywhere")));
}

export function hasCapability(state: AccountState, capability: Capability): boolean {
  return capabilitiesOf(state).has(capability);
}
