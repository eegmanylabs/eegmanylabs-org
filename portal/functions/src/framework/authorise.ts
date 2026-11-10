// What a handler asks before it acts. Authorisation is decided from the caller's access
// document, which the handler reads itself, with `can` of the shared package: the same document
// and the same decision as the security rules.
import {
  accessDocSchema,
  type Capability,
  type CapabilityScope,
  COLLECTIONS,
  can,
  emptyAccess,
  normaliseEmail,
  parseStoredDocument,
  type ResolvedAccess,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import type { AuthenticatedContext } from "./context";
import { AppError, EMAIL_NOT_VERIFIED_MESSAGE, NOT_ALLOWED_MESSAGE, SECOND_FACTOR_REQUIRED_MESSAGE } from "./errors";

/**
 * Reads the access document of an account. An account that has none has been granted nothing.
 * A stored document that does not fit its schema is a fault, and the call fails: nothing is
 * ever authorised from a document that cannot be read in full.
 */
export async function readAccessDocument(
  db: Firestore,
  uid: string,
  transaction?: Transaction,
): Promise<ResolvedAccess> {
  const reference = db.doc(COLLECTIONS.access.docPath(uid));
  const snapshot = transaction === undefined ? await reference.get() : await transaction.get(reference);
  if (!snapshot.exists) return emptyAccess();
  const parsed = parseStoredDocument(accessDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

/** The caller's verified email address in canonical form. Refuses a caller who has none. */
export function requireVerifiedEmail(context: AuthenticatedContext): string {
  if (context.verifiedEmail === null) {
    throw new AppError("failed-precondition", EMAIL_NOT_VERIFIED_MESSAGE, "emailNotVerified");
  }
  return normaliseEmail(context.verifiedEmail);
}

/** Whether the session presents the second factor wherever the access document requires one. */
export function secondFactorSatisfied(
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: Pick<ResolvedAccess, "secondFactorRequired">,
): boolean {
  return !access.secondFactorRequired || context.secondFactorVerified;
}

/**
 * Refuses a caller whose access document requires a second factor that the session does not
 * present. An account that has yet to enrol a factor is refused here as well, with the same
 * message, because its sign-in token cannot name one.
 */
export function requireSecondFactor(
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: Pick<ResolvedAccess, "secondFactorRequired">,
): void {
  if (!secondFactorSatisfied(context, access)) {
    throw new AppError("failed-precondition", SECOND_FACTOR_REQUIRED_MESSAGE, "secondFactorRequired");
  }
}

/**
 * Refuses a caller who does not hold a capability in a scope, or who holds it and has not
 * presented the second factor that the access document requires.
 */
export function requireCapability(
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: ResolvedAccess,
  capability: Capability,
  scope: Exclude<CapabilityScope, "anywhere">,
): void {
  requireSecondFactor(context, access);
  if (!can(access, capability, scope)) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
}
