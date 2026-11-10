// Live documents and live queries. Every hook here reads from one shared subscription cache,
// and every registry entry of @eegml/shared is served by the same two hooks: there is no hook
// per collection.
import type { CollectionKey, DocPathIds, ListableCollectionKey } from "@eegml/shared";
import { type DocumentReference, type FirestoreError, onSnapshot, type SnapshotMetadata } from "firebase/firestore";
import { DataShapeError, type RecordOf } from "./converter";
import { db } from "./firebase";
import { type LiveQuery, liveQueryKey } from "./query-spec";
import { documentReference, queryReference } from "./refs";
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
    // The converter rejects documents that do not match their schema. The listener goes on,
    // so a document that is put right shows up without anyone asking again.
    publish({ status: "error", error: toLiveError(error) });
  }
}

/**
 * A document that stays up to date. `data` is null when the document does not exist.
 * Pass null to watch nothing. Every component that watches the same document shares one listener.
 *
 * When the server ends the listener, for example because it refused the read, the cache opens
 * a new one a few times before it reports the failure (see subscription-cache.ts).
 */
function useLiveDoc<T>(reference: DocumentReference<T> | null): Live<T | null> {
  return useSubscription<T | null>(cache, reference ? `doc:${reference.path}` : null, (publish, fail) => {
    if (!reference) return () => {};
    return onSnapshot(
      reference,
      { includeMetadataChanges: true },
      (snapshot) => publishSnapshot(publish, snapshot.metadata, () => (snapshot.exists() ? snapshot.data() : null)),
      // Firestore has removed the listener by the time it reports an error.
      (error) => fail(toLiveError(error)),
    );
  });
}

/**
 * One document of a registry entry, live and validated against the schema of the entry. `ids`
 * are the identifiers that the path of the entry takes, in order. Pass null to watch nothing.
 * `data` is null when the document does not exist.
 */
export function useLiveDocument<K extends CollectionKey>(key: K, ids: DocPathIds<K> | null): Live<RecordOf<K> | null> {
  return useLiveDoc(ids === null ? null : documentReference(db, key, ...ids));
}

/**
 * The documents that a query describes, live and validated. Pass null to watch nothing.
 * Components that describe the same query share one listener. One document that does not match
 * its schema makes the whole result an error, which names that document.
 */
export function useLiveQuery<K extends ListableCollectionKey>(
  description: LiveQuery<K> | null,
): Live<readonly RecordOf<K>[]> {
  return useSubscription<readonly RecordOf<K>[]>(
    cache,
    description ? liveQueryKey(description) : null,
    (publish, fail) => {
      if (!description) return () => {};
      return onSnapshot(
        queryReference(db, description),
        { includeMetadataChanges: true },
        (snapshot) =>
          publishSnapshot(publish, snapshot.metadata, () => snapshot.docs.map((document) => document.data())),
        (error) => fail(toLiveError(error)),
      );
    },
  );
}

/** Opens anew every listener that has given up after repeated failures. For "Try again" buttons. */
export function retryFailedLiveData(): void {
  cache.retryFailed();
}

/** Stops every listener for good and forgets every cached value. See `discardLocalData`. */
export function closeLiveData(): void {
  cache.close();
}

/** Number of Firestore listeners the cache holds. Exposed for tests. */
export function liveListenerCount(): number {
  return cache.size;
}
