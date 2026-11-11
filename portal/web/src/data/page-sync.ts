// The Yjs document of a page, kept in Firestore (D-010). Ported from the editor spike, whose
// tests verified it: there is no server of the portal's own and no WebSocket service. The only
// transports are Firestore writes and Firestore realtime listeners.
//
//   pages/{pageId}                         `contentHead` names the generation of the snapshot that is current
//   pages/{pageId}/content/{generation__n} chunk n of that snapshot, written once, never changed
//   pages/{pageId}/updates/{id}            the updates since, appended by editors, never changed
//
// The design rests on three invariants:
//   I1  Updates and chunks are never changed. A Yjs update may be applied any number of times in
//       any order, so the document is the same however the parts arrive.
//   I2  The local document always holds the generation it believes is current: the listener on
//       the page announces each new generation, and its chunks are then read and applied.
//   I3  A compaction removes exactly the updates whose content its compactor applied, in the
//       transaction that moves the page from the generation it loaded to a later one. An update
//       written meanwhile is not among them and stays, and two compactions cannot both commit.
// The security rules hold the same line: an update is removed only in such a transaction.
import {
  COLLECTIONS,
  type FirestoreBytes,
  PAGE_CHUNK_BYTES,
  PAGE_CHUNKS_PER_COMMIT,
  pageContentChunkId,
  userWriteContext,
} from "@eegml/shared";
import {
  Bytes,
  collection,
  type DocumentSnapshot,
  doc,
  getDocs,
  limit,
  onSnapshot,
  type QueryDocumentSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
  where,
  writeBatch,
} from "firebase/firestore";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { db } from "./firebase";
import { LIVE_QUERY_MAX_LIMIT } from "./query-spec";

export type PageSyncStatus = "loading" | "synced" | "error";

/** What the editor shows about the state of the page: whether every change has reached the server. */
export interface SaveState {
  readonly saving: boolean;
  /** The last write failed, for example because the account may no longer edit the page. */
  readonly failed: boolean;
}

export interface PageSyncOptions {
  readonly pageId: string;
  readonly uid: string;
  readonly doc: Y.Doc;
  /** False for readers and commenters: local changes are never written. */
  readonly canWrite: boolean;
  /** Quiet time after the last change before the merged update is written. */
  readonly debounceMs?: number;
  /** The longest a change waits while the editor keeps typing. */
  readonly maxWaitMs?: number;
  /** Compact once this many updates are in the log. */
  readonly compactAfterUpdates?: number;
  /** Also compact when the page has been quiet this long and holds at least `compactIdleMinUpdates` updates. */
  readonly compactIdleMs?: number;
  readonly compactIdleMinUpdates?: number;
  /** A random delay before a compaction, so that two editors rarely start one together. */
  readonly compactJitterMs?: number;
  /** Called after a quiet spell in which this editor wrote something, for an automatic version. */
  readonly onIdleAfterEdit?: () => void;
}

export interface CompactionResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly merged?: number;
}

/** The settings the spike measured as a good balance of delay and cost (its section 5.5). */
const DEFAULTS = {
  debounceMs: 2_000,
  maxWaitMs: 10_000,
  compactAfterUpdates: 50,
  compactIdleMs: 30_000,
  compactIdleMinUpdates: 5,
  compactJitterMs: 4_000,
} as const;

const bytesOf = (value: FirestoreBytes): Uint8Array => (value instanceof Uint8Array ? value : value.toUint8Array());

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function split(bytes: Uint8Array): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += PAGE_CHUNK_BYTES) {
    parts.push(bytes.subarray(offset, Math.min(bytes.length, offset + PAGE_CHUNK_BYTES)));
  }
  return parts.length === 0 ? [bytes] : parts;
}

/** The document reference of a page and the collections beneath it. */
function referencesOf(pageId: string) {
  return {
    page: doc(db, COLLECTIONS.pages.docPath(pageId)),
    updates: collection(db, COLLECTIONS.pageUpdates.collectionPath(pageId)),
    content: collection(db, COLLECTIONS.pageContent.collectionPath(pageId)),
  };
}

interface Head {
  readonly generation: number;
  readonly chunkCount: number;
}

const headOf = (snapshot: DocumentSnapshot): Head | null => {
  const head = snapshot.get("contentHead") as { generation?: unknown; chunkCount?: unknown } | null | undefined;
  return head != null && typeof head.generation === "number" && typeof head.chunkCount === "number"
    ? { generation: head.generation, chunkCount: head.chunkCount }
    : null;
};

/**
 * Keeps one Yjs document in step with the page in Firestore: it loads the snapshot and the
 * updates, applies the updates of others as they arrive, writes local changes as merged
 * updates, and compacts the log now and then. Firestore queues writes while the browser is
 * offline and sends them when it is back, and the listeners catch up by themselves.
 */
