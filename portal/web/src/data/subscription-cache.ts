// A cache of live values fed by subscriptions. It knows nothing about Firestore: a subscription
// is any function that publishes values and returns a way to stop.
//
// Everything that asks for the same key shares one subscription and one value. Two components
// that show the same document therefore use one listener and always render the same data.

export interface LiveError {
  /** A short machine-readable reason, for example "permission-denied" or "data/invalid-shape". */
  readonly code: string;
  readonly message: string;
}

export type Live<T> =
  /** Nothing is being watched, because the hook was given nothing to watch. */
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly data: T;
      /** True while the value comes from the local cache and has not been confirmed by the server. */
      readonly fromCache: boolean;
      /** True while a local change is still on its way to the server. */
      readonly hasPendingWrites: boolean;
    }
  | { readonly status: "error"; readonly error: LiveError };

export const IDLE: Live<never> = { status: "idle" };
export const LOADING: Live<never> = { status: "loading" };

export type Publish<T> = (state: Live<T>) => void;
/** Starts a subscription and returns the function that stops it. */
export type StartSubscription<T> = (publish: Publish<T>) => () => void;

interface Entry {
  state: Live<unknown>;
  readonly listeners: Set<() => void>;
  stop: () => void;
  teardown: ReturnType<typeof setTimeout> | undefined;
}

export class SubscriptionCache {
  readonly #entries = new Map<string, Entry>();
  readonly #keepAliveMs: number;

  /**
   * @param keepAliveMs How long a subscription outlives its last listener. A short delay lets a
   * route change or a re-mount pick the subscription up again instead of restarting it.
   */
  constructor(keepAliveMs = 5_000) {
    this.#keepAliveMs = keepAliveMs;
  }

  /** Number of open subscriptions. */
  get size(): number {
    return this.#entries.size;
  }

  /** The current value for a key. `loading` when nothing has been published yet. */
  read<T>(key: string): Live<T> {
    return (this.#entries.get(key)?.state ?? LOADING) as Live<T>;
  }

  /**
   * Registers a listener for a key, starting the subscription if this is the first one.
   * Returns the function that removes the listener.
   */
  subscribe<T>(key: string, start: StartSubscription<T>, listener: () => void): () => void {
    let entry = this.#entries.get(key);
    if (!entry) {
      const created: Entry = { state: LOADING, listeners: new Set(), stop: () => {}, teardown: undefined };
      this.#entries.set(key, created);
      created.stop = start((state) => {
        created.state = state;
        for (const notify of created.listeners) notify();
      });
      entry = created;
    }
    const current = entry;
    clearTimeout(current.teardown);
    current.teardown = undefined;
    current.listeners.add(listener);

    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size > 0 || this.#entries.get(key) !== current) return;
      current.teardown = setTimeout(() => {
        current.stop();
        this.#entries.delete(key);
      }, this.#keepAliveMs);
    };
  }

  /**
   * Stops every subscription and forgets every value. Called on sign-out, so that nothing read
   * by one account is shown to the next. Listeners that are still registered see `loading`.
   */
  reset(): void {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const entry of entries) {
      clearTimeout(entry.teardown);
      entry.stop();
      for (const notify of entry.listeners) notify();
    }
  }
}
