// What the collection registry says each kind of caller may do, as a function of the registry
// alone. The matrix test compares every answer of this model with what the security rules do,
// so the rules implement the registry exactly and a change to either shows up as a failure.
//
// The model knows nothing of the rules file. It reads an entry's tiers, scope fields, capability
// and write grants, and a caller's access document as `resolveAccess` computes it.
import {
  type AccessTier,
  type ClientWriteGrant,
  type CollectionEntry,
  capabilityField,
  type GrantableCapability,
  laboratoryScopeKey,
  type PageAccessFacts,
  type PageLevel,
  PROGRAMME_SCOPE_KEY,
  atLeast as pageLevelAtLeast,
  pageLevelFor,
  programmePowersInEffect,
  replicationScopeKey,
  sessionScopeKeys,
  type WriteOperation,
  type Writer,
} from "@eegml/shared";
import type { CallerProfile } from "./world";

/**
 * What is known about a record when a request is decided. A read of one document knows all of
 * it. A list knows only what its constraints prove about every document it could return, so a
 * field that the query does not constrain is absent here.
 */
export interface Known {
  /** The account that owns the record: the tier SELF and the writer `self`. */
  readonly ownerUid?: string;
  /** The accounts that a participant array of the record names, who read it as the tier SELF: the assignees of a task. */
  readonly participantUids?: readonly string[];
  readonly replicationId?: string | null;
  readonly laboratoryId?: string | null;
  /** Scope keys that the record is known to carry. */
  readonly scopeKeys?: readonly string[];
  /** Whether every member reads the record, for an entry that opens only some records to every member. */
  readonly memberVisible?: boolean;
  /**
   * The page that the levels of the workspace writers are decided on: the record itself for a
   * page, the parent page for its subcollections, and the target page for a thread or a comment.
   */
  readonly page?: PageAccessFacts;
  /** The account that wrote the record: the writer `author`. */
  readonly authorUid?: string;
}

/** Whether the account may act at all: signed in and not suspended. */
export function isActive(caller: CallerProfile): boolean {
  return caller.access !== null && !caller.access.suspended;
}

export function isMember(caller: CallerProfile): boolean {
  return isActive(caller) && caller.access?.member === true;
}

/**
 * Whether the powers of a programme role or of a named grant are in effect: a factor is
 * enrolled, and the session presents it wherever the access document requires one.
 */
export function hasProgrammePowers(caller: CallerProfile): boolean {
  const access = caller.access;
  if (access === null || !isMember(caller)) return false;
  return programmePowersInEffect(access, { secondFactorVerified: caller.secondFactor });
}

/** Programme administrators and the core team, with their powers in effect. */
export function isStaff(caller: CallerProfile): boolean {
  return hasProgrammePowers(caller) && (caller.access?.programmeRoles.length ?? 0) > 0;
}

/**
 * Whether the caller holds a capability for the record: for its replication or its laboratory,
 * or for the programme as a whole, which counts only while the programme powers are in effect.
 */
export function holds(caller: CallerProfile, capability: GrantableCapability, known: Known): boolean {
  if (!isMember(caller)) return false;
  const held: readonly string[] = caller.access?.capabilities[capabilityField(capability)] ?? [];
  if (known.replicationId != null && held.includes(replicationScopeKey(known.replicationId))) return true;
  if (known.laboratoryId != null && held.includes(laboratoryScopeKey(known.laboratoryId))) return true;
  return held.includes(PROGRAMME_SCOPE_KEY) && hasProgrammePowers(caller);
}

/** Whether the caller holds one of the scopes that the record is known to belong to. */
export function holdsScope(caller: CallerProfile, known: Known): boolean {
  const access = caller.access;
  if (access === null || !isMember(caller)) return false;
  const { replicationId, laboratoryId } = known;
  if (replicationId != null && [...access.leadReplicationIds, ...access.teamReplicationIds].includes(replicationId)) {
    return true;
  }
  if (
    laboratoryId != null &&
    [...access.coordinatorLaboratoryIds, ...access.memberLaboratoryIds].includes(laboratoryId)
  ) {
    return true;
  }
  // The keys of the programme count only in a session that holds the programme powers.
  const held = sessionScopeKeys(access, { secondFactorVerified: caller.secondFactor });
  return (known.scopeKeys ?? []).some((key) => held.includes(key));
}

function satisfiesTier(entry: CollectionEntry, tier: AccessTier, caller: CallerProfile, known: Known): boolean {
  const { tiers, capability } = entry.read;
  switch (tier) {
    case "FUNCTION":
      return false;
    case "SELF":
      // The owner reads before the account is a member, which is what the claim flow needs.
      return (
        (known.ownerUid !== undefined && known.ownerUid === caller.uid) ||
        (caller.uid !== null && (known.participantUids ?? []).includes(caller.uid))
      );
    case "MEMBER":
      // Beside the tier SCOPED or SELF, MEMBER covers only the records that are open to every
      // member: a shared view, a dashboard that is not a user's own.
      return (
        isMember(caller) && ((!tiers.includes("SCOPED") && !tiers.includes("SELF")) || known.memberVisible === true)
      );
    case "ADMIN":
      return capability !== null && holds(caller, capability, {});
    case "SCOPED":
      return capability !== null ? holds(caller, capability, known) : isStaff(caller) || holdsScope(caller, known);
  }
}

