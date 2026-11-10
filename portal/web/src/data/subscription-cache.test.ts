import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Live, type Publish, SubscriptionCache } from "./subscription-cache";

/** A subscription the test can publish through, and that records how often it was started and stopped. */
function source<T>() {
  const state = { starts: 0, stops: 0, publish: (() => {}) as Publish<T> };
  const start = (publish: Publish<T>) => {
    state.starts += 1;
    state.publish = publish;
    return () => {
      state.stops += 1;
    };
  };
  return { state, start };
}

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

  it("on reset stops everything, forgets every value and tells the listeners", () => {
    const cache = new SubscriptionCache();
    const a = source<string>();
    const b = source<string>();
    const listener = vi.fn();
    cache.subscribe("doc:a", a.start, listener);
    const stopB = cache.subscribe("doc:b", b.start, () => {});
    a.state.publish(ready("secret of the previous account"));
    listener.mockClear();
    stopB();

    cache.reset();

    expect(a.state.stops).toBe(1);
    expect(b.state.stops).toBe(1);
    expect(cache.size).toBe(0);
    expect(cache.read("doc:a")).toEqual({ status: "loading" });
    expect(listener).toHaveBeenCalledTimes(1);
    // The pending teardown of b must not stop it a second time.
    vi.advanceTimersByTime(60_000);
    expect(b.state.stops).toBe(1);
  });

  it("starts afresh for a key that is used again after a reset", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source<string>();
    cache.subscribe("doc:a", start, () => {});
    cache.reset();
    cache.subscribe("doc:a", start, () => {});
    expect(state.starts).toBe(2);
  });
});
