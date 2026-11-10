// A cache of live values fed by subscriptions. It knows nothing about Firestore: a subscription
// is any function that publishes values and returns a way to stop.
//
// Everything that asks for the same key shares one subscription and one value. Two components
// that show the same document therefore use one listener and always render the same data.
//
// A subscription can fail, for example when the server refuses it. A failed subscription has
// stopped for good, so the cache starts a new one after a short wait, a few times. Only when
// that keeps failing do the consumers see an error, and `retryFailed` lets them ask again.
//
// A value that comes from the local copy before the server has ever confirmed the subscription
// is held back, and the consumers keep seeing `loading`. Without the server the local copy may
// be empty or out of date, and an empty list shown as "nothing here" would be untrue. Once the
// server has confirmed the subscription, values from the local copy are shown, marked
// `fromCache`, and the cache reports itself `disconnected` while any watched value is in that
// state or still waits for the server, so that the shell can say so.

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

/** Hands the cache a new value. A value may be an error about the data: the subscription goes on. */
export type Publish<T> = (state: Live<T>) => void;
/** Tells the cache that the subscription itself has ended with a failure and will publish nothing more. */
export type Fail = (error: LiveError) => void;
/** Starts a subscription and returns the function that stops it. */
export type StartSubscription<T> = (publish: Publish<T>, fail: Fail) => () => void;

/** How long the cache waits before each new start of a subscription that failed. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000, 4_000];

interface Entry {
  state: Live<unknown>;
  readonly listeners: Set<() => void>;
  readonly start: StartSubscription<unknown>;
  stop: () => void;
  /** Counts the starts, so that a subscription that was replaced can no longer publish. */
  generation: number;
  /** Automatic new starts since the last value arrived. */
  failures: number;
  /** Whether the server has ever confirmed a value of this subscription. */
  confirmed: boolean;
  /** Whether the latest value came from the local copy, shown or held back. */
  local: boolean;
  teardown: ReturnType<typeof setTimeout> | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
}

const stopped = () => {};

export class SubscriptionCache {
  readonly #entries = new Map<string, Entry>();
  readonly #connectionListeners = new Set<() => void>();
  #disconnected = false;
  readonly #keepAliveMs: number;
  readonly #retryDelaysMs: readonly number[];
  #closed = false;

  /**
   * @param keepAliveMs How long a subscription outlives its last listener. A short delay lets a
   * route change or a re-mount pick the subscription up again instead of restarting it.
   * @param retryDelaysMs One wait for each automatic new start of a subscription that failed.
   * When they are used up, the consumers see the error.
   */
  constructor(keepAliveMs = 5_000, retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS) {
    this.#keepAliveMs = keepAliveMs;
    this.#retryDelaysMs = retryDelaysMs;
  }

  /** Number of subscriptions the cache holds, running or waiting to start again. */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Whether a watched value comes from the local copy because the server cannot be reached,
   * or waits for the server with only a local copy to go on. It is briefly true on every start,
   * while the server has yet to answer, so a reader waits a moment before saying so.
   */
  get disconnected(): boolean {
    return this.#disconnected;
  }

