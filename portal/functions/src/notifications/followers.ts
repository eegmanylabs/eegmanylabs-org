// Notifications that follow from what happens to records (requirements R16.1 and R16.4).
//
// | Notification         | Goes to                                                            | When |
// |----------------------|--------------------------------------------------------------------|------|
// | A followed record changed | Every member who follows the page or record with the level `all`, still reads it, and did not make the change | An entry of activity is written for it |
// | A protocol update    | The team of the replication and the coordinators of its participating laboratories | A version of a protocol is approved |
// | A milestone          | The team of the replication                                        | A manuscript reaches in-principle acceptance, acceptance or publication |
//
// Each notification takes its identifier from the event, so a delivery that arrives twice
// writes one notification for each member.
import {
  accessDocSchema,
  activityDocSchema,
  COLLECTIONS,
  type EntityType,
  parseStoredDocument,
  replicationScopeKey,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { accountsListing } from "../recruitment/inactivity";
import { notifyAll } from "./notify";

const FOLLOWERS_ACTOR = systemActor("followers");

/** The members of a replication's scope who are in good standing: its leads, its team and anybody else who holds its key. */
async function holdersOfReplication(db: Firestore, replicationId: string): Promise<string[]> {
  const found = await db
    .collection(COLLECTIONS.access.collectionPath())
    .where("scopeKeys", "array-contains", replicationScopeKey(replicationId))
    .limit(500)
    .get();
  return found.docs
    .filter((document) => {
      const parsed = parseStoredDocument(accessDocSchema, document.data());
      return parsed.success && parsed.data.member && !parsed.data.suspended;
    })
    .map((document) => document.id);
}

/** Tells the followers of a record about an entry of its activity. Answers how many were told. */
export async function notifyFollowers(db: Firestore, eventId: string, at: Date): Promise<number> {
  const entry = parseStoredDocument(
    activityDocSchema,
    (await db.doc(COLLECTIONS.activity.docPath(eventId)).get()).data(),
  );
  if (!entry.success) return 0;
  const activity = entry.data;
  const followers = await db
    .collectionGroup(COLLECTIONS.userSubscriptions.collectionId)
    .where("entityType", "==", activity.entityType)
    .where("entityId", "==", activity.entityId)
    .where("level", "==", "all")
    .limit(1_000)
    .get();
  const candidates = followers.docs
    .map((follower) => String(follower.get("uid")))
    .filter((uid) => uid !== activity.actorUid);
  if (candidates.length === 0) return 0;
  // A follower is told only while they still read the record: they hold a key of its audience.
  const accesses = await db.getAll(...candidates.map((uid) => db.doc(COLLECTIONS.access.docPath(uid))));
  const readers = candidates.filter((_, index) => {
    const parsed = parseStoredDocument(accessDocSchema, accesses[index]?.data());
    return (
      parsed.success &&
      parsed.data.member &&
      !parsed.data.suspended &&
      activity.scopeKeys.some((key) => parsed.data.scopeKeys.includes(key))
    );
  });
  if (readers.length === 0) return 0;
  await db.runTransaction(async (transaction) => {
    notifyAll(
      db,
      transaction,
      readers,
      {
        type: "statusChange",
        entityType: activity.entityType,
        entityId: activity.entityId,
        eventId,
        payload: {
          kind: "followedRecordChanged",
          title: activity.title ?? null,
          action: activity.action,
          fields: activity.changedFields.length,
          entityType: activity.entityType,
          entityId: activity.entityId,
        },
      },
      { at, actor: FOLLOWERS_ACTOR, writeContext: systemWriteContext() },
    );
  });
  return readers.length;
}

/**
 * Tells the team of a replication and the coordinators of its laboratories that a version of its
 * protocol was approved, naming the protocol and the version. Whoever approved it is not told of
 * their own approval.
 */
export async function notifyProtocolUpdate(
  db: Firestore,
  input: {
    readonly replicationId: string;
    readonly versionId: string;
    readonly versionLabel: string;
    readonly protocolTitle: string | null;
    /** The uid of the account that approved the version, where a person did. */
    readonly approvedBy: string | null;
  },
  at: Date,
): Promise<number> {
  const participations = await db
    .collection(COLLECTIONS.participations.collectionPath())
    .where("replicationId", "==", input.replicationId)
    .limit(200)
    .get();
  const coordinators = (
    await Promise.all(
      participations.docs
        .filter((document) => document.get("archivedAt") === null)
        .map((document) => accountsListing(db, "coordinatorLaboratoryIds", String(document.get("laboratoryId")))),
    )
  ).flat();
  const recipients = [...new Set([...(await holdersOfReplication(db, input.replicationId)), ...coordinators])].filter(
    (uid) => uid !== input.approvedBy,
  );
  if (recipients.length === 0) return 0;
  await db.runTransaction(async (transaction) => {
    notifyAll(
      db,
      transaction,
      recipients,
      {
        type: "protocolUpdate",
        entityType: "replication",
        entityId: input.replicationId,
        eventId: `protocolUpdate:${input.replicationId}:${input.versionId}`,
        payload: {
          kind: "protocolUpdated",
          title: (input.protocolTitle === null
            ? input.versionLabel
            : `${input.protocolTitle} ${input.versionLabel}`
          ).slice(0, 300),
          replicationId: input.replicationId,
          to: `/replications/${input.replicationId}?tab=protocol`,
        },
      },
      { at, actor: FOLLOWERS_ACTOR, writeContext: systemWriteContext() },
    );
  });
  return recipients.length;
}

/** The statuses of a manuscript that are milestones of its replication. */
export const MILESTONE_STATUSES = ["inPrincipleAcceptance", "accepted", "published"] as const;

/** Tells the team of a replication that one of its manuscripts reached a milestone. */
export async function notifyMilestone(
  db: Firestore,
  input: {
    readonly manuscriptId: string;
    readonly replicationId: string;
    readonly status: (typeof MILESTONE_STATUSES)[number];
    readonly title: string;
  },
  at: Date,
): Promise<number> {
  const recipients = await holdersOfReplication(db, input.replicationId);
  if (recipients.length === 0) return 0;
  const entityType: EntityType = "manuscript";
  await db.runTransaction(async (transaction) => {
    notifyAll(
      db,
      transaction,
      recipients,
      {
        type: "milestone",
        entityType,
        entityId: input.manuscriptId,
        eventId: `milestone:${input.manuscriptId}:${input.status}`,
        payload: {
          kind: "manuscriptMilestone",
          title: input.title.slice(0, 200),
          status: input.status,
          replicationId: input.replicationId,
          to: `/replications/${input.replicationId}?tab=outputs`,
        },
      },
      { at, actor: FOLLOWERS_ACTOR, writeContext: systemWriteContext() },
    );
  });
  return recipients.length;
}
