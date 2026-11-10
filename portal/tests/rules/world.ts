// The synthetic world of the security-rules tests: two replications, two laboratories and one
// account for every kind of caller the rules tell apart.
// Everything here is synthetic. The accounts, people, studies and laboratories are fictitious
// and every address is on the example.org domain.
import {
  type AccessInputs,
  emptyAccess,
  type GrantableCapability,
  participationId,
  type ResolvedAccess,
  type Role,
  type RoleScopeType,
  resolveAccess,
  systemWriteContext,
  userWriteContext,
} from "@eegml/shared";
import type { RulesTestEnvironment, TokenOptions } from "@firebase/rules-unit-testing";
import { type FieldValue, type Firestore, serverTimestamp, Timestamp } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

/** The replication and the laboratory that the records under test belong to, and one other of each. */
export const OWN_REPLICATION = "SyntheticStudy2001";
export const OTHER_REPLICATION = "SyntheticStudy2002";
export const OWN_LABORATORY = "lab-synthetic-own";
export const OTHER_LABORATORY = "lab-synthetic-other";
/** The participation of the owning laboratory in the owning replication. */
export const OWN_PARTICIPATION = participationId(OWN_REPLICATION, OWN_LABORATORY);
/** A participation that has no private detail yet: the other laboratory in the owning replication. */
export const SECOND_PARTICIPATION = participationId(OWN_REPLICATION, OTHER_LABORATORY);

/** The person that the account `owner` has claimed, and the person of the account `member`. */
export const OWNER_PERSON = "person-synthetic-owner";
export const MEMBER_PERSON = "person-synthetic-member";

/**
 * An identifier of the shape that Firestore generates for a record made in the portal: twenty
 * letters and digits, which is the only shape the rules accept where the data model calls an
 * identifier opaque. The label is kept at its start, so that a test still reads as what it
 * creates, and a label that is too long ends in a number computed from the whole of it, so that
 * two labels never give one identifier.
 */
export function autoId(label: string): string {
  const letters = label.replace(/[^A-Za-z0-9]/g, "");
  if (letters.length === 0) throw new RangeError(`"${label}" holds no letter and no digit.`);
  if (letters.length <= 20) return letters.padEnd(20, "0");
  // FNV-1a over the label, written in base 36.
  let hash = 0x811c9dc5;
  for (const character of label) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return `${letters.slice(0, 13)}${hash.toString(36).padStart(7, "0")}`;
}

/** An instant in the past that stored documents carry. */
export const STORED_AT = Timestamp.fromDate(new Date("2026-01-02T03:04:05Z"));
/** The time of sign-in that every token states, in seconds since the epoch. */
const SIGNED_IN_AT = 1_780_000_000;
/** The instant at which the access documents of the world were resolved. */
const RESOLVED_AT = new Date("2026-06-01T00:00:00Z");

/**
 * The kinds of caller. Every test of the matrix runs once for each.
 *
 * | Kind                 | Who                                                                         |
 * |----------------------|-----------------------------------------------------------------------------|
 * | `signedOut`          | Nobody: a request without a sign-in token                                   |
 * | `noMembership`       | A signed-in account that has claimed no profile and holds no role           |
 * | `suspended`          | A lead and coordinator of the owning units whose access document still lists both roles and says that the account is suspended |
 * | `member`             | An approved member with no role                                             |
 * | `owner`              | An approved member with no role, who owns the records of the tier SELF      |
 * | `ownLabMember`       | A member of the owning laboratory                                           |
 * | `otherLabMember`     | A member of the other laboratory                                            |
 * | `ownCoordinator`     | A coordinator of the owning laboratory                                      |
 * | `otherCoordinator`   | A coordinator of the other laboratory                                       |
 * | `ownTeam`            | A confirmed team member of the owning replication, who is no lead           |
 * | `ownLead`            | A lead of the owning replication                                            |
 * | `otherLead`          | A lead of the other replication                                             |
 * | `coreTeam`           | The core team, signed in with a second factor                               |
 * | `admin`              | A programme administrator, signed in with a second factor                   |
 * | `adminWithoutFactor` | A programme administrator with an enrolled factor, signed in without it     |
 */
export const CALLER_KINDS = [
  "signedOut",
  "noMembership",
  "suspended",
  "member",
  "owner",
  "ownLabMember",
  "otherLabMember",
  "ownCoordinator",
  "otherCoordinator",
  "ownTeam",
  "ownLead",
  "otherLead",
  "coreTeam",
  "admin",
  "adminWithoutFactor",
] as const;
export type CallerKind = (typeof CALLER_KINDS)[number];