export class PageSync {
  readonly doc: Y.Doc;
  /** Presence of other editors in this tab only: carets are not sent through Firestore. */
  readonly awareness: Awareness;
  status: PageSyncStatus = "loading";
  readonly whenSynced: Promise<void>;

  private readonly options: Required<Omit<PageSyncOptions, "onIdleAfterEdit">> &
    Pick<PageSyncOptions, "onIdleAfterEdit">;
  private readonly refs: ReturnType<typeof referencesOf>;
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly listeners = new Set<(state: SaveState) => void>();
  private resolveSynced: () => void = () => undefined;

  /** The generation that `doc` holds (I2), -1 until the first load. */
  private loadedGeneration = -1;
  private snapshotChain: Promise<void> = Promise.resolve();
  private updatesFollowed = false;

  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt = 0;
  private inFlight = 0;
  private failed = false;
  private wroteSinceIdle = false;

  /** Update documents whose content was handed to Yjs. */
  private readonly applied = new Set<string>();
  /** Update documents the server has confirmed, by identifier, with their group: candidates for compaction. */
  private readonly confirmed = new Map<string, { readonly updateId: string; readonly count: number }>();
  /** The parts of large updates that are not complete yet. */
  private readonly partial = new Map<string, { readonly count: number; readonly parts: Map<number, Uint8Array> }>();
  private compacting = false;
  private compactTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: PageSyncOptions) {
    this.options = { ...DEFAULTS, ...options };
    this.doc = options.doc;
    this.awareness = new Awareness(this.doc);
    this.refs = referencesOf(options.pageId);
    this.whenSynced = new Promise((resolve) => {
      this.resolveSynced = resolve;
    });
    this.doc.on("update", this.onDocUpdate);
    window.addEventListener("pagehide", this.onPageHide);
    this.unsubscribes.push(
      onSnapshot(
        this.refs.page,
        (snapshot) => {
          if (snapshot.metadata.fromCache && !snapshot.exists()) return;
          if (!snapshot.exists()) return;
          const head = headOf(snapshot);
          void this.ensureGeneration(head);
        },
        () => this.fail(),
      ),
    );
  }

  /** Whether a local change has not reached the server yet. */
  get hasUnsavedChanges(): boolean {
    return this.pending.length > 0 || this.inFlight > 0;
  }

  get saveState(): SaveState {
    return { saving: this.hasUnsavedChanges, failed: this.failed };
  }

  /** Calls the listener whenever the save state may have changed. Returns the function that stops it. */
  onSaveState(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private announce(): void {
    for (const listener of this.listeners) listener(this.saveState);
  }

  private fail(): void {
    this.status = "error";
    this.failed = true;
    this.announce();
  }

  /** Brings `doc` up to a generation (I2), then follows the updates. */
  private ensureGeneration(head: Head | null): Promise<void> {
    this.snapshotChain = this.snapshotChain.then(async () => {
      const generation = head?.generation ?? -1;
      if (this.destroyed || (generation <= this.loadedGeneration && this.loadedGeneration >= 0)) return;
      if (head !== null) {
        const chunks = await getDocs(
          query(this.refs.content, where("generation", "==", head.generation), limit(LIVE_QUERY_MAX_LIMIT)),
        );
        // A newer compaction has replaced these chunks already: the listener brings its head.
        if (chunks.size !== head.chunkCount) return;
        const parts = chunks.docs
          .map((chunk) => chunk.data())
          .sort((a, b) => (a.index as number) - (b.index as number))
          .map((chunk) => bytesOf(chunk.snapshot as FirestoreBytes));
        Y.applyUpdate(this.doc, concatenate(parts), this);
      }
      const reload = this.loadedGeneration >= 0;
      this.loadedGeneration = Math.max(generation, 0);
      if (reload) void this.forgetMergedOwnUpdates();
      if (!this.updatesFollowed) this.followUpdates();
    });
    return this.snapshotChain;
  }

  /**
   * Someone else compacted. This editor's own updates are not in its listener, so it asks once
   * which of them are left, and forgets those that were merged.
   */
  private async forgetMergedOwnUpdates(): Promise<void> {
    const own = [...this.confirmed.keys()].filter((id) => !this.applied.has(id));
    if (own.length === 0 || !this.options.canWrite) return;
    try {
      const left = await getDocs(
        query(this.refs.updates, where("clientId", "==", this.doc.clientID), limit(LIVE_QUERY_MAX_LIMIT)),
      );
      if (left.metadata.fromCache) return;
      const alive = new Set(left.docs.map((update) => update.id));
      for (const id of own) if (!alive.has(id)) this.confirmed.delete(id);
    } catch {
      // Offline: the next change of generation asks again.
    }
  }

  private followUpdates(): void {
    this.updatesFollowed = true;
    let first = true;
    // This editor's own updates are left out: their content is in `doc` already.
    this.unsubscribes.push(
      onSnapshot(
        query(this.refs.updates, where("clientId", "!=", this.doc.clientID), limit(LIVE_QUERY_MAX_LIMIT)),
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type === "removed") this.confirmed.delete(change.doc.id);
            else this.receive(change.doc);
          }
          if (first) {
            first = false;
            this.status = "synced";
            this.resolveSynced();
          }
          this.scheduleCompaction(false);
        },
        () => this.fail(),
      ),
    );
  }

  /** Applies one update document. Safe to call twice and in any order (I1). */
  private receive(update: QueryDocumentSnapshot): void {
    const data = update.data();
    const updateId = data.updateId as string;
    const count = data.count as number;
    if (!this.applied.has(update.id)) {
      this.applied.add(update.id);
      const bytes = bytesOf(data.update as FirestoreBytes);
      if (count === 1) {
        Y.applyUpdate(this.doc, bytes, this);
      } else {
        // A large update in several documents is applied once every part is here.
        const group = this.partial.get(updateId) ?? { count, parts: new Map<number, Uint8Array>() };
        group.parts.set(data.index as number, bytes);
        this.partial.set(updateId, group);
        if (group.parts.size === group.count) {
          const ordered = [...group.parts].sort(([a], [b]) => a - b).map(([, part]) => part);
          Y.applyUpdate(this.doc, concatenate(ordered), this);
          this.partial.delete(updateId);
        }
      }
    }
    if (!update.metadata.hasPendingWrites) this.confirmed.set(update.id, { updateId, count });
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.options.canWrite || this.destroyed) return;
    this.pending.push(update);
    this.wroteSinceIdle = true;
    const now = Date.now();
    if (this.firstPendingAt === 0) this.firstPendingAt = now;
    const wait = Math.max(0, Math.min(this.options.debounceMs, this.firstPendingAt + this.options.maxWaitMs - now));
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), wait);
    this.announce();
  };

  private readonly onPageHide = () => {
    void this.flush();
  };

  /** Writes every pending change as one merged update, in several documents only when it is large. */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.firstPendingAt = 0;
    if (this.pending.length === 0 || !this.options.canWrite) return;
    const merged = this.pending.length === 1 ? (this.pending[0] ?? new Uint8Array()) : Y.mergeUpdates(this.pending);
    this.pending = [];
    const parts = split(merged);
    const references = parts.map(() => doc(this.refs.updates));
    const updateId = references[0]?.id ?? doc(this.refs.updates).id;
    this.inFlight += 1;
    this.announce();
    try {
      for (let start = 0; start < parts.length; start += PAGE_CHUNKS_PER_COMMIT) {
        const batch = writeBatch(db);
        parts.slice(start, start + PAGE_CHUNKS_PER_COMMIT).forEach((part, offset) => {
          const reference = references[start + offset];
          if (reference === undefined) return;
          batch.set(reference, {
            schemaVersion: COLLECTIONS.pageUpdates.schemaVersion,
            createdAt: serverTimestamp(),
            createdBy: this.options.uid,
            writeContext: userWriteContext(),
            pageId: this.options.pageId,
            updateId,
            index: start + offset,
            count: parts.length,
            update: Bytes.fromUint8Array(part),
            uid: this.options.uid,
            clientId: this.doc.clientID,
          });
        });
        // Resolves once the server has the batch. While offline, Firestore queues it.
        await batch.commit();
      }
      for (const reference of references) this.confirmed.set(reference.id, { updateId, count: parts.length });
      this.failed = false;
      this.scheduleCompaction(true);
    } catch {
      // Refused, for example because the account may no longer edit: keep the change, so that
      // nothing is lost silently, and say that it was not saved.
      this.pending.unshift(merged);
      this.failed = true;
    } finally {
      this.inFlight -= 1;
      this.announce();
    }
  }

  /** The confirmed update documents whose content `doc` holds, complete groups only. */
  private compactable(max: number): string[] {
    const byGroup = new Map<string, string[]>();
    for (const [id, { updateId }] of this.confirmed) {
      if (this.partial.has(updateId)) continue;
      byGroup.set(updateId, [...(byGroup.get(updateId) ?? []), id]);
    }
    const out: string[] = [];
    for (const ids of byGroup.values()) {
      const count = this.confirmed.get(ids[0] ?? "")?.count ?? 0;
      if (ids.length !== count) continue;
      if (out.length + ids.length > max) break;
      out.push(...ids);
    }
    return out;
  }

  private scheduleCompaction(ownWrite: boolean): void {
    if (!this.options.canWrite || this.destroyed) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => {
        this.idleTimer = null;
        if (this.hasUnsavedChanges) return;
        if (this.wroteSinceIdle) {
          this.wroteSinceIdle = false;
          this.options.onIdleAfterEdit?.();
        }
        if (this.compactable(Number.POSITIVE_INFINITY).length >= this.options.compactIdleMinUpdates)
          void this.compact();
      },
      this.options.compactIdleMs + Math.random() * this.options.compactJitterMs,
    );
    if (!ownWrite && this.confirmed.size < this.options.compactAfterUpdates) return;
    if (this.compactTimer !== null || this.compacting || this.confirmed.size < this.options.compactAfterUpdates) return;
    this.compactTimer = setTimeout(() => {
      this.compactTimer = null;
      if (this.compactable(Number.POSITIVE_INFINITY).length >= this.options.compactAfterUpdates) void this.compact();
    }, Math.random() * this.options.compactJitterMs);
  }

  /**
   * Merges the applied part of the log into a later generation, and removes exactly those
   * updates in the transaction that moves the page to it (I3). A compaction that loses a race
   * removes nothing. Then removes the chunks of the generation it replaced.
   */
  async compact(): Promise<CompactionResult> {
    if (!this.options.canWrite) return { ok: false, reason: "read-only" };
    if (this.compacting) return { ok: false, reason: "busy" };
    if (this.status !== "synced") return { ok: false, reason: "not-synced" };
    this.compacting = true;
    const from = this.loadedGeneration;
    const ids = this.compactable(400);
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const chunks = split(state);
      // A generation whose chunks another compactor left behind is taken already: try the next.
      let generation = from + 1;
      for (let attempt = 0; ; attempt += 1) {
        try {
          for (let start = 0; start < chunks.length; start += PAGE_CHUNKS_PER_COMMIT) {
            const batch = writeBatch(db);
            chunks.slice(start, start + PAGE_CHUNKS_PER_COMMIT).forEach((chunk, offset) => {
              const index = start + offset;
              batch.set(doc(this.refs.content, pageContentChunkId(generation, index)), {
                schemaVersion: COLLECTIONS.pageContent.schemaVersion,
                createdAt: serverTimestamp(),
                createdBy: this.options.uid,
                writeContext: userWriteContext(),
                pageId: this.options.pageId,
                generation,
                index,
                snapshot: Bytes.fromUint8Array(chunk),
              });
            });
            await batch.commit();
          }
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          generation += 1;
        }
      }
      await runTransaction(
        db,
        async (transaction) => {
          const page = await transaction.get(this.refs.page);
          if ((headOf(page)?.generation ?? 0) !== from) throw new Error("generation-moved");
          transaction.update(this.refs.page, {
            contentHead: {
              generation,
              chunkCount: chunks.length,
              byteLength: state.length,
              stateVector: Bytes.fromUint8Array(Y.encodeStateVector(this.doc)),
              compactedAt: serverTimestamp(),
            },
            updatedAt: serverTimestamp(),
            updatedBy: this.options.uid,
            writeContext: userWriteContext(),
          });
          for (const id of ids) transaction.delete(doc(this.refs.updates, id));
        },
        { maxAttempts: 1 },
      );
      this.loadedGeneration = generation;
      for (const id of ids) this.confirmed.delete(id);
      void this.removeGenerationsBefore(generation);
      return { ok: true, merged: ids.length };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    } finally {
      this.compacting = false;
    }
  }

  /** Removes the chunks of the generations a compaction replaced. Best effort: another editor may have. */
  private async removeGenerationsBefore(generation: number): Promise<void> {
    try {
      const old = await getDocs(
        query(this.refs.content, where("generation", "<", generation), limit(LIVE_QUERY_MAX_LIMIT)),
      );
      if (old.empty) return;
      const batch = writeBatch(db);
      for (const chunk of old.docs) batch.delete(chunk.ref);
      await batch.commit();
    } catch {
      // Nothing to do: a later compaction removes them.
    }
  }

  /** Writes what is pending and stops every listener and timer. */
  async destroy(): Promise<void> {
    await this.flush().catch(() => undefined);
    this.destroyed = true;
    for (const timer of [this.flushTimer, this.compactTimer, this.idleTimer]) if (timer !== null) clearTimeout(timer);
    this.doc.off("update", this.onDocUpdate);
    window.removeEventListener("pagehide", this.onPageHide);
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.listeners.clear();
    this.awareness.destroy();
  }
}
