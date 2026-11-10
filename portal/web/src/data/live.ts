// Live documents. Every hook here reads from one shared subscription cache.
//
// A hook for live queries belongs in this file as well, on the same cache, with a key that
// describes the query completely. It is added together with the first collection that the
// security rules let a browser list, so that it can be tested against those rules.
import { type DocumentReference, type FirestoreError, onSnapshot, type SnapshotMetadata } from "firebase/firestore";
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
export function useLiveDoc<T>(reference: DocumentReference<T> | null): Live<T | null> {
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