export interface CallerProfile {
  readonly kind: CallerKind;
  /** The uid of the account, or null for a caller who is not signed in. */
  readonly uid: string | null;
  readonly email: string | null;
  /** `access/{uid}` as `resolveAccess` computes it, or null for a caller who is not signed in. */
  readonly access: ResolvedAccess | null;
  /** Whether the sign-in token says that a second factor was verified in this session. */
  readonly secondFactor: boolean;
}

export interface AccountSpec {
  readonly roles?: readonly (readonly [Role, RoleScopeType, string])[];
  readonly personId?: string;
  readonly confirmedReplicationIds?: readonly string[];
  readonly suspended?: boolean;
  readonly mfaEnrolled?: boolean;
  readonly secondFactor?: boolean;
  /** An account that has not claimed a profile: its access document is the empty one. */
  readonly unclaimed?: boolean;
  /** Capabilities that a programme administrator granted to the account by name. */
  readonly namedGrants?: readonly GrantableCapability[];
  /** Stored overrides of the default capability matrix. */
  readonly overrides?: AccessInputs["roleCapabilities"];
}

const PROGRAMME = "programme";

const ACCOUNT_SPECS: { readonly [K in Exclude<CallerKind, "signedOut">]: AccountSpec } = {
  noMembership: { unclaimed: true },
  suspended: {
    roles: [
      ["replication_lead", "replication", OWN_REPLICATION],
      ["lab_coordinator", "laboratory", OWN_LABORATORY],
    ],
    personId: "person-synthetic-suspended",
    suspended: true,
  },
  member: { personId: MEMBER_PERSON },
  owner: { personId: OWNER_PERSON },
  ownLabMember: { roles: [["lab_member", "laboratory", OWN_LABORATORY]], personId: "person-synthetic-own-lab-member" },
  otherLabMember: {
    roles: [["lab_member", "laboratory", OTHER_LABORATORY]],
    personId: "person-synthetic-other-lab-member",
  },
  ownCoordinator: {
    roles: [["lab_coordinator", "laboratory", OWN_LABORATORY]],
    personId: "person-synthetic-own-coordinator",
  },
  otherCoordinator: {
    roles: [["lab_coordinator", "laboratory", OTHER_LABORATORY]],
    personId: "person-synthetic-other-coordinator",
  },
  ownTeam: { personId: "person-synthetic-own-team", confirmedReplicationIds: [OWN_REPLICATION] },
  ownLead: {
    roles: [["replication_lead", "replication", OWN_REPLICATION]],
    personId: "person-synthetic-own-lead",
  },
  otherLead: {
    roles: [["replication_lead", "replication", OTHER_REPLICATION]],
    personId: "person-synthetic-other-lead",
  },
  coreTeam: {
    roles: [["core_team", "programme", PROGRAMME]],
    personId: "person-synthetic-core-team",
    mfaEnrolled: true,
    secondFactor: true,
  },
  admin: {
    roles: [["programme_admin", "programme", PROGRAMME]],
    personId: "person-synthetic-admin",
    mfaEnrolled: true,
    secondFactor: true,
  },
  adminWithoutFactor: {
    roles: [["programme_admin", "programme", PROGRAMME]],
    personId: "person-synthetic-admin-without-factor",
    mfaEnrolled: true,
    secondFactor: false,
  },
};

