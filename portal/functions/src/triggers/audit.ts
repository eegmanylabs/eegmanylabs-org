// The audit trigger (decision D-007): one function for every document of the database.
//
// It records the writes that no callable function has recorded: every write to a collection
// that the registry flags as audited and that clients may write. The entry takes the
// identifier of the event, so an event that is delivered twice writes one entry.
import { auditEventSchema, COLLECTIONS, systemActor } from "@eegml/shared";
import { type DocumentData, type Firestore, Timestamp } from "firebase-admin/firestore";
import { logger as functionsLogger } from "firebase-functions";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/firestore";
import { firestore } from "../framework/admin";
import type { Logger } from "../framework/context";
import { documentTrigger } from "../framework/trigger";
import { claimedAuditEntry, type ObservedWrite, planAuditEntry } from "./audit-entry";

/** The gRPC status of a create that found the document in place already. */
const ALREADY_EXISTS = 6;

/**
 * | Outcome       | Meaning                                                                    |
 * |---------------|----------------------------------------------------------------------------|
 * | `recorded`    | The entry was written                                                      |
 * | `duplicate`   | An earlier delivery of the same event wrote the entry                      |
 * | `byFunction`  | A callable function recorded the change in its own transaction             |
 * | `notCovered`  | The path is outside what the trigger records                               |
 */
export type AuditOutcome = "recorded" | "duplicate" | "byFunction" | "notCovered";

/**
 * Records one write. A write that names an audit entry of its own is passed over only once
 * that entry has been found: the function wrote it in the transaction of the change, so it is
 * there by the time the event arrives, and a name without an entry proves nothing.
 */
export async function recordWrite(db: Firestore, write: ObservedWrite, logger: Logger): Promise<AuditOutcome> {
  const planned = planAuditEntry(write);
  if (planned === null) return "notCovered";

  const claimed = claimedAuditEntry(write);
  if (claimed !== null) {
    const entry = await db.doc(COLLECTIONS.auditEvents.docPath(claimed)).get();
    if (entry.exists) return "byFunction";
    logger.warn("a write names an audit entry that does not exist", {
      eventId: write.eventId,
      documentPath: write.documentPath,
    });
  }
  if (planned.actor.mismatch) {
    logger.warn("the writer in a document differs from the principal of its write", {
      eventId: write.eventId,
      documentPath: write.documentPath,
    });
  }

  const { actor } = planned;
  const chain = {
    origin: planned.origin,
    depth: planned.depth,
    correlationId: planned.correlationId,
    causationId: planned.causationId,
  };
  const data = auditEventSchema.parse({
    schemaVersion: COLLECTIONS.auditEvents.schemaVersion,
    createdAt: Timestamp.fromDate(write.time),
    createdBy: actor.actorUid ?? systemActor(actor.actorKind),
    writeContext: { ...chain, auditEventId: write.eventId },
    actorUid: actor.actorUid,
    actorKind: actor.actorKind,
    action: planned.action,
    documentPath: planned.documentPath,
    entityType: planned.entityType,
    entityId: planned.entityId,
    changes: planned.changes,
    context: { ...chain, requestId: null, ipHash: null, userAgent: null },
  }) satisfies DocumentData;

  try {
    await db.doc(COLLECTIONS.auditEvents.docPath(write.eventId)).create(data);
    return "recorded";
  } catch (error) {
    if ((error as { code?: unknown }).code === ALREADY_EXISTS) return "duplicate";
    throw error;
  }
}

const DOCUMENTS_PREFIX = /^projects\/[^/]+\/databases\/[^/]+\/documents\//;

/**
 * The trigger. It matches every document, at any depth, because the collections it covers are
 * read from the registry when an event arrives: a collection that becomes writable for clients
 * is recorded from then on with no change here.
 */
export const auditDocumentWrites = onDocumentWrittenWithAuthContext(documentTrigger("{document=**}"), async (event) => {
  const change = event.data;
  if (change === undefined) return;
  await recordWrite(
    firestore(),
    {
      eventId: event.id,
      documentPath: event.document.replace(DOCUMENTS_PREFIX, ""),
      before: change.before.exists ? (change.before.data() ?? null) : null,
      after: change.after.exists ? (change.after.data() ?? null) : null,
      authType: event.authType,
      authId: event.authId ?? null,
      time: new Date(event.time),
    },
    functionsLogger,
  );
});
