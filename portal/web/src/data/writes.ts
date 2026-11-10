// The few writes a browser makes directly, under the security rules. Each one sets exactly the
// fields the rules allow, with the caller as its author and the server's time as its instant.
// Everything else that changes state goes through a callable function.
import { COLLECTIONS, correctableFieldSchema, type EntityType, userWriteContext } from "@eegml/shared";
import { collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
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
