// Live documents and live queries. Both hooks read from one shared subscription cache.
import {
  type DocumentReference,
  type FirestoreError,
  onSnapshot,
  type Query,
  type SnapshotMetadata,
} from "firebase/firestore";
import { DataShapeError } from "./converter";
import { type Live, type LiveError, type Publish, SubscriptionCache } from "./subscription-cache";
import { useSubscription } from "./use-subscription";

const cache = new SubscriptionCache();

function toLiveError(error: unknown): LiveError {
  if (error instanceof DataShapeError) return { code: error.code, message: error.message };
  const code = (error as Partial<FirestoreError>).code;
  return {
    code: typeof code === "string" ? code : "unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

function publishSnapshot<T>(publish: Publish<T>, metadata: SnapshotMetadata, read: () => T): void {
  try {
    publish({
      status: "ready",
      data: read(),
      fromCache: metadata.fromCache,
      hasPendingWrites: metadata.hasPendingWrites,
    });
  } catch (error) {
    // The converter rejects documents that do not match their schema.
    publish({ status: "error", error: toLiveError(error) });
  }
}

/**
 * A document that stays up to date. `data` is null when the document does not exist.
 * Pass null to watch nothing. Every component that watches the same document shares one listener.
 */
export function useLiveDoc<T>(reference: DocumentReference<T> | null): Live<T | null> {
  return useSubscription<T | null>(cache, reference ? `doc:${reference.path}` : null, (publish) => {
    if (!reference) return () => {};
    return onSnapshot(
      reference,
      { includeMetadataChanges: true },
      (snapshot) => publishSnapshot(publish, snapshot.metadata, () => (snapshot.exists() ? snapshot.data() : null)),
      (error) => publish({ status: "error", error: toLiveError(error) }),
    );
  });
}

/** A query with the key under which its result is shared. Create one with `namedQuery`. */
export interface NamedQuery<T> {
  readonly key: string;
  readonly query: Query<T>;
}

/**
 * Gives a query the key that identifies it in the subscription cache. Firestore queries have
 * no stable identity of their own, so the key must describe the query completely: the same
 * key must always mean the same collection, filters and order.
 */
export function namedQuery<T>(key: string, query: Query<T>): NamedQuery<T> {
  return { key, query };
}

/**
 * The result of a query that stays up to date. Pass null to watch nothing.
 * Every component that uses a query with the same key shares one listener.
 */
export function useLiveQuery<T>(named: NamedQuery<T> | null): Live<readonly T[]> {
  return useSubscription<readonly T[]>(cache, named ? `query:${named.key}` : null, (publish) => {
    if (!named) return () => {};
    return onSnapshot(
      named.query,
      { includeMetadataChanges: true },
      (snapshot) => publishSnapshot(publish, snapshot.metadata, () => snapshot.docs.map((document) => document.data())),
      (error) => publish({ status: "error", error: toLiveError(error) }),
    );
  });
}

/** Stops every listener and forgets every cached value. Called on sign-out. */
export function resetLiveData(): void {
  cache.reset();
}

/** Number of open Firestore listeners. Exposed for tests. */
export function liveListenerCount(): number {
  return cache.size;
}
