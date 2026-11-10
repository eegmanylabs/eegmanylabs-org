import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Live, type Publish, SubscriptionCache } from "./subscription-cache";
import { useSubscription } from "./use-subscription";

function source() {
  const state = { starts: 0, stops: 0, publish: (() => {}) as Publish<string> };
  const start = (publish: Publish<string>) => {
    state.starts += 1;
    state.publish = publish;
    return () => {
      state.stops += 1;
    };
  };
  return { state, start };
}

const ready = (data: string): Live<string> => ({ status: "ready", data, fromCache: false, hasPendingWrites: false });

function Watcher({
  cache,
  name,
  watch,
  start,
}: {
  cache: SubscriptionCache;
  name: string;
  watch: string | null;
  start: ReturnType<typeof source>["start"];
}) {
  const live = useSubscription<string>(cache, watch, start);
  return <p data-testid={name}>{live.status === "ready" ? live.data : live.status}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSubscription", () => {
  it("gives two components that watch the same key one subscription, and updates them together", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source();
    render(
      <StrictMode>
        <Watcher cache={cache} name="header" watch="doc:replications/x" start={start} />
        <Watcher cache={cache} name="card" watch="doc:replications/x" start={start} />
      </StrictMode>,
    );
    expect(state.starts).toBe(1);
    expect(screen.getByTestId("header").textContent).toBe("loading");
    expect(screen.getByTestId("card").textContent).toBe("loading");

    act(() => state.publish(ready("first title")));
    expect(screen.getByTestId("header").textContent).toBe("first title");
    expect(screen.getByTestId("card").textContent).toBe("first title");

    act(() => state.publish(ready("second title")));
    expect(screen.getByTestId("header").textContent).toBe("second title");
    expect(screen.getByTestId("card").textContent).toBe("second title");
    expect(state.starts).toBe(1);
  });

  it("watches nothing when it is given no key", () => {
    const cache = new SubscriptionCache();
    const { state, start } = source();
    render(<Watcher cache={cache} name="idle" watch={null} start={start} />);
    expect(screen.getByTestId("idle").textContent).toBe("idle");
    expect(state.starts).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("moves to the new subscription when the key changes", () => {
    const cache = new SubscriptionCache(1_000);
    const first = source();
    const second = source();
    const view = render(<Watcher cache={cache} name="w" watch="doc:a" start={first.start} />);
    act(() => first.state.publish(ready("A")));
    expect(screen.getByTestId("w").textContent).toBe("A");

    view.rerender(<Watcher cache={cache} name="w" watch="doc:b" start={second.start} />);
    expect(screen.getByTestId("w").textContent).toBe("loading");
    act(() => second.state.publish(ready("B")));
    expect(screen.getByTestId("w").textContent).toBe("B");

    act(() => vi.advanceTimersByTime(1_000));
    expect(first.state.stops).toBe(1);
    expect(second.state.stops).toBe(0);
  });

  it("stops the subscription after the last component has unmounted", () => {
    const cache = new SubscriptionCache(1_000);
    const { state, start } = source();
    const view = render(<Watcher cache={cache} name="w" watch="doc:a" start={start} />);
    view.unmount();
    expect(state.stops).toBe(0);
    act(() => vi.advanceTimersByTime(1_000));
    expect(state.stops).toBe(1);
  });
});
