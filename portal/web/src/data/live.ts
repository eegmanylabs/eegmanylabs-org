// Live documents and live queries. Every hook here reads from one shared subscription cache,
// and every registry entry of @eegml/shared is served by the same two hooks: there is no hook
// per collection.
import type { CollectionKey, DocPathIds, ListableCollectionKey } from "@eegml/shared";
import {
  type DocumentReference,
  disableNetwork,
  enableNetwork,
  type FirestoreError,
  onSnapshot,
  type SnapshotMetadata,
} from "firebase/firestore";
import { useSyncExternalStore } from "react";
import { DataShapeError, type RecordOf } from "./converter";
import { db } from "./firebase";
import { type PagedItems, startPagedSubscription } from "./paged";
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

/** The registry entries whose documents sit at the top level and are named by one identifier. */
type TopLevelKey = { [K in CollectionKey]: DocPathIds<K> extends readonly [string] ? K : never }[CollectionKey];

/**
 * The named documents of a top-level registry entry, live and validated, by identifier. A
 * document that does not exist is absent from the map. The result is ready once every document
 * has answered, so a page that shows a few names reads those few documents and never the whole
 * directory. Pass null, or no identifier, to watch nothing.
 */
export function useLiveDocuments<K extends TopLevelKey>(
  key: K,
  ids: readonly string[] | null,
): Live<ReadonlyMap<string, RecordOf<K>>> {
  const wanted = ids === null ? [] : [...new Set(ids)].sort();
  return useSubscription<ReadonlyMap<string, RecordOf<K>>>(
    cache,
    wanted.length === 0 ? null : `docs:${key}:${JSON.stringify(wanted)}`,
    (publish, fail) => {
      const answers = new Map<string, { data: RecordOf<K> | null; fromCache: boolean; pending: boolean }>();
      const stops = wanted.map((id) =>
        onSnapshot(
          documentReference(db, key, ...([id] as unknown as DocPathIds<K>)),
          { includeMetadataChanges: true },
          (snapshot) => {
            try {
              answers.set(id, {
                data: snapshot.exists() ? snapshot.data() : null,
                fromCache: snapshot.metadata.fromCache,
                pending: snapshot.metadata.hasPendingWrites,
              });
            } catch (error) {
              publish({ status: "error", error: toLiveError(error) });
              return;
            }
            if (answers.size < wanted.length) return;
            const found = new Map<string, RecordOf<K>>();
            for (const [answered, answer] of answers) if (answer.data !== null) found.set(answered, answer.data);
            const all = [...answers.values()];
            publish({
              status: "ready",
              data: found,
              fromCache: all.some((answer) => answer.fromCache),
              hasPendingWrites: all.some((answer) => answer.pending),
            });
          },
          (error) => fail(toLiveError(error)),
        ),
      );
      return () => {
        for (const stop of stops) stop();
      };
    },
  );
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

/** The most pages `useLiveCollection` reads, each of the query's limit: ten thousand documents at the most. */
export const LIVE_COLLECTION_MAX_PAGES = 10;

/**
 * Every document that a query describes, read in pages of its limit, each page after the last
 * document of the page before, so that a collection longer than one query may read is read
 * whole. `truncated` says that the last page that may be opened came back full. Only for a
 * query of one collection without `orderBy`. Pass null to watch nothing.
 */
export function useLiveCollection<K extends ListableCollectionKey>(
  description: LiveQuery<K> | null,
): Live<PagedItems<RecordOf<K>>> {
  return useSubscription<PagedItems<RecordOf<K>>>(
    cache,
    description ? `pages:${liveQueryKey(description)}` : null,
    (publish, fail) => {
      if (!description) return () => {};
      return startPagedSubscription<RecordOf<K>>(
        description.limit,
        LIVE_COLLECTION_MAX_PAGES,
        (startAfterId, onPage, onError) =>
          onSnapshot(
            queryReference(db, startAfterId === undefined ? description : { ...description, startAfterId }),
            { includeMetadataChanges: true },
            (snapshot) => {
              try {
                onPage({
                  items: snapshot.docs.map((document) => document.data()),
                  lastId: snapshot.docs.at(-1)?.id ?? null,
                  fromCache: snapshot.metadata.fromCache,
                  hasPendingWrites: snapshot.metadata.hasPendingWrites,
                });
              } catch (error) {
                publish({ status: "error", error: toLiveError(error) });
              }
            },
            (error) => onError(toLiveError(error)),
          ),
        publish,
        fail,
      );
    },
  );
}

/** Opens anew every listener that has given up after repeated failures. For "Try again" buttons. */
export function retryFailedLiveData(): void {
  cache.retryFailed();
}

const subscribeConnection = (listener: () => void) => cache.subscribeConnection(listener);
const readConnection = () => cache.disconnected;

/**
 * Whether what the page shows comes from the browser's copy because the database cannot be
 * reached, or still waits for the database with only that copy to go on. It is briefly true
 * while a page starts, so a reader waits a few seconds before telling the person.
 */
export function useLiveDataDisconnected(): boolean {
  return useSyncExternalStore(subscribeConnection, readConnection);
}

/**
 * Asks Firestore to connect again at once, instead of at its next attempt, and opens anew the
 * listeners that have given up. For the "Retry" of the connection banner.
 */
export async function reconnectLiveData(): Promise<void> {
  await disableNetwork(db);
  await enableNetwork(db);
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

/** What the views on screen watch now, each as the key of its subscription. Exposed for tests. */
export function liveWatchedKeys(): string[] {
  return cache.watchedKeys;
}
