// The few writes a browser makes directly, under the security rules. Each one sets exactly the
// fields the rules allow, with the caller as its author and the server's time as its instant.
// Everything else that changes state goes through a callable function.
import { COLLECTIONS, correctableFieldSchema, type EntityType, entityRefId, userWriteContext } from "@eegml/shared";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/** Marks a notification of the signed-in account as read. The rules let its owner set `readAt` and nothing else. */
export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.userNotifications.docPath(uid, notificationId)), {
    readAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    writeContext: userWriteContext(),
  });
}

export interface CorrectionRequestInput {
  readonly entityType: EntityType;
  readonly entityId: string;
  /** The field that is wrong, as the schemas spell it. Never a special-category field. */
  readonly field: string;
  /** What the value should be, in the member's words. */
  readonly proposedValue: string;
  readonly message?: string;
}

/**
 * Reports that a detail of a record is wrong. Any approved member may, and an administrator
 * resolves the request. Returns the identifier of the new request, which Firestore generates.
 */
export async function createCorrectionRequest(uid: string, input: CorrectionRequestInput): Promise<string> {
  const field = correctableFieldSchema.parse(input.field);
  const reference = doc(collection(db, COLLECTIONS.correctionRequests.collectionPath()));
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.correctionRequests.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    uid,
    entityType: input.entityType,
    entityId: input.entityId,
    field,
    proposedValue: input.proposedValue,
    ...(input.message === undefined ? {} : { message: input.message }),
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
  });
  return reference.id;
}

/** The standard fields of a change that the signed-in account makes directly. */
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid, writeContext: userWriteContext() });

/** A field value to set, or null to remove an optional field. */
export type FieldPatch = Readonly<Record<string, string | number | boolean | null>>;

const toStored = (patch: FieldPatch) =>
  Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value === null ? deleteField() : value]));

/**
 * Changes descriptive fields of a replication. The security rules accept the change from the
 * leads of the replication, the core team and programme administrators, for the fields they
 * allow, and refuse it from anyone else. The caller validates the values first.
 */
export async function updateReplicationFields(uid: string, studyKey: string, patch: FieldPatch): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.replications.docPath(studyKey)), { ...toStored(patch), ...touched(uid) });
}

/** Changes the profile addresses of the signed-in account's own person, which the rules let a person edit. */
export async function updateOwnPersonLinks(uid: string, personId: string, patch: FieldPatch): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.persons.docPath(personId)), { ...toStored(patch), ...touched(uid) });
}

/** Stars a record for the signed-in account, or removes the star. */
export async function setFavourite(uid: string, entityType: EntityType, entityId: string, on: boolean): Promise<void> {
  const reference = doc(db, COLLECTIONS.userFavourites.docPath(uid, entityRefId(entityType, entityId)));
  if (!on) {
    await deleteDoc(reference);
    return;
  }
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.userFavourites.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    uid,
    entityType,
    entityId,
  });
}

/**
 * Records that the signed-in account has opened a record. A record visited before keeps its
 * document, whose `updatedAt` becomes the time of this visit.
 */
export async function recordRecentVisit(uid: string, entityType: EntityType, entityId: string): Promise<void> {
  const reference = doc(db, COLLECTIONS.userRecents.docPath(uid, entityRefId(entityType, entityId)));
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) {
      transaction.update(reference, touched(uid));
      return;
    }
    transaction.set(reference, {
      schemaVersion: COLLECTIONS.userRecents.schemaVersion,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
      updatedBy: uid,
      archivedAt: null,
      writeContext: userWriteContext(),
      uid,
      entityType,
      entityId,
    });
  });
}
