// Who else has a page open (D-010), ported from the editor spike, whose tests verified it. The
// y-protocols `Awareness` of a page (who is there and, in the mode "cursor", where their caret
// is) is mirrored into small Firestore documents, one for each open tab:
//
//   pages/{pageId}/presence/{uid__tab}   { pageId, uid, tab, clientId, clock, state: JSON }
//
// Every write is billed, and so is its delivery to every other open tab, so:
//   - a change of state is written at most once per `throttleMs`;
//   - an unchanged state is written again only every `heartbeatMs`, as a sign of life;
//   - y-protocols drops a remote state after 30 seconds without news and announces the local one
//     every 15. Mirroring that would mean four writes a minute for every open tab, so here a
//     remote state stays alive for as long as its document is fresh (younger than two and a half
//     heartbeats), and nothing is written for the renewals of y-protocols;
//   - a hidden tab removes its document and writes nothing until it is shown again.
// y-prosemirror stores a caret as a relative position, which does not change while someone
// types, so typing costs no presence writes; moving the caret does.
import { COLLECTIONS, pagePresenceId, userWriteContext } from "@eegml/shared";
import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
  type Unsubscribe,
  updateDoc,
  where,
} from "firebase/firestore";
import { type Awareness, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { awarenessUpdateOf } from "./awareness-wire";
import { db } from "./firebase";

export type PresenceSyncMode = "cursor" | "presence";

export interface PresenceSyncOptions {
  readonly pageId: string;
  readonly uid: string;
  readonly awareness: Awareness;
  /** "cursor" sends the whole state, the caret included; "presence" sends only who is there. */
  readonly mode: PresenceSyncMode;
  /** The shortest time between two writes of this tab. */
  readonly throttleMs?: number;
  /** How often an unchanged state is written again, so that others know the tab is still open. */
  readonly heartbeatMs?: number;
}

/** The settings the spike recommends (its section 5.6). */
const DEFAULTS = { throttleMs: 2_000, heartbeatMs: 60_000 } as const;

/** The most other tabs whose presence a page follows. */
const PRESENCE_LIMIT = 100;

/** Twenty letters and digits, which name a tab. */
function tabId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const random = new Uint8Array(20);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

/** Mirrors the awareness of a page through Firestore, as the comment at the top describes. */
export class PresenceSync {
  private readonly options: Required<PresenceSyncOptions>;
  private readonly tab = tabId();
  private readonly reference;
  private readonly unsubscribe: Unsubscribe;
  private readonly interval: ReturnType<typeof setInterval>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWrite = 0;
  private lastPublished = "";
  private clock = 0;
  /** Whether this tab's document exists, so that the next write updates it rather than creating it. */
  private stored = false;
  private destroyed = false;
  private hidden = false;
  /** The Yjs client and the time of the latest write of every other tab, by the identifier of its document. */
  private readonly remote = new Map<string, { readonly clientId: number; readonly at: number }>();

  constructor(options: PresenceSyncOptions) {
    this.options = { ...DEFAULTS, ...options };
    const { pageId, uid, awareness } = this.options;
    const presence = collection(db, COLLECTIONS.pagePresence.collectionPath(pageId));
    this.reference = doc(presence, pagePresenceId(uid, this.tab));
    awareness.on("update", this.onLocal);
    // This tab's own document is left out, so its writes cost it no reads.
    this.unsubscribe = onSnapshot(
      query(presence, where("tab", "!=", this.tab), limit(PRESENCE_LIMIT)),
      (snapshot) => {
        for (const change of snapshot.docChanges()) {
          if (change.type === "removed") {
            this.forget(change.doc.id);
            continue;
          }
          const data = change.doc.data({ serverTimestamps: "estimate" });
          const at = (data.updatedAt as Timestamp | undefined)?.toMillis() ?? Date.now();
          // The document of a tab that closed without removing it.
          if (Date.now() - at > this.staleAfter) continue;
          if (typeof data.clientId !== "number" || typeof data.clock !== "number" || typeof data.state !== "string") {
            continue;
          }
          this.remote.set(change.doc.id, { clientId: data.clientId, at });
          try {
            applyAwarenessUpdate(awareness, awarenessUpdateOf(data.clientId, data.clock, data.state), this);
          } catch {
            // A state that is not JSON: another tab's mistake, which this page goes on without.
          }
        }
      },
      // Refused, for example because the account may no longer read the page: nobody is shown.
      () => this.forgetAll(),
    );
    // Remote states stay alive past the 30 seconds of y-protocols while their documents are
    // fresh, and those whose documents went stale are dropped. The heartbeat is checked too.
    this.interval = setInterval(() => {
      const now = Date.now();
      for (const [id, entry] of this.remote) {
        if (now - entry.at > this.staleAfter) this.forget(id);
        else {
          const meta = awareness.meta.get(entry.clientId);
          if (meta !== undefined) meta.lastUpdated = now;
        }
      }
      this.schedule();
    }, 5_000);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.schedule();
  }

  private get staleAfter(): number {
    return this.options.heartbeatMs * 2.5;
  }

  private forget(id: string): void {
    const entry = this.remote.get(id);
    if (entry !== undefined) removeAwarenessStates(this.options.awareness, [entry.clientId], this);
    this.remote.delete(id);
  }

  private forgetAll(): void {
    for (const id of [...this.remote.keys()]) this.forget(id);
  }

  private readonly onLocal = (_changes: unknown, origin: unknown) => {
    if (origin !== this) this.schedule();
  };

  private schedule(): void {
    if (this.timer !== null || this.destroyed || this.hidden) return;
    const wait = Math.max(0, this.lastWrite + this.options.throttleMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.publish();
    }, wait);
  }

  private async publish(): Promise<void> {
    const local = this.options.awareness.getLocalState();
    if (local === null || this.destroyed || this.hidden) return;
    const state = JSON.stringify(this.options.mode === "presence" ? { user: local.user } : local);
    const heartbeatDue = Date.now() - this.lastWrite >= this.options.heartbeatMs;
    if (state === this.lastPublished && !heartbeatDue) return;
    this.lastPublished = state;
    this.lastWrite = Date.now();
    this.clock += 1;
    const { uid, pageId, awareness } = this.options;
    const fields = { clientId: awareness.clientID, clock: this.clock, state };
    try {
      if (this.stored) {
        await updateDoc(this.reference, {
          ...fields,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          writeContext: userWriteContext(),
        });
      } else {
        await setDoc(this.reference, {
          schemaVersion: COLLECTIONS.pagePresence.schemaVersion,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: uid,
          updatedBy: uid,
          archivedAt: null,
          writeContext: userWriteContext(),
          pageId,
          uid,
          tab: this.tab,
          ...fields,
        });
        this.stored = true;
      }
    } catch {
      // Refused or offline: presence is a convenience, and the next change or heartbeat tries again.
      this.stored = false;
      this.lastPublished = "";
    }
  }

  private withdraw(): void {
    this.stored = false;
    this.lastPublished = "";
    void deleteDoc(this.reference).catch(() => undefined);
  }

  private readonly onVisibility = () => {
    this.hidden = document.hidden;
    if (this.hidden) this.withdraw();
    else this.schedule();
  };

  private readonly onPageHide = () => this.withdraw();

  /** Stops following and removes this tab's document. */
  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    clearInterval(this.interval);
    this.options.awareness.off("update", this.onLocal);
    this.unsubscribe();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.forgetAll();
    this.withdraw();
  }
}