/** Whether the caller holds at least a level on the page that is known for the record. */
function holdsPageLevel(caller: CallerProfile, known: Known, level: PageLevel): boolean {
  if (known.page === undefined) return false;
  return pageLevelAtLeast(
    pageLevelFor(caller.access, { secondFactorVerified: caller.secondFactor }, known.page),
    level,
  );
}

/** Whether the registry lets the caller read a record of the entry, given what is known of the record. */
export function mayRead(entry: CollectionEntry, caller: CallerProfile, known: Known): boolean {
  if (entry.enforcement !== "enforced" || !isActive(caller)) return false;
  return entry.read.tiers.some((tier) => satisfiesTier(entry, tier, caller, known));
}

function satisfiesWriter(
  writer: Writer,
  capability: GrantableCapability | null,
  caller: CallerProfile,
  known: Known,
): boolean {
  const access = caller.access;
  if (access === null) return false;
  switch (writer) {
    case "programme_admin":
    case "core_team":
      return (
        access.programmeRoles.includes(writer) &&
        hasProgrammePowers(caller) &&
        (capability === null || holds(caller, capability, {}))
      );
    case "replication_lead": {
      const { replicationId } = known;
      return (
        replicationId != null &&
        access.leadReplicationIds.includes(replicationId) &&
        (capability === null || holds(caller, capability, { replicationId }))
      );
    }
    case "lab_coordinator": {
      const { laboratoryId } = known;
      return (
        laboratoryId != null &&
        access.coordinatorLaboratoryIds.includes(laboratoryId) &&
        (capability === null || holds(caller, capability, { laboratoryId }))
      );
    }
    case "lab_member":
      return known.laboratoryId != null && access.memberLaboratoryIds.includes(known.laboratoryId);
    case "self":
      return known.ownerUid !== undefined && known.ownerUid === caller.uid;
    case "member":
      return true;
    case "commenter":
      return holdsPageLevel(caller, known, "comment");
    case "editor":
      return holdsPageLevel(caller, known, "edit");
    case "fullAccess":
      return holdsPageLevel(caller, known, "full");
    case "author":
      // An author who may no longer comment on the page keeps only the removal of their words,
      // which the features tests cover.
      return (
        known.authorUid !== undefined &&
        known.authorUid === caller.uid &&
        (known.page === undefined || holdsPageLevel(caller, known, "comment"))
      );
    case "participant":
    case "external_collaborator":
      // The participants of a record, and external collaborators as writers, belong to
      // collections whose rules are not written yet. Model them when those rules are.
      throw new Error(`The policy model does not know the writer "${writer}".`);
  }
}

/** The grants of an entry under which the caller may perform a write on a record. */
export function grantsFor(
  entry: CollectionEntry,
  operation: WriteOperation,
  caller: CallerProfile,
  known: Known,
): readonly ClientWriteGrant[] {
  if (entry.enforcement !== "enforced" || entry.write.mode !== "client" || !isMember(caller)) return [];
  return entry.write.grants.filter(
    (grant) =>
      grant.operations.includes(operation) &&
      grant.writers.some((writer) => satisfiesWriter(writer, grant.capability, caller, known)),
  );
}

/**
 * Whether the registry lets the caller perform a write on a record of the entry. Every writer
 * is an approved member, the writer `self` included.
 */
export function mayWrite(
  entry: CollectionEntry,
  operation: WriteOperation,
  caller: CallerProfile,
  known: Known,
): boolean {
  return grantsFor(entry, operation, caller, known).length > 0;
}

/** The write operations that the registry grants to anyone at all. */
export function grantedOperations(entry: CollectionEntry): readonly WriteOperation[] {
  if (entry.write.mode !== "client") return [];
  const granted = new Set(entry.write.grants.flatMap((grant) => grant.operations));
  return (["create", "update", "delete"] as const).filter((operation) => granted.has(operation));
}

/** Whether the documents of an entry share a collection, as opposed to one fixed-name document. */
export function isListable(entry: CollectionEntry): boolean {
  return entry.identifier.kind !== "fixed";
}

/**
 * Whether the parent document alone decides who reads the documents of an entry: every field
 * its read rule compares is a field of the parent. The rules then read the parent, whose path
 * the request gives, and a list beneath one parent is decided by that parent.
 */
export function isDecidedByParent(entry: CollectionEntry): boolean {
  return (
    entry.parent !== null &&
    entry.read.scopeFields.length > 0 &&
    entry.read.scopeFields.every((field) => field.startsWith("parent."))
  );
}

/**
 * Whether the collection of an entry is also read beneath every parent at once. A subcollection
 * that members, scoped roles or administrators read is. A subcollection of a user is read
 * beneath its own user only, `private` and `special` documents are read by path alone, and so
 * is a subcollection whose parent decides who reads it, such as the content of a page.
 */
export function isReadAcrossParents(entry: CollectionEntry): boolean {
  return (
    entry.enforcement === "enforced" &&
    entry.parent !== null &&
    isListable(entry) &&
    !isDecidedByParent(entry) &&
    !entry.read.tiers.includes("SELF") &&
    !entry.read.tiers.includes("FUNCTION")
  );
}
