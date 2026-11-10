import {
  ACCESS_SCHEMA_VERSION,
  type AccessDoc,
  accessDocSchema,
  normaliseEmail,
  paths,
  sessionStartContract,
  USER_SCHEMA_VERSION,
  type UserDoc,
  userDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { AppError, defineCallable, writeAudit } from "../framework";

/**
 * Called by the web application once after each sign-in.
 *
 * It records the account in `users/{uid}`, makes sure `access/{uid}` exists, and reports what
 * the account is linked to. A new access document always starts with no membership and no
 * linked person. An existing access document is never changed here: granting membership and
 * linking a person belong to the claim flow.
 */
export const sessionStart = defineCallable(sessionStartContract, {
  handler: async (_input, context) => {
    const { uid, db } = context;
    if (context.verifiedEmail === null) {
      throw new AppError("failed-precondition", "A verified email address is needed to use the portal.");
    }
    const emailLower = normaliseEmail(context.verifiedEmail);
    const userReference = db.doc(paths.user(uid));
    const accessReference = db.doc(paths.access(uid));

    return db.runTransaction(async (transaction) => {
      const [userSnapshot, accessSnapshot] = await Promise.all([
        transaction.get(userReference),
        transaction.get(accessReference),
      ]);
      const now = Timestamp.fromDate(context.clock.now());

      if (userSnapshot.exists) {
        // Status is left alone: signing in does not undo a suspension.
        const changes: Partial<UserDoc> = { emailLower, lastSeenAt: now };
        if (context.providerDisplayName !== null) changes.displayName = context.providerDisplayName;
        transaction.update(userReference, changes);
      } else {
        const user: UserDoc = userDocSchema.parse({
          schemaVersion: USER_SCHEMA_VERSION,
          emailLower,
          displayName: context.providerDisplayName,
          status: "active",
          createdAt: now,
          lastSeenAt: now,
          dataOrigin: "live",
        });
        transaction.create(userReference, user);
      }

      if (accessSnapshot.exists) {
        const access = accessDocSchema.parse(accessSnapshot.data());
        return { member: access.member, personId: access.personId };
      }

      const access: AccessDoc = accessDocSchema.parse({
        schemaVersion: ACCESS_SCHEMA_VERSION,
        member: false,
        personId: null,
        createdAt: now,
        updatedAt: now,
        dataOrigin: "live",
      });
      transaction.create(accessReference, access);
      writeAudit(
        transaction,
        {
          type: "account.created",
          actor: { kind: "user", uid },
          targetPath: accessReference.path,
          occurredAt: context.clock.now(),
          idempotencyKey: `account.created:${uid}`,
        },
        db,
      );
      return { member: access.member, personId: access.personId };
    });
  },
});