  /** Registers a listener for changes of `disconnected`. Returns the function that removes it. */
  subscribeConnection(listener: () => void): () => void {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
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
    if (this.#closed) return stopped;
    const existing = this.#entries.get(key);
    const entry: Entry = existing ?? {
      state: LOADING,
      listeners: new Set(),
      start: start as StartSubscription<unknown>,
      stop: stopped,
      generation: 0,
      failures: 0,
      confirmed: false,
      local: false,
      teardown: undefined,
      retry: undefined,
    };
    clearTimeout(entry.teardown);
    entry.teardown = undefined;
    // The listener is registered before anything is started: a subscription that fails at once
    // must find it, or the cache would take the subscription for one that nobody wants.
    entry.listeners.add(listener);
    if (!existing) {
      this.#entries.set(key, entry);
      this.#open(entry);
    } else if (entry.state.status === "error" && entry.stop === stopped && entry.retry === undefined) {
      // The subscription gave up earlier. A new consumer is a reason to try again.
      entry.failures = 0;
      entry.state = LOADING;
      this.#open(entry);
      this.#notify(entry);
    }

    return () => {
      entry.listeners.delete(listener);
      this.#updateConnection();
      if (entry.listeners.size > 0 || this.#entries.get(key) !== entry) return;
      // A subscription that is failing is not worth keeping for a consumer that may come back.
      if (entry.stop === stopped) {
        this.#drop(key, entry);
        return;
      }
      entry.teardown = setTimeout(() => this.#drop(key, entry), this.#keepAliveMs);
    };
  }

  /** Starts every subscription again that has given up after repeated failures. */
  retryFailed(): void {
    for (const entry of this.#entries.values()) {
      if (entry.state.status !== "error" || entry.stop !== stopped || entry.retry !== undefined) continue;
      entry.failures = 0;
      entry.state = LOADING;
      this.#open(entry);
      this.#notify(entry);
    }
  }

  /**
   * Stops every subscription for good and forgets every value. Called when the account goes
   * away, just before the page is loaded afresh, so that nothing one account read stays in
   * memory for the next. Nothing starts after this: listeners that are still registered see
   * `loading` until the page is replaced.
   */
  close(): void {
    this.#closed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const entry of entries) {
      this.#halt(entry);
      this.#notify(entry);
    }
    this.#updateConnection();
  }

  #open(entry: Entry): void {
    entry.generation += 1;
    const generation = entry.generation;
    // A subscription may publish, or fail, while it is being started, before `stop` is known.
    let starting = true;
    let failedWhileStarting = false;
    const accepts = () => starting || (entry.generation === generation && entry.stop !== stopped);
    const publish: Publish<unknown> = (state) => {
      if (!accepts()) return;
      if (state.status === "ready") {
        entry.local = state.fromCache;
        if (!state.fromCache) entry.confirmed = true;
        this.#updateConnection();
      }
      if (state.status === "ready" && state.fromCache && (entry.failures > 0 || !entry.confirmed)) {
        // A local copy that the server has not confirmed. After a failure the server may be about
        // to refuse again. Before any confirmation the copy may be empty or out of date. Either
        // way it is neither shown nor taken as a sign that the subscription works.
        return;
      }
      entry.state = state;
      if (state.status === "ready") entry.failures = 0;
      this.#notify(entry);
    };
    const fail: Fail = (error) => {
      if (!accepts()) return;
      failedWhileStarting = starting;
      this.#failed(entry, error);
    };
    const stop = entry.start(publish, fail);
    starting = false;
    if (failedWhileStarting || entry.generation !== generation) stop();
    else entry.stop = stop;
  }

  #failed(entry: Entry, error: LiveError): void {
    const stop = entry.stop;
    entry.stop = stopped;
    stop();
    const delay = this.#retryDelaysMs[entry.failures];
    if (delay === undefined || entry.listeners.size === 0) {
      entry.state = { status: "error", error };
      this.#notify(entry);
      if (entry.listeners.size === 0) this.#forget(entry);
      return;
    }
    entry.failures += 1;
    // The value that was shown may no longer be allowed, so it is not shown while waiting.
    entry.state = LOADING;
    this.#notify(entry);
    entry.retry = setTimeout(() => {
      entry.retry = undefined;
      this.#open(entry);
    }, delay);
  }

  #notify(entry: Entry): void {
    for (const notify of entry.listeners) notify();
  }

  #updateConnection(): void {
    let disconnected = false;
    for (const entry of this.#entries.values()) {
      if (entry.listeners.size > 0 && entry.local && entry.stop !== stopped) disconnected = true;
    }
    if (disconnected === this.#disconnected) return;
    this.#disconnected = disconnected;
    for (const notify of this.#connectionListeners) notify();
  }

  #halt(entry: Entry): void {
    clearTimeout(entry.teardown);
    clearTimeout(entry.retry);
    entry.teardown = undefined;
    entry.retry = undefined;
    entry.generation += 1;
    const stop = entry.stop;
    entry.stop = stopped;
    stop();
  }

  #drop(key: string, entry: Entry): void {
    this.#halt(entry);
    if (this.#entries.get(key) === entry) this.#entries.delete(key);
    this.#updateConnection();
  }

  #forget(entry: Entry): void {
    for (const [key, candidate] of this.#entries) {
      if (candidate === entry) this.#drop(key, entry);
    }
  }
}
