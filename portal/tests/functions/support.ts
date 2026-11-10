// Helpers for the integration tests of the functions, run against the emulators.
// Everything here is synthetic: fictitious accounts, people and laboratories on the example.org domain.
//
// A caller is a hand-made sign-in token. The functions emulator decodes a token without
// verifying it (docs/SECURITY.md, section 3), which lets a test state exactly what a token
// claims: the account, whether its address is verified, and whether a second factor was
// presented. The Authentication emulator implements no one-time passwords, so this is the only
// way to exercise the second-factor rule here. Nothing in these tests proves token verification.
import {
  type AccessDocument,
  type AuditEvent,
  accessDocSchema,
  auditEventSchema,
  type CallableContract,
  type CallableInput,
  type CallableOutput,
  COLLECTIONS,
  capabilityGrantId,
  DEMO_IDENTITY_HASH_KEY,
  FUNCTIONS_REGION,
  type GrantableCapability,
  normaliseEmail,
  PROGRAMME_KEY,
  personEmailIndexId,
  type Role,
  type RoleScopeType,
  replicationMembershipId,
  roleAssignmentId,
  systemWriteContext,
  type UserNotificationDoc,
  userNotificationDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { rebuildAccess } from "../../functions/src/access/maintain";
import { adminDb } from "../support/admin";
import { clearAuth, clearFirestore, FUNCTIONS_URL, PROJECT_ID, setBackgroundTriggers } from "../support/emulators";

/** Who a call claims to come from. */
export interface Caller {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  /** Whether the sign-in token names a second factor that was verified in the session. */
  readonly secondFactor?: boolean;
  /** When the session began, in seconds since the epoch. Now, unless the test says otherwise. */
  readonly authTime?: number;
}

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned sign-in token with the claims that Firebase Authentication would issue for the caller. */
export function tokenOf(caller: Caller): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    encoded({ alg: "none", typ: "JWT" }),
    encoded({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      auth_time: caller.authTime ?? now,
      iat: now,
      exp: now + 3600,
      sub: caller.uid,
      user_id: caller.uid,
      email: caller.email,
      email_verified: caller.emailVerified ?? true,
      firebase: {
        identities: { email: [caller.email] },
        sign_in_provider: "password",
        ...(caller.secondFactor === true ? { sign_in_second_factor: "totp" } : {}),
      },
    }),
    "",
  ].join(".");
}

/** A refusal of a call, with the code in the spelling of the web SDK, without its `functions/` prefix. */
export class CallFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

