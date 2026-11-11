import {
  COLLECTIONS,
  can,
  commentMentionUids,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  postProgressUpdateContract,
  progressUpdateDocSchema,
  replicationScopeKey,
  sessionScopeKeys,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  secondFactorSatisfied,
  writeAudit,
} from "../framework";
import { notifyAll } from "../notifications/notify";

const NOT_FOUND_MESSAGE = "This record does not exist.";

/** How long an author waits between two updates on one record. */
const POSTING_INTERVAL_MILLIS = 60_000;

/**
 * Posts a dated progress update to the feed of a replication, a laboratory or a member.
 * Capability: for a replication its team and the holders of `replications.manage` there; for a
 * laboratory its members and the holders of `labs.manage` there; for a member the member's own
 * account and the holders of `people.manage`. The mentions named must be mentions in the text.
 * The update, its audit entry and the notifications are written in one transaction: those who
 * follow the record are told of the update, and the members it mentions of the mention, apart
 * from the author. An update never changes, and one posted pinned stands at the top of the
 * record until a later one is pinned. An author posts on one record at most once a minute, and
 * only active members of the portal are told of a mention.
 */
export const postProgressUpdate = defineCallable(postProgressUpdateContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const mentioned = commentMentionUids(input.body);
    if (input.mentionUids.some((mention) => !mentioned.includes(mention))) {
      throw new AppError("invalid-argument", "The mentions named are not those in the text.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const held = sessionScopeKeys(access, { secondFactorVerified: context.secondFactorVerified });
      const holds = (...args: Parameters<typeof can>) => secondFactorSatisfied(context, access) && can(...args);
      let scope: { replicationId: string | null; laboratoryId: string | null; scopeKeys: string[] };
      let title: string;
      switch (input.entityType) {
        case "replication": {
          const record = await transaction.get(db.doc(COLLECTIONS.replications.docPath(input.entityId)));
          if (!record.exists) throw new AppError("not-found", NOT_FOUND_MESSAGE);
          const key = replicationScopeKey(input.entityId);
          if (!held.includes(key) && !holds(access, "replications.manage", { replicationId: input.entityId })) {
            throw new AppError("permission-denied", "Only the team of this replication posts its updates.");
          }
          scope = { replicationId: input.entityId, laboratoryId: null, scopeKeys: [key, MEMBERS_SCOPE_KEY] };
          title = input.entityId;
          break;
        }
        case "laboratory": {
          const record = await transaction.get(db.doc(COLLECTIONS.laboratories.docPath(input.entityId)));
          if (!record.exists) throw new AppError("not-found", NOT_FOUND_MESSAGE);
          const key = laboratoryScopeKey(input.entityId);
          if (!held.includes(key) && !holds(access, "labs.manage", { laboratoryId: input.entityId })) {
            throw new AppError("permission-denied", "Only the members of this laboratory post its updates.");
          }
          scope = { replicationId: null, laboratoryId: input.entityId, scopeKeys: [key, MEMBERS_SCOPE_KEY] };
          title = String(record.get("name") ?? input.entityId);
          break;
        }
        case "person": {
          const record = await transaction.get(db.doc(COLLECTIONS.persons.docPath(input.entityId)));
          if (!record.exists) throw new AppError("not-found", NOT_FOUND_MESSAGE);
          if (access.personId !== input.entityId && !holds(access, "people.manage", "programme")) {
            throw new AppError("permission-denied", "Only the member posts updates on their own record.");
          }
          scope = { replicationId: null, laboratoryId: null, scopeKeys: [MEMBERS_SCOPE_KEY] };
          title = String(record.get("displayName") ?? input.entityId);
          break;
        }
      }
      const latest = await transaction.get(
        db
          .collection(COLLECTIONS.progressUpdates.collectionPath())
          .where("authorUid", "==", uid)
          .where("entityId", "==", input.entityId)
          .where("createdAt", ">", Timestamp.fromMillis(at.getTime() - POSTING_INTERVAL_MILLIS))
          .limit(1),
      );
      if (!latest.empty) {
        throw new AppError(
          "resource-exhausted",
          "You posted an update here less than a minute ago. Wait a moment before you post another.",
        );
      }
      // A mention tells an active member, and nobody else: not an account that is unknown or suspended.
      const mentionAccess = await Promise.all(
        input.mentionUids.map((mention) => transaction.get(db.doc(COLLECTIONS.access.docPath(mention)))),
      );
      const reachable = input.mentionUids.filter((_, index) => {
        const found = mentionAccess[index];
        return found?.exists === true && found.get("member") === true && found.get("suspended") !== true;
      });
      const followers = await transaction.get(
        db
          .collectionGroup(COLLECTIONS.userSubscriptions.collectionId)
          .where("entityType", "==", input.entityType)
          .where("entityId", "==", input.entityId)
          .where("level", "==", "all")
          .limit(1_000),
      );
      const followerUids = followers.docs.map((follower) => String(follower.get("uid")));

      const reference = db.collection(COLLECTIONS.progressUpdates.collectionPath()).doc();
      const auditEventId = writeAudit(
        transaction,
        {
          action: "progressUpdate.posted",
          actor: { kind: "user", uid },
          entityType: input.entityType,
          entityId: input.entityId,
          changes: [
            { field: "progressUpdateId", after: reference.id },
            { field: "pinned", after: input.pinned },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      transaction.create(
        reference,
        progressUpdateDocSchema.parse({
          schemaVersion: COLLECTIONS.progressUpdates.schemaVersion,
          createdAt: Timestamp.fromDate(at),
          createdBy: uid,
          writeContext: stamp.writeContext,
          entityType: input.entityType,
          entityId: input.entityId,
          authorUid: uid,
          body: input.body,
          mentionUids: input.mentionUids,
          pinned: input.pinned,
          ...scope,
        }),
      );
      const payload = {
        kind: "progressUpdatePosted",
        title,
        updateId: reference.id,
        actorUid: uid,
        pinned: input.pinned,
      };
      notifyAll(
        db,
        transaction,
        reachable.filter((mention) => mention !== uid),
        { type: "mention", entityType: input.entityType, entityId: input.entityId, eventId: auditEventId, payload },
        stamp,
      );
      notifyAll(
        db,
        transaction,
        followerUids.filter((follower) => follower !== uid && !input.mentionUids.includes(follower)),
        {
          type: "progressUpdate",
          entityType: input.entityType,
          entityId: input.entityId,
          eventId: auditEventId,
          payload,
        },
        stamp,
      );
      return { updateId: reference.id };
    });
  },
});
