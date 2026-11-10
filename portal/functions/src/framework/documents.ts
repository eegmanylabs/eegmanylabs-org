// The standard fields of a document that trusted code writes (docs/DATA_MODEL.md, sections 1
// and 13). Every document of one transaction carries the same instant and names the audit
// entry that the transaction writes, which is how the audit trigger knows that the change is
// recorded already.
import { COLLECTIONS, type CollectionKey, systemActor, userWriteContext, type WriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";

/** Who writes, when, and under which audit entry. */
export interface WriteStamp {
  /** The instant of the whole transaction. */
  readonly at: Date;
  /** A uid, or a system actor string. */
  readonly actor: string;
  readonly writeContext: WriteContext;
}

/** The stamp of a change that a signed-in caller makes through a callable function. */
export function callerStamp(uid: string, at: Date, auditEventId: string | null): WriteStamp {
  return { at, actor: uid, writeContext: userWriteContext(auditEventId) };
}

/**
 * The stamp of a write that trusted code makes in response to an event: one step deeper in the
 * chain of writes than the event, caused by it, and with no audit entry of its own, so that the
 * audit trigger records the write where the collection is audited.
 */
export function reactionStamp(name: string, at: Date, eventId: string, cause: Partial<WriteContext> = {}): WriteStamp {
  return {
    at,
    actor: systemActor(name),
    writeContext: {
      origin: "system",
      depth: (cause.depth ?? 0) + 1,
      correlationId: cause.correlationId ?? eventId,
      causationId: eventId,
      auditEventId: null,
    },
  };
}

/** The standard fields of a new document. */
export function createdFields(key: CollectionKey, stamp: WriteStamp) {
  const now = Timestamp.fromDate(stamp.at);
  return {
    schemaVersion: COLLECTIONS[key].schemaVersion,
    createdAt: now,
    updatedAt: now,
    createdBy: stamp.actor,
    updatedBy: stamp.actor,
    archivedAt: null,
    writeContext: stamp.writeContext,
  };
}

/** The standard fields that every update sets. */
export function touchedFields(stamp: WriteStamp) {
  return { updatedAt: Timestamp.fromDate(stamp.at), updatedBy: stamp.actor, writeContext: stamp.writeContext };
}
