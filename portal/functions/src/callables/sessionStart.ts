import {
  type AccessDocument,
  accessDocSchema,
  bootstrapAdminId,
  bootstrapAdminPath,
  bootstrapAdminRecordSchema,
  COLLECTIONS,
  emptyAccess,
  PROGRAMME_KEY,
  parseStoredDocument,
  type ResolvedAccess,
  type RoleAssignmentDoc,
  type RoleScope,
  requireSecondFactorOf,
  resolveAccess,
  sessionStartContract,
  type UserDoc,
  userDocSchema,
  userWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { commitAccess, draftAccess, withAssignment } from "../access/maintain";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  AppError,
  callerStamp,
  defineCallable,
  identityHashKey,
  requireVerifiedEmail,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { assignmentIdOf, nextAssignment, readAssignments } from "../roles/assignments";

/** A returning account's `lastSeenAt` is written again only when the stored value is older than this. */
export const LAST_SEEN_RESOLUTION_MS = 15 * 60 * 1000;

/** The fields of `users/{uid}` that a later call may change. */
const returningUserChangesSchema = userDocSchema
  .pick({
    emailLower: true,
    displayName: true,
    mfaEnrolled: true,
    lastSeenAt: true,
    updatedAt: true,
    updatedBy: true,
    writeContext: true,
  })
  .partial();

/**
 * Reads a stored access document. A field that a newer version of the functions added is left
 * out, and anything else that does not fit the schema is a fault.
 */
function readAccess(data: unknown): AccessDocument {
  const parsed = parseStoredDocument(accessDocSchema, data);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

/** The role that a bootstrap record confers. */
const BOOTSTRAP_ROLE = {
  role: "programme_admin",
  scopeType: "programme",
  scopeId: PROGRAMME_KEY,
} as const satisfies RoleScope;

/**
 * Called by the web application each time it starts with a signed-in account, so once for
 * every page load and once in every tab.
 *
 * The first call for an account registers it: it creates `users/{uid}` and `access/{uid}` and
 * records one audit entry. A new access document starts with no membership and no linked
 * person. Linking a person belongs to the claim flow.
 *
 * A later call reports what the account is linked to. It writes only when something has
 * changed: the address, the name the account gives itself, or a `lastSeenAt` that is more
 * than fifteen minutes old. A page that is reloaded many times therefore costs reads only.
 *
 * Two things can change what the account may do, and both come from the caller's own sign-in
 * token:
 *
 * | The token                                   | The call                                                    |
 * |---------------------------------------------|-------------------------------------------------------------|
 * | Carries a verified address whose keyed hash names an unused bootstrap record | Makes the account a programme administrator, marks the record as used and audits both |
 * | Says that a second factor was verified, while the profile says that none is enrolled | Records the enrolment in the profile |
 *
 * An address that the sign-in provider has not verified never matches a bootstrap record,
 * because such a caller is refused before anything is read. The access document is resolved
 * again in the same transaction whenever one of the two happens.
 *
 * A suspended account is refused before this handler runs, by `defineCallable`, which reads
 * `access/{uid}`. The handler refuses as well when the profile says the account is suspended.
 */
export const sessionStart = defineCallable(sessionStartContract, {
  usesIdentityHashKey: true,
  handler: async (_input, context) => {
    const { uid, db } = context;
    const emailLower = requireVerifiedEmail(context);
    const displayName = context.selfAssertedName;
    const userReference = db.doc(COLLECTIONS.users.docPath(uid));
    const accessReference = db.doc(COLLECTIONS.access.docPath(uid));
    const bootstrapReference = db.doc(bootstrapAdminPath(bootstrapAdminId(emailLower, identityHashKey())));
    // One instant for everything this call writes, the audit entries included.
    const at = context.clock.now();
    const now = Timestamp.fromDate(at);

    return db.runTransaction(async (transaction) => {
      const [userSnapshot, accessSnapshot, bootstrapSnapshot] = await transaction.getAll(
        userReference,
        accessReference,
        bootstrapReference,
      );
      const existingAccess = accessSnapshot?.exists ? readAccess(accessSnapshot.data()) : null;
      if (userSnapshot?.get("status") === "suspended" || existingAccess?.suspended === true) {
        throw new AppError("permission-denied", ACCOUNT_SUSPENDED_MESSAGE);
      }
      const registered = userSnapshot?.exists === true;
      const bootstrapping = bootstrapSnapshot?.exists === true && bootstrapSnapshot.get("usedAt") == null;
      const factorEnrolledNow = context.secondFactorVerified && userSnapshot?.get("mfaEnrolled") !== true;
      const resolving = bootstrapping || (registered && factorEnrolledNow);

      // Everything below the next line writes. The reads of a transaction come first.
      const assignments = bootstrapping
        ? await readAssignments(db, transaction, [assignmentIdOf(uid, BOOTSTRAP_ROLE)])
        : null;
      const draft = resolving && registered ? await draftAccess(db, transaction, uid, at) : null;
      const settings =
        resolving && !registered ? await transaction.get(db.doc(COLLECTIONS.systemSettings.docPath())) : null;

      // The audit entry records the registration, which is the creation of the access document.
      const registrationEventId =
        existingAccess === null
          ? writeAudit(
              transaction,
              {
                action: "account.created",
                actor: { kind: "user", uid },
                entityType: "user",
                entityId: uid,
                // The profile is readable by its owner only, so the entry carries no value.
                changes: withheldChanges(["emailLower", "displayName", "status"]),
                at,
                idempotencyKey: `account.created:${uid}`,
              },
              db,
            )
          : null;
      const bootstrapEventId = bootstrapping
        ? writeAudit(
            transaction,
            {
              action: "admin.bootstrapped",
              actor: { kind: "user", uid },
              entityType: "user",
              entityId: uid,
              changes: [
                { field: "role", after: BOOTSTRAP_ROLE.role },
                { field: "scopeType", after: BOOTSTRAP_ROLE.scopeType },
                { field: "scopeId", after: BOOTSTRAP_ROLE.scopeId },
              ],
              at,
              idempotencyKey: `admin.bootstrapped:${uid}`,
            },
            db,
          )
        : null;
      const factorEventId =
        registered && factorEnrolledNow
          ? writeAudit(
              transaction,
              {
                action: "account.secondFactorChanged",
                actor: { kind: "user", uid },
                entityType: "user",
                entityId: uid,
                changes: withheldChanges(["mfaEnrolled"]),
                at,
              },
              db,
            )
          : null;
      const auditEventId = bootstrapEventId ?? factorEventId ?? registrationEventId;
      const stamp = callerStamp(uid, at, auditEventId);
      const mfaEnrolled = context.secondFactorVerified || userSnapshot?.get("mfaEnrolled") === true;

      let granted: RoleAssignmentDoc | null = null;
      if (bootstrapping && assignments !== null) {
        const stored = assignments.get(assignmentIdOf(uid, BOOTSTRAP_ROLE));
        granted = nextAssignment(stored?.data ?? null, { ...BOOTSTRAP_ROLE, uid, status: "active" }, stamp);
        if (granted !== null && stored !== undefined) transaction.set(stored.reference, granted);
        transaction.update(
          bootstrapReference,
          bootstrapAdminRecordSchema.partial().parse({ usedAt: now, usedBy: uid, ...touchedFields(stamp) }),
        );
      }

      if (registered) {
        const changes: Partial<UserDoc> = {};
        if (userSnapshot.get("emailLower") !== emailLower) changes.emailLower = emailLower;
        if (displayName !== null && userSnapshot.get("displayName") !== displayName) changes.displayName = displayName;
        if (factorEnrolledNow) changes.mfaEnrolled = true;
        const lastSeenAt: unknown = userSnapshot.get("lastSeenAt");
        const stale =
          !(lastSeenAt instanceof Timestamp) || at.getTime() - lastSeenAt.toMillis() >= LAST_SEEN_RESOLUTION_MS;
        if (stale || Object.keys(changes).length > 0) {
          // Validated like a new profile, so a later call can never store what a first call
          // would have refused. Status is left alone: only trusted code changes a suspension.
          transaction.update(
            userReference,
            returningUserChangesSchema.parse({
              ...changes,
              lastSeenAt: now,
              updatedAt: now,
              updatedBy: uid,
              writeContext: userWriteContext(factorEnrolledNow ? auditEventId : registrationEventId),
            }),
          );
        }
      } else {
        const user: UserDoc = userDocSchema.parse({
          schemaVersion: COLLECTIONS.users.schemaVersion,
          createdAt: now,
          updatedAt: now,
          createdBy: uid,
          updatedBy: uid,
          archivedAt: null,
          writeContext: userWriteContext(auditEventId),
          emailLower,
          displayName,
          personId: existingAccess?.personId ?? null,
          status: "active",
          mfaEnrolled,
          lastSeenAt: now,
          dataOrigin: "live",
        });
        transaction.create(userReference, user);
      }

      if (draft !== null) {
        // The account is registered, and its role or its second factor has just changed.
        draft.inputs = {
          ...(granted === null ? draft.inputs : withAssignment(draft.inputs, granted)),
          user: { status: draft.inputs.user.status, mfaEnrolled },
        };
        return reported(commitAccess(db, transaction, draft, stamp).resolved);
      }
      if (existingAccess !== null) return reported(existingAccess);

      // A new account. It has been granted nothing, unless a bootstrap record has just made it
      // a programme administrator.
      const resolved: ResolvedAccess =
        granted === null
          ? emptyAccess()
          : resolveAccess({
              uid,
              now: at,
              user: { status: "active", mfaEnrolled },
              personId: null,
              sessionsValidAfter: null,
              roleAssignments: [granted],
              capabilityGrants: [],
              roleCapabilities: [],
              recordGrants: [],
              groupKeys: [],
              confirmedReplicationIds: [],
              requireSecondFactor: requireSecondFactorOf(settings?.data() ?? null),
            });
      const access: AccessDocument = accessDocSchema.parse({
        schemaVersion: COLLECTIONS.access.schemaVersion,
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
        updatedBy: uid,
        archivedAt: null,
        writeContext: userWriteContext(auditEventId),
        ...resolved,
      });
      transaction.create(accessReference, access);
      return reported(access);
    });
  },
});

const reported = (access: Pick<ResolvedAccess, "member" | "personId">) => ({
  member: access.member,
  personId: access.personId,
});
