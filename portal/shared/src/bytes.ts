import { z } from "./zod";

/**
 * A stored byte string, such as a Yjs update or snapshot. The Admin SDK reads one as a `Buffer`,
 * which is a `Uint8Array`, and the web SDK as a `Bytes` object. Both satisfy this type, so
 * schemas in this package can describe binary fields without importing either SDK.
 */
export type FirestoreBytes = Uint8Array | { toUint8Array(): Uint8Array };

export function isFirestoreBytes(value: unknown): value is FirestoreBytes {
  if (value instanceof Uint8Array) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toUint8Array?: unknown }).toUint8Array === "function"
  );
}

export const bytesSchema = z.custom<FirestoreBytes>(isFirestoreBytes, {
  error: "Expected a Firestore byte string",
});
