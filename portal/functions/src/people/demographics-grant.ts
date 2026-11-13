// The named grant that every reader of special-category data needs, programme administrators
// included (docs/SECURITY.md, section 2).
import { capabilityGrantDocSchema, parseStoredDocument } from "@eegml/shared";
import type { DocumentSnapshot } from "firebase-admin/firestore";

/** Whether a named grant of `demographics.read` to the caller is in force at an instant. */
export function grantInForce(snapshot: DocumentSnapshot | undefined, at: Date): boolean {
  const grant = snapshot?.exists ? parseStoredDocument(capabilityGrantDocSchema, snapshot.data()) : null;
  return (
    grant?.success === true &&
    grant.data.revokedAt === null &&
    grant.data.expiresAt !== null &&
    grant.data.expiresAt.toMillis() > at.getTime()
  );
}
