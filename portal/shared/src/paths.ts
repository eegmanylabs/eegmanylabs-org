// The single place where collection names and document paths are spelled out. Security rules
// (portal/firestore.rules) use the same names and change together with this file.

export const COLLECTIONS = {
  /** One document per Firebase Authentication account. Written by functions only. */
  users: "users",
  /** What an account may do. One document per account, read by security rules. Written by functions only. */
  access: "access",
  /** The audit trail. Written by trusted code only and never readable by clients. */
  auditEvents: "auditEvents",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const paths = {
  user: (uid: string) => `${COLLECTIONS.users}/${segment(uid)}`,
  access: (uid: string) => `${COLLECTIONS.access}/${segment(uid)}`,
  auditEvent: (eventId: string) => `${COLLECTIONS.auditEvents}/${segment(eventId)}`,
} as const;

/** Rejects values that would change the shape of a path when used as a document identifier. */
function segment(value: string): string {
  if (value.length === 0 || value.includes("/") || value === "." || value === "..") {
    throw new RangeError("A document identifier must be a non-empty string without slashes.");
  }
  return value;
}