/** Calls a function over HTTP with arbitrary data, as the callable protocol sends it. */
export async function callRaw(caller: Caller | null, name: string, data: unknown): Promise<unknown> {
  const response = await fetch(`${FUNCTIONS_URL}/${PROJECT_ID}/${FUNCTIONS_REGION}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(caller === null ? {} : { authorization: `Bearer ${tokenOf(caller)}` }),
    },
    body: JSON.stringify({ data }),
  });
  const body = (await response.json()) as {
    result?: unknown;
    error?: { status: string; message: string; details?: unknown };
  };
  if (body.error !== undefined) {
    throw new CallFailure(body.error.status.toLowerCase().replaceAll("_", "-"), body.error.message, body.error.details);
  }
  return body.result;
}

/** Calls a function by its contract and validates the answer against it, as the web application does. */
export async function call<C extends CallableContract>(
  caller: Caller | null,
  contract: C,
  input: CallableInput<C>,
): Promise<CallableOutput<C>> {
  return contract.output.parse(await callRaw(caller, contract.name, input)) as CallableOutput<C>;
}

/** The refusal of a call that is expected to fail. */
export async function refusal(promise: Promise<unknown>): Promise<CallFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CallFailure) return error;
    throw error;
  }
  throw new Error("The call was expected to be refused, and it succeeded.");
}

/** The code of the refusal of a call, or "(no error)". */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CallFailure) return error.code;
    throw error;
  }
  return "(no error)";
}

/** Waits until a probe gives a value, and fails with what was awaited when it never does. */
export async function eventually<T>(
  probe: () => Promise<T | undefined | null | false>,
  what: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Empties the emulators before a test. The triggers stay on, so what the previous test left
 * queued, and the deletions of the clear itself, can still reach them while the next test runs.
 * The triggers that derive a value read the documents as they are when they run, so they do no
 * harm. The audit trigger records such a deletion, which is why a test that reads the audit
 * entries of one path uses a path of its own.
 */
export async function resetWorld(): Promise<void> {
  await Promise.all([clearFirestore(), clearAuth()]);
}

/**
 * Empties the emulators at the end of a test file, with the triggers switched off around the
 * clear. Switching them off waits for the work that is queued, and what arrives while they are
 * off, the deletions of the clear included, is ignored. The next file therefore starts with an
 * empty database and no late deliveries. Switching the triggers on again makes the functions
 * emulator load them anew, which takes a few seconds, so this is done once for a file.
 */
export async function leaveNoTrace(): Promise<void> {
  await setBackgroundTriggers(false);
  await resetWorld();
  await pause(100);
  await setBackgroundTriggers(true);
}

let sentinels = 0;

/**
 * Waits, in the middle of a test, until the triggers have nothing left to do: a sentinel write
 * has been audited, and the audit trail and the derived documents have stopped changing. Use it
 * to show that the triggers did not write something. To wait for something they do write,
 * use `eventually`.
 */
export async function settle(): Promise<void> {
  sentinels += 1;
  const sentinel = adminDb.doc(`countCategories/zz-settle-${process.pid}-${sentinels}`);
  await sentinel.set({
    ...standard(),
    key: "zzSettle",
    label: "Settle",
    definition: "A sentinel.",
    position: 999,
    isCore: false,
  });
  await eventually(
    async () => (await adminDb.collection("auditEvents").where("documentPath", "==", sentinel.path).get()).size > 0,
    "the audit entry of the sentinel",
  );
  const fingerprint = async () => {
    const [audit, access, persons] = await Promise.all([
      adminDb.collection("auditEvents").select().get(),
      adminDb.collection("access").select().get(),
      adminDb.collection("persons").select().get(),
    ]);
    const times = [...access.docs, ...persons.docs].map((document) => document.updateTime.toMillis());
    return `${audit.size}:${times.join(",")}`;
  };
  let before = await fingerprint();
  for (let stable = 0; stable < 5; ) {
    await pause(200);
    const after = await fingerprint();
    stable = after === before ? stable + 1 : 0;
    before = after;
  }
}

// ----- The world -----

export const SEED_ACTOR = "system:test";

export function standard(now: Timestamp = Timestamp.now()) {
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: SEED_ACTOR,
    updatedBy: SEED_ACTOR,
    archivedAt: null,
    writeContext: systemWriteContext(),
  };
}

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Resolves the access document of an account from what is stored, as the functions do. */
export async function rebuild(uid: string): Promise<void> {
  await rebuildAccess(adminDb, uid, { at: new Date(), logger });
}

export interface AccountOptions {
  readonly email?: string;
  readonly status?: "active" | "suspended";
  readonly mfaEnrolled?: boolean;
  readonly personId?: string | null;
  readonly emailVerified?: boolean;
  readonly secondFactor?: boolean;
}

/** Registers an account as `sessionStart` would, and resolves its access document. */
export async function account(uid: string, options: AccountOptions = {}): Promise<Caller> {
  const email = options.email ?? `${uid}@example.org`;
  await adminDb.doc(COLLECTIONS.users.docPath(uid)).set({
    ...standard(),
    emailLower: normaliseEmail(email),
    displayName: null,
    personId: options.personId ?? null,
    status: options.status ?? "active",
    mfaEnrolled: options.mfaEnrolled ?? false,
    lastSeenAt: Timestamp.now(),
    dataOrigin: "demo",
  });
  await rebuild(uid);
  return {
    uid,
    email,
    ...(options.emailVerified === undefined ? {} : { emailVerified: options.emailVerified }),
    ...(options.secondFactor === undefined ? {} : { secondFactor: options.secondFactor }),
  };
}

/** Writes a role assignment as trusted code would, and resolves the access document of its account. */
export async function grantRole(
  uid: string,
  role: Role,
  scopeType: RoleScopeType = "programme",
  scopeId: string = PROGRAMME_KEY,
  status: "active" | "pendingApproval" | "revoked" = "active",
): Promise<string> {
  const id = roleAssignmentId(uid, role, scopeType, scopeId);
  const now = Timestamp.now();
  await adminDb.doc(COLLECTIONS.roleAssignments.docPath(id)).set({
    ...standard(now),
    uid,
    role,
    scopeType,
    scopeId,
    status,
    grantedBy: status === "pendingApproval" ? null : SEED_ACTOR,
    grantedAt: status === "pendingApproval" ? null : now,
    expiresAt: null,
    revokedBy: status === "revoked" ? SEED_ACTOR : null,
    revokedAt: status === "revoked" ? now : null,
    history: [],
  });
  await rebuild(uid);
  return id;
}

/** Writes a named capability grant as trusted code would, and resolves the access document of its account. */
export async function grantCapability(
  uid: string,
  capability: GrantableCapability,
  expiresAt: Date | null = new Date(Date.now() + 3_600_000),
): Promise<void> {
  const now = Timestamp.now();
  await adminDb.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, capability))).set({
    ...standard(now),
    uid,
    capability,
    grantedBy: SEED_ACTOR,
    grantedAt: now,
    reason: "A synthetic grant for a test.",
    expiresAt: expiresAt === null ? null : Timestamp.fromDate(expiresAt),
    revokedBy: null,
    revokedAt: null,
    history: [],
  });
  await rebuild(uid);
}

/**
 * A programme administrator whose second factor is enrolled. The caller presents the factor
 * unless the test says otherwise.
 */
export async function administrator(uid: string, options: { readonly secondFactor?: boolean } = {}): Promise<Caller> {
  const caller = await account(uid, { mfaEnrolled: true, secondFactor: options.secondFactor ?? true });
  await grantRole(uid, "programme_admin");
  return caller;
}

/** A member of the core team whose second factor is enrolled and presented. */
export async function coreTeamMember(uid: string): Promise<Caller> {
  const caller = await account(uid, { mfaEnrolled: true, secondFactor: true });
  await grantRole(uid, "core_team");
  return caller;
}

export interface PersonEmail {
  readonly email: string;
  readonly kind?: "primary" | "secondary" | "historical";
  readonly claimEligible?: boolean;
}

/** Writes a person as an import would: the directory document, the contact document and the index entries. */
export async function person(
  id: string,
  emails: readonly PersonEmail[] = [],
  fields: Record<string, unknown> = {},
): Promise<void> {
  await adminDb.doc(COLLECTIONS.persons.docPath(id)).set({
    ...standard(),
    slug: id,
    displayName: `Synthetic ${id}`,
    laboratoryIds: [],
    replicationIds: [],
    isCoreTeam: false,
    publicListing: "none",
    coreRoles: [],
    userId: null,
    claimedAt: null,
    custom: {},
    dataOrigin: "demo",
    ...fields,
  });
  await adminDb.doc(COLLECTIONS.personContact.docPath(id)).set({
    ...standard(),
    emails: emails.map((entry) => ({
      email: normaliseEmail(entry.email),
      kind: entry.kind ?? "primary",
      verifiedAt: null,
      claimEligible: entry.claimEligible ?? true,
    })),
  });
  for (const entry of emails) {
    const reference = adminDb.doc(emailIndexPath(entry.email));
    const stored = (await reference.get()).data();
    const held = (field: string): string[] => (stored?.[field] as string[] | undefined) ?? [];
    await reference.set({
      ...standard(),
      personIds: [...new Set([...held("personIds"), id])].sort(),
      claimEligiblePersonIds: [
        ...new Set([...held("claimEligiblePersonIds"), ...((entry.claimEligible ?? true) ? [id] : [])]),
      ].sort(),
    });
  }
}

/** The path of the index entry of an address, under the key that the functions use in the emulator. */
export function emailIndexPath(email: string): string {
  return COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(email, DEMO_IDENTITY_HASH_KEY));
}

export async function institution(id: string, emailDomains: readonly string[]): Promise<void> {
  await adminDb
    .doc(COLLECTIONS.institutions.docPath(id))
    .set({ ...standard(), name: `Synthetic institution ${id}`, emailDomains: [...emailDomains] });
}

export async function laboratory(id: string, fields: Record<string, unknown> = {}): Promise<void> {
  await adminDb.doc(COLLECTIONS.laboratories.docPath(id)).set({
    ...standard(),
    slug: id,
    name: `Synthetic laboratory ${id}`,
    status: "active",
    custom: {},
    dataOrigin: "demo",
    ...fields,
  });
}

export async function replication(studyKey: string): Promise<void> {
  await adminDb.doc(COLLECTIONS.replications.docPath(studyKey)).set({
    ...standard(),
    programmeId: PROGRAMME_KEY,
    studyKey,
    citationStatus: "unverified",
    statusKey: null,
    statusHistoryId: null,
    selectionStatus: "selected",
    leadPersonIds: [],
    vocabulary: [],
    custom: {},
    dataOrigin: "demo",
  });
}

export const memberEntryPath = (laboratoryId: string, personId: string) =>
  COLLECTIONS.laboratoryMembers.docPath(laboratoryId, personId);

/** Writes a member entry of a laboratory, as a coordinator or an import would. */
export async function memberEntry(
  laboratoryId: string,
  personId: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  await adminDb.doc(memberEntryPath(laboratoryId, personId)).set({
    ...standard(),
    laboratoryId,
    personId,
    role: "member",
    isAuthorisedRepresentative: false,
    earlierPeriods: [],
    status: "proposed",
    ...fields,
  });
}

export const membershipPath = (replicationId: string, personId: string, role: string) =>
  COLLECTIONS.replicationMemberships.docPath(replicationId, replicationMembershipId(personId, role));

/** Writes a membership of a replication, as a lead or an import would. */
export async function membership(
  replicationId: string,
  personId: string,
  role: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  await adminDb.doc(membershipPath(replicationId, personId, role)).set({
    ...standard(),
    replicationId,
    personId,
    role,
    isCurrent: true,
    earlierPeriods: [],
    reviewStatus: "needsReview",
    ...fields,
  });
}

// ----- What was written -----

export async function accessOf(uid: string): Promise<AccessDocument> {
  return accessDocSchema.parse((await adminDb.doc(COLLECTIONS.access.docPath(uid)).get()).data());
}

export const dataOf = async (path: string) => (await adminDb.doc(path).get()).data();

/** The audit entries of an action, optionally about one record. Every entry is checked against its schema. */
export async function auditOf(action: AuditEvent["action"], entityId?: string): Promise<AuditEvent[]> {
  const found = await adminDb.collection("auditEvents").where("action", "==", action).get();
  return found.docs
    .map((document) => auditEventSchema.parse(document.data()))
    .filter((entry) => entityId === undefined || entry.entityId === entityId);
}

/** The audit entries about one document path, whoever wrote them. */
export async function auditOfPath(documentPath: string): Promise<AuditEvent[]> {
  const found = await adminDb.collection("auditEvents").where("documentPath", "==", documentPath).get();
  return found.docs.map((document) => auditEventSchema.parse(document.data()));
}

export async function notificationsOf(uid: string): Promise<UserNotificationDoc[]> {
  const found = await adminDb.collection(COLLECTIONS.userNotifications.collectionPath(uid)).get();
  return found.docs.map((document) => userNotificationDocSchema.parse(document.data()));
}
