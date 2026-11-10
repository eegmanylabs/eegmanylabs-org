import {
  type AccessDocument,
  accessDocSchema,
  COLLECTIONS,
  emptyAccess,
  normaliseEmail,
  parseStoredDocument,
  sessionStartContract,
  type UserDoc,
  userDocSchema,
  userWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { ACCOUNT_SUSPENDED_MESSAGE, AppError, defineCallable, withheldChanges, writeAudit } from "../framework";

/** A returning account's `lastSeenAt` is written again only when the stored value is older than this. */
export const LAST_SEEN_RESOLUTION_MS = 15 * 60 * 1000;

/** The fields of `users/{uid}` that a later call may change. */
const returningUserChangesSchema = userDocSchema
  .pick({
    emailLower: true,
    displayName: true,
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

/**
 * Called by the web application each time it starts with a signed-in account, so once for
 * every page load and once in every tab.
 *
 * The first call for an account registers it: it creates `users/{uid}` and `access/{uid}` and
 * records one audit entry. A new access document always starts with no membership and no
 * linked person. An existing access document is never changed here: granting membership and
 * linking a person belong to the claim flow.
 *
 * A later call reports what the account is linked to. It writes only when something has
 * changed: the address, the name the account gives itself, or a `lastSeenAt` that is more
 * than fifteen minutes old. A page that is reloaded many times therefore costs reads only.
 *
 * A suspended account is refused before this handler runs, by `defineCallable`, which reads
 * `access/{uid}`. The handler refuses as well when the profile says the account is suspended.
 */
export const sessionStart = defineCallable(sessionStartContract, {
  handler: async (_input, context) => {
    const { uid, db } = context;
    if (context.verifiedEmail === null) {
      throw new AppError("failed-precondition", "A verified email address is needed to use the portal.");
    }
    const emailLower = normaliseEmail(context.verifiedEmail);
    const displayName = context.selfAssertedName;
    const userReference = db.doc(COLLECTIONS.users.docPath(uid));
    const accessReference = db.doc(COLLECTIONS.access.docPath(uid));
    // One instant for everything this call writes, the audit entry included.
    const at = context.clock.now();
    const now = Timestamp.fromDate(at);

    return db.runTransaction(async (transaction) => {
      const [userSnapshot, accessSnapshot] = await Promise.all([
        transaction.get(userReference),
        transaction.get(accessReference),
      ]);
      const existingAccess = accessSnapshot.exists ? readAccess(accessSnapshot.data()) : null;
      if (userSnapshot.get("status") === "suspended" || existingAccess?.suspended === true) {
        throw new AppError("permission-denied", ACCOUNT_SUSPENDED_MESSAGE);
      }

      // The audit entry records the registration, which is the creation of the access document.
      const auditEventId =
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

      if (userSnapshot.exists) {
        const changes: Partial<UserDoc> = {};
        if (userSnapshot.get("emailLower") !== emailLower) changes.emailLower = emailLower;
        if (displayName !== null && userSnapshot.get("displayName") !== displayName) changes.displayName = displayName;
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
              writeContext: userWriteContext(auditEventId),
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
          mfaEnrolled: false,
          lastSeenAt: now,
          dataOrigin: "live",
        });
        transaction.create(userReference, user);
      }

      if (existingAccess !== null) return { member: existingAccess.member, personId: existingAccess.personId };

      const access: AccessDocument = accessDocSchema.parse({
        schemaVersion: COLLECTIONS.access.schemaVersion,
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
        updatedBy: uid,
        archivedAt: null,
        writeContext: userWriteContext(auditEventId),
        ...emptyAccess(),
      });
      transaction.create(accessReference, access);
      return { member: access.member, personId: access.personId };
    });
  },
});
