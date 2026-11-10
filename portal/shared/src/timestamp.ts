import { z } from "./zod";

/**
 * The part of a Firestore timestamp that both SDKs share. The web SDK and the Admin SDK each
 * have their own `Timestamp` class; both satisfy this interface, so schemas in this package can
 * describe stored documents without importing either SDK.
 */
export interface FirestoreTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
  toMillis(): number;
}

export function isFirestoreTimestamp(value: unknown): value is FirestoreTimestamp {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof FirestoreTimestamp, unknown>>;
  return (
    typeof candidate.seconds === "number" &&
    typeof candidate.nanoseconds === "number" &&
    typeof candidate.toDate === "function" &&
    typeof candidate.toMillis === "function"
  );
}

export const timestampSchema = z.custom<FirestoreTimestamp>(isFirestoreTimestamp, {
  error: "Expected a Firestore timestamp",
});
