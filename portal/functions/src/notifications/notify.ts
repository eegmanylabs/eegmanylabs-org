// Notifications in the portal: documents beneath the account they are for (docs/DATA_MODEL.md,
// section 3). Functions write them, and the owner may set `readAt` under the security rules.
//
// A notification names the record it is about and carries a short payload. It never carries an
// email address, a special-category value or the note of a reviewer about an account claim.
import {
  accessDocSchema,
  type Capability,
  COLLECTIONS,
  can,
  capabilityField,
  type EntityType,
  type GrantableCapability,
  laboratoryScopeKey,
  type NotificationType,
  notificationId,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  userNotificationDocSchema,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";

/** What a notification tells its reader, beside the record it names. */
export type NotificationPayload = Readonly<Record<string, string | number | boolean | null>>;

export interface NotificationSpec {
  readonly uid: string;
  readonly type: NotificationType;
  readonly entityType: EntityType;
  readonly entityId: string;
  /** The audit entry or the event behind the notification. One notification of a type exists per event and account. */
  readonly eventId: string;
  readonly payload: NotificationPayload;
}

/** Adds a notification to a transaction. A repeat for the same event rewrites the same document. */
export function writeNotification(
  db: Firestore,
  transaction: Transaction,
  spec: NotificationSpec,
  stamp: WriteStamp,
): void {
  const id = notificationId(spec.type, spec.eventId);
  transaction.set(
    db.doc(COLLECTIONS.userNotifications.docPath(spec.uid, id)),
    userNotificationDocSchema.parse({
      ...createdFields("userNotifications", stamp),
      uid: spec.uid,
      type: spec.type,
      entityType: spec.entityType,
      entityId: spec.entityId,
      eventId: spec.eventId,
      payload: spec.payload,
      readAt: null,
      emailedAt: null,
    }),
  );
}

/** Adds the same notification for several accounts. */
export function notifyAll(
  db: Firestore,
  transaction: Transaction,
  uids: readonly string[],
  spec: Omit<NotificationSpec, "uid">,
  stamp: WriteStamp,
): void {
  for (const uid of new Set(uids)) writeNotification(db, transaction, { ...spec, uid }, stamp);
}

/**
 * The accounts that hold a capability for the programme as a whole, or for one laboratory:
 * whoever decides a queue. They are read from the access documents, where the capability is
 * listed only for an account whose second factor is in place. Read inside the transaction,
 * before its first write.
 */
export async function holdersOf(
  db: Firestore,
  transaction: Transaction,
  capability: GrantableCapability,
  scope: { readonly laboratoryId?: string } = {},
): Promise<string[]> {
  const keys = [
    PROGRAMME_SCOPE_KEY,
    ...(scope.laboratoryId === undefined ? [] : [laboratoryScopeKey(scope.laboratoryId)]),
  ];
  const found = await transaction.get(
    db
      .collection(COLLECTIONS.access.collectionPath())
      .where(`capabilities.${capabilityField(capability)}`, "array-contains-any", keys),
  );
  const checked: Capability = capability;
  return found.docs
    .filter((document) => {
      const access = parseStoredDocument(accessDocSchema, document.data());
      return (
        access.success &&
        can(access.data, checked, scope.laboratoryId === undefined ? "programme" : { laboratoryId: scope.laboratoryId })
      );
    })
    .map((document) => document.id)
    .sort();
}
