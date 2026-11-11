import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETRY_DELAYS_MS,
  type Fail,
  isDenied,
  type Live,
  type LiveError,
  type Publish,
  SubscriptionCache,
} from "./subscription-cache";

/**
 * A subscription the test can publish and fail through, and that records how often it was
 * started and stopped. `publish` and `fail` always belong to the latest start.
 */
function source<T>() {
  const state = { starts: 0, stops: 0, publish: (() => {}) as Publish<T>, fail: (() => {}) as Fail };
  const start = (publish: Publish<T>, fail: Fail) => {
    state.starts += 1;
    state.publish = publish;
    state.fail = fail;
    return () => {
      state.stops += 1;
    };
  };
  return { state, start };
}

const refused: LiveError = { code: "permission-denied", message: "Missing or insufficient permissions." };
const unreachable: LiveError = { code: "unavailable", message: "The server could not be reached." };
const loading = { status: "loading" };

const ready = <T>(data: T): Live<T> => ({ status: "ready", data, fromCache: false, hasPendingWrites: false });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SubscriptionCache", () => {
  it("starts one subscription for a key however many listeners there are", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    cache.subscribe("doc:a", start, () => {});
    expect(state.starts).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("is loading until a value is published, then gives every listener the same value", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    const first = vi.fn();
    const second = vi.fn();
    cache.subscribe("doc:a", start, first);
    cache.subscribe("doc:a", start, second);
    expect(cache.read("doc:a")).toEqual({ status: "loading" });

    state.publish(ready("hello"));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(cache.read("doc:a")).toEqual(ready("hello"));
  });

  it("keeps keys apart", () => {
    const cache = new SubscriptionCache();
    const a = source<string>();
    const b = source<string>();
    cache.subscribe("doc:a", a.start, () => {});
    cache.subscribe("doc:b", b.start, () => {});
    a.state.publish(ready("A"));
    expect(cache.read("doc:a")).toEqual(ready("A"));
    expect(cache.read("doc:b")).toEqual({ status: "loading" });
    expect(cache.size).toBe(2);
  });

  it("stops a subscription a while after its last listener has gone", () => {
    const cache = new SubscriptionCache(5_000);
    const { state, start } = source<string>();
    const stopFirst = cache.subscribe("doc:a", start, () => {});
    const stopSecond = cache.subscribe("doc:a", start, () => {});

    stopFirst();
    vi.advanceTimersByTime(10_000);
    expect(state.stops).toBe(0);

    stopSecond();
    vi.advanceTimersByTime(4_999);
    expect(state.stops).toBe(0);
    vi.advanceTimersByTime(1);
    expect(state.stops).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("keeps the subscription and its value when a listener comes back in time", () => {
    const cache = new SubscriptionCache(5_000);
    const { state, start } = source<string>();
    const stop = cache.subscribe("doc:a", start, () => {});
    state.publish(ready("kept"));
    stop();
    vi.advanceTimersByTime(1_000);

    cache.subscribe("doc:a", start, () => {});
    vi.advanceTimersByTime(60_000);

    expect(state.starts).toBe(1);
    expect(state.stops).toBe(0);
    expect(cache.read("doc:a")).toEqual(ready("kept"));
  });

  it("does not notify a listener that has been removed", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    const listener = vi.fn();
    const stop = cache.subscribe("doc:a", start, listener);
    cache.subscribe("doc:a", start, () => {});
    stop();
    state.publish(ready("later"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("passes failures on as a value", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    state.publish({ status: "error", error: { code: "permission-denied", message: "Missing permissions." } });
    expect(cache.read("doc:a")).toEqual({
      status: "error",
      error: { code: "permission-denied", message: "Missing permissions." },
    });
  });

  it("on close stops everything, forgets every value and tells the listeners", () => {
    const cache = new SubscriptionCache();
    const a = source<string>();
    const b = source<string>();
    const listener = vi.fn();
    cache.subscribe("doc:a", a.start, listener);
    const stopB = cache.subscribe("doc:b", b.start, () => {});
    a.state.publish(ready("secret of the previous account"));
    listener.mockClear();
    stopB();

    cache.close();

    expect(a.state.stops).toBe(1);
    expect(b.state.stops).toBe(1);
    expect(cache.size).toBe(0);
    expect(cache.read("doc:a")).toEqual(loading);
    expect(listener).toHaveBeenCalledTimes(1);
    // The pending teardown of b must not stop it a second time.
    vi.advanceTimersByTime(60_000);
    expect(b.state.stops).toBe(1);
  });

  it("starts nothing once it has been closed, and takes nothing from a subscription that was running", () => {
    const cache = new SubscriptionCache();
    const before = source<string>();
    cache.subscribe("doc:a", before.start, () => {});
    cache.close();
    before.state.publish(ready("late value of the previous account"));
    expect(cache.read("doc:a")).toEqual(loading);

    const after = source<string>();
    const listener = vi.fn();
    const stop = cache.subscribe("doc:a", after.start, listener);
    expect(after.state.starts).toBe(0);
    expect(cache.size).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});

describe("a subscription that fails", () => {
  it("is stopped and started again after a short wait, and its consumers see loading meanwhile", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    const listener = vi.fn();
    cache.subscribe("doc:a", start, listener);
    state.publish(ready("value the account may no longer see"));
    listener.mockClear();

    state.fail(refused);

    expect(state.stops).toBe(1);
    expect(cache.read("doc:a")).toEqual(loading);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(state.starts).toBe(1);

    vi.advanceTimersByTime((DEFAULT_RETRY_DELAYS_MS[0] ?? 0) - 1);
    expect(state.starts).toBe(1);
    vi.advanceTimersByTime(1);
    expect(state.starts).toBe(2);

    state.publish(ready("fresh value"));
    expect(cache.read("doc:a")).toEqual(ready("fresh value"));
    expect(cache.size).toBe(1);
  });

  it("reports the error only after every new start has failed too, and then waits to be asked", () => {
    const cache = new SubscriptionCache(5_000, [100, 200]);
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});

    state.fail(refused);
    vi.advanceTimersByTime(100);
    expect(cache.read("doc:a")).toEqual(loading);
    state.fail(refused);
    vi.advanceTimersByTime(200);
    expect(state.starts).toBe(3);
    expect(cache.read("doc:a")).toEqual(loading);

    state.fail(refused);
    expect(cache.read("doc:a")).toEqual({ status: "error", error: refused });
    expect(state.stops).toBe(3);
    vi.advanceTimersByTime(600_000);
    expect(state.starts).toBe(3);
  });

  it("neither shows nor trusts the local copy that a subscription delivers when it is started again", () => {
    const cache = new SubscriptionCache(5_000, [100, 100]);
    const { state, start } = source<string>();
    const listener = vi.fn();
    cache.subscribe("doc:a", start, listener);
    const cached: Live<string> = {
      status: "ready",
      data: "copy from before",
      fromCache: true,
      hasPendingWrites: false,
    };

    // Refused, started again, and the new subscription first hands over what the browser kept.
    for (let round = 0; round < 2; round += 1) {
      state.fail(refused);
      vi.advanceTimersByTime(100);
      listener.mockClear();
      state.publish(cached);
      expect(cache.read("doc:a")).toEqual(loading);
      expect(listener).not.toHaveBeenCalled();
    }

    // The local copy did not count as success: after the last new start the error is reported.
    state.fail(refused);
    expect(cache.read("doc:a")).toEqual({ status: "error", error: refused });
    vi.advanceTimersByTime(600_000);
    expect(state.starts).toBe(3);
  });

  it("holds back a local copy until the server has confirmed the subscription, and says it is disconnected", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string[]>();
    const connection = vi.fn();
    cache.subscribeConnection(connection);
    cache.subscribe("query:a", start, () => {});
    const offline = (data: string[]): Live<string[]> => ({
      status: "ready",
      data,
      fromCache: true,
      hasPendingWrites: false,
    });

    // Offline from the start: the browser's copy is empty, which is no reason to say "nothing here".
    state.publish(offline([]));
    expect(cache.read("query:a")).toEqual(loading);
    expect(cache.disconnected).toBe(true);
    expect(connection).toHaveBeenCalledTimes(1);

    state.publish(ready(["from the server"]));
    expect(cache.read("query:a")).toEqual(ready(["from the server"]));
    expect(cache.disconnected).toBe(false);

    // Confirmed once, the copy is shown when the connection drops, marked as such.
    state.publish(offline(["from the server"]));
    expect(cache.read("query:a")).toEqual(offline(["from the server"]));
    expect(cache.disconnected).toBe(true);
    state.publish(ready(["from the server"]));
    expect(cache.disconnected).toBe(false);
    expect(connection).toHaveBeenCalledTimes(4);
  });

  it("says it is disconnected while the server has not answered a new subscription or confirmed a write", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    // A database that stopped answering never sends anything: the subscription waits.
    expect(cache.disconnected).toBe(true);
    state.publish(ready("saved"));
    expect(cache.disconnected).toBe(false);

    // A change of this browser that the server has not confirmed yet.
    state.publish({ status: "ready", data: "edited", fromCache: false, hasPendingWrites: true });
    expect(cache.read("doc:a")).toMatchObject({ data: "edited", hasPendingWrites: true });
    expect(cache.disconnected).toBe(true);
    state.publish(ready("edited"));
    expect(cache.disconnected).toBe(false);
  });

  it("does not take a refusal of the server for a lost connection", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    state.fail(refused);
    expect(cache.disconnected).toBe(false);
    vi.advanceTimersByTime(100);
    // Started again after the refusal: still an answer of the server, not silence.
    expect(cache.disconnected).toBe(false);
    state.fail(refused);
    expect(cache.read("doc:a")).toEqual({ status: "error", error: refused });
    expect(cache.disconnected).toBe(false);
  });

  it("stops saying it is disconnected when nobody watches the value any more", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    const stop = cache.subscribe("doc:a", start, () => {});
    state.publish({ status: "ready", data: "copy", fromCache: true, hasPendingWrites: false });
    expect(cache.disconnected).toBe(true);
    stop();
    expect(cache.disconnected).toBe(false);
  });

  it("counts new starts afresh once a value has arrived", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    state.fail(refused);
    vi.advanceTimersByTime(100);
    state.publish(ready("recovered"));

    state.fail(refused);
    expect(cache.read("doc:a")).toEqual(loading);
    vi.advanceTimersByTime(100);
    expect(state.starts).toBe(3);
  });

  it("starts again on request after it has given up, and tells the listeners", () => {
    const cache = new SubscriptionCache(5_000, []);
    const { state, start } = source<string>();
    const listener = vi.fn();
    cache.subscribe("doc:a", start, listener);
    state.fail(refused);
    expect(cache.read("doc:a")).toEqual({ status: "error", error: refused });
    listener.mockClear();

    cache.retryFailed();

    expect(state.starts).toBe(2);
    expect(cache.read("doc:a")).toEqual(loading);
    expect(listener).toHaveBeenCalledTimes(1);
    state.publish(ready("after asking again"));
    expect(cache.read("doc:a")).toEqual(ready("after asking again"));
  });

  it("leaves subscriptions alone that are working or still being started again when asked to retry", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    const working = source<string>();
    const waiting = source<string>();
    cache.subscribe("doc:working", working.start, () => {});
    cache.subscribe("doc:waiting", waiting.start, () => {});
    working.state.publish(ready("fine"));
    waiting.state.fail(refused);

    cache.retryFailed();

    expect(working.state.starts).toBe(1);
    expect(waiting.state.starts).toBe(1);
    expect(cache.read("doc:working")).toEqual(ready("fine"));
  });

  it("is forgotten at once when its last listener leaves, so the next consumer starts afresh", () => {
    const cache = new SubscriptionCache(5_000, []);
    const first = source<string>();
    const stop = cache.subscribe("doc:a", first.start, () => {});
    first.state.fail(refused);
    stop();
    expect(cache.size).toBe(0);

    const second = source<string>();
    cache.subscribe("doc:a", second.start, () => {});
    expect(second.state.starts).toBe(1);
    expect(cache.read("doc:a")).toEqual(loading);
  });

  it("is not started again when its last listener leaves during the wait", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    const { state, start } = source<string>();
    const stop = cache.subscribe("doc:a", start, () => {});
    state.fail(refused);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(state.starts).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("starts again for a new consumer that joins one whose subscription has given up", () => {
    const cache = new SubscriptionCache(5_000, []);
    const { state, start } = source<string>();
    const earlier = vi.fn();
    cache.subscribe("doc:a", start, earlier);
    state.fail(unreachable);
    earlier.mockClear();

    cache.subscribe("doc:a", start, () => {});

    expect(state.starts).toBe(2);
    expect(cache.read("doc:a")).toEqual(loading);
    expect(earlier).toHaveBeenCalledTimes(1);
  });

  it("keeps a refusal for a new consumer, so that the others are not put back to loading, until asked again", () => {
    const cache = new SubscriptionCache(5_000, []);
    const { state, start } = source<string>();
    const earlier = vi.fn();
    cache.subscribe("doc:a", start, earlier);
    state.publish(ready("a page the account could read"));
    state.fail(refused);
    earlier.mockClear();

    // A name in a breadcrumb, mounted again, joins the refused subscription.
    cache.subscribe("doc:a", start, () => {});

    expect(state.starts).toBe(1);
    expect(isDenied(cache.read("doc:a"))).toBe(true);
    expect(earlier).not.toHaveBeenCalled();

    cache.retryFailed();
    expect(state.starts).toBe(2);
  });

  it("ignores what a stopped subscription still sends", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    const { publish: stalePublish, fail: staleFail } = state;
    state.fail(refused);

    stalePublish(ready("from a subscription that has ended"));
    staleFail(refused);
    expect(cache.read("doc:a")).toEqual(loading);

    vi.advanceTimersByTime(100);
    stalePublish(ready("still from the old one"));
    expect(cache.read("doc:a")).toEqual(loading);
    expect(state.starts).toBe(2);
  });

  it("handles a subscription that fails while it is being started", () => {
    const cache = new SubscriptionCache(5_000, [100]);
    let starts = 0;
    let stops = 0;
    const start = (_publish: Publish<string>, fail: Fail) => {
      starts += 1;
      if (starts === 1) fail(refused);
      return () => {
        stops += 1;
      };
    };
    cache.subscribe("doc:a", start, () => {});
    expect(cache.read("doc:a")).toEqual(loading);
    expect(stops).toBe(1);
    vi.advanceTimersByTime(100);
    expect(starts).toBe(2);
    expect(stops).toBe(1);
  });

  it("keeps a subscription running whose value is an error about the data", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    const badShape: LiveError = { code: "data/invalid-shape", message: "The record does not have the expected shape." };

    state.publish({ status: "error", error: badShape });
    expect(cache.read("doc:a")).toEqual({ status: "error", error: badShape });
    expect(state.stops).toBe(0);

    // The document is put right, and the same listener delivers it.
    state.publish(ready("valid again"));
    expect(cache.read("doc:a")).toEqual(ready("valid again"));
    expect(state.starts).toBe(1);
  });
});
