// Values that the unit tests of the scientific workflows share. Everything here is synthetic.
import type { FirestoreTimestamp } from "../timestamp";

/** A timestamp at an ISO instant, as both SDKs present one. */
export function at(iso: string): FirestoreTimestamp {
  const date = new Date(iso);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => new Date(date),
    toMillis: () => date.getTime(),
  };
}

/** The standard fields of an append-only document created at an instant. */
export const appended = (iso: string) => ({
  schemaVersion: 1 as const,
  createdAt: at(iso),
  createdBy: "uid-synthetic",
  writeContext: { origin: "user" as const, depth: 0, correlationId: null, causationId: null, auditEventId: null },
});

/** The standard fields of a document created and last changed at an instant. */
export const stamped = (iso: string) => ({
  ...appended(iso),
  updatedAt: at(iso),
  updatedBy: "uid-synthetic",
  archivedAt: null,
});