const uidOf = (kind: string) => `uid-${kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/** Resolves the access document of a synthetic account with the code that the functions use. */
export function resolveSyntheticAccess(uid: string, spec: AccountSpec): ResolvedAccess {
  if (spec.unclaimed) return emptyAccess();
  // A suspension is resolved as if the account were in good standing, and the flag is set on
  // the result: the rules must refuse on the flag alone, whatever else the document still grants.
  if (spec.suspended) return { ...resolveSyntheticAccess(uid, { ...spec, suspended: false }), suspended: true };
  const inputs: AccessInputs = {
    uid,
    now: RESOLVED_AT,
    user: { status: "active", mfaEnrolled: spec.mfaEnrolled ?? false },
    personId: spec.personId ?? null,
    sessionsValidAfter: null,
    roleAssignments: (spec.roles ?? []).map(([role, scopeType, scopeId]) => ({
      uid,
      role,
      scopeType,
      scopeId,
      status: "active" as const,
      expiresAt: null,
    })),
    capabilityGrants: (spec.namedGrants ?? []).map((capability) => ({
      uid,
      capability,
      expiresAt: null,
      revokedAt: null,
    })),
    roleCapabilities: spec.overrides ?? [],
    recordGrants: [],
    groupKeys: [],
    confirmedReplicationIds: spec.confirmedReplicationIds ?? [],
  };
  return resolveAccess(inputs);
}

function profileOf(kind: CallerKind): CallerProfile {
  if (kind === "signedOut") return { kind, uid: null, email: null, access: null, secondFactor: false };
  const spec = ACCOUNT_SPECS[kind];
  const uid = uidOf(kind);
  return {
    kind,
    uid,
    email: `${uid.slice(4)}.account@example.org`,
    access: resolveSyntheticAccess(uid, spec),
    secondFactor: spec.secondFactor ?? false,
  };
}

export const CALLERS: { readonly [K in CallerKind]: CallerProfile } = Object.fromEntries(
  CALLER_KINDS.map((kind) => [kind, profileOf(kind)]),
) as { readonly [K in CallerKind]: CallerProfile };

/** The uid of a signed-in caller of the world. */
export function uidOfCaller(kind: Exclude<CallerKind, "signedOut">): string {
  return uidOf(kind);
}

export const OWNER_UID = uidOfCaller("owner");
export const MEMBER_UID = uidOfCaller("member");

/** The standard fields of a stored document that an importer wrote. */
export function stored(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    createdAt: STORED_AT,
    updatedAt: STORED_AT,
    createdBy: "system:import",
    updatedBy: "system:import",
    archivedAt: null,
    writeContext: systemWriteContext("import"),
  };
}

/** The standard fields of a stored document of an append-only collection. */
export function appended(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    createdAt: STORED_AT,
    createdBy: "system:import",
    writeContext: systemWriteContext("import"),
  };
}

/** The access documents of every signed-in caller, by path, as trusted code stores them. */
export function accessDocuments(): Record<string, Record<string, unknown>> {
  const documents: Record<string, Record<string, unknown>> = {};
  for (const kind of CALLER_KINDS) {
    const { uid, access } = CALLERS[kind];
    if (uid !== null && access !== null) documents[`access/${uid}`] = { ...stored(), ...access };
  }
  return documents;
}

/** The standard fields that a client sets when it creates a document. */
export function createdBy(uid: string, appendOnly = false): Record<string, FieldValue | unknown> {
  const creation = {
    schemaVersion: 1,
    createdAt: serverTimestamp(),
    createdBy: uid,
    writeContext: userWriteContext(),
  };
  return appendOnly ? creation : { ...creation, updatedAt: serverTimestamp(), updatedBy: uid, archivedAt: null };
}

/** The standard fields that a client sets when it changes a document. */
export function updatedBy(uid: string): Record<string, FieldValue | unknown> {
  return { updatedAt: serverTimestamp(), updatedBy: uid, writeContext: userWriteContext() };
}

/** The uid a caller writes into a document: its own, or a placeholder for a caller who is not signed in. */
export function actingUid(caller: CallerProfile): string {
  return caller.uid ?? "uid-nobody";
}

/** The sign-in token of a caller, as the rules see it. */
export function tokenOf(caller: CallerProfile, authTime: number = SIGNED_IN_AT): TokenOptions {
  // The second factor of a session is a claim beneath `firebase`, which the type of the test
  // library does not name.
  const firebase: NonNullable<TokenOptions["firebase"]> & { sign_in_second_factor?: string } = caller.secondFactor
    ? { sign_in_provider: "password", sign_in_second_factor: "totp" }
    : { sign_in_provider: "password" };
  return {
    ...(caller.email === null ? {} : { email: caller.email }),
    email_verified: true,
    auth_time: authTime,
    firebase,
  };
}

const clients = new WeakMap<RulesTestEnvironment, Map<CallerKind, Firestore>>();

/**
 * Firestore as a caller of the world sees it, with the security rules applied. Each kind of
 * caller keeps one client for the life of an environment.
 */
export function firestoreOf(environment: RulesTestEnvironment, caller: CallerProfile): Firestore {
  const ofEnvironment = clients.get(environment) ?? new Map<CallerKind, Firestore>();
  clients.set(environment, ofEnvironment);
  const existing = ofEnvironment.get(caller.kind);
  if (existing !== undefined) return existing;
  const context =
    caller.uid === null
      ? environment.unauthenticatedContext()
      : environment.authenticatedContext(caller.uid, tokenOf(caller));
  // The context returns a compat instance, which the modular functions accept.
  const db = context.firestore() as unknown as Firestore;
  ofEnvironment.set(caller.kind, db);
  return db;
}

/** Cloud Storage as a caller of the world sees it, with the security rules applied. */
export function storageOf(environment: RulesTestEnvironment, caller: CallerProfile): FirebaseStorage {
  const context =
    caller.uid === null
      ? environment.unauthenticatedContext()
      : environment.authenticatedContext(caller.uid, tokenOf(caller));
  return context.storage() as unknown as FirebaseStorage;
}

/** Firestore as an account with a token of the test's own making sees it. */
export function firestoreWithToken(environment: RulesTestEnvironment, uid: string, token: TokenOptions): Firestore {
  return environment.authenticatedContext(uid, token).firestore() as unknown as Firestore;
}
