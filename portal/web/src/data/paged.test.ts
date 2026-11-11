// The paged read of a collection: a full page opens the next one after its last document, the
// result appears once every open page has answered, and a page that changes moves the pages
// after it. The documents are synthetic identifiers.
import { describe, expect, it, vi } from "vitest";
import { type PagedItems, type PageSnapshot, startPagedSubscription } from "./paged";
import type { Live } from "./subscription-cache";

/** A collection of identifiers served in pages by fake listeners that the test answers. */
function fakeCollection() {
  const listeners = new Map<string, (page: PageSnapshot<string>) => void>();
  const stopped: string[] = [];
  const listen = (after: string | undefined, onPage: (page: PageSnapshot<string>) => void) => {
    const key = after ?? "start";
    listeners.set(key, onPage);
    return () => {
      stopped.push(key);
      listeners.delete(key);
    };
  };
  const answer = (after: string, items: string[]) =>
    listeners.get(after)?.({ items, lastId: items.at(-1) ?? null, fromCache: false, hasPendingWrites: false });
  return { listen, answer, listeners, stopped };
}

const ids = (from: number, count: number) => Array.from({ length: count }, (_, index) => `p${from + index}`);

describe("startPagedSubscription", () => {
  it("reads past the first page, and shows the result once the last page has answered", () => {
    const collection = fakeCollection();
    const published: Live<PagedItems<string>>[] = [];
    startPagedSubscription(3, 10, collection.listen, (state) => published.push(state), vi.fn());
    collection.answer("start", ids(0, 3));
    expect(published).toEqual([]);
    expect([...collection.listeners.keys()]).toEqual(["start", "p2"]);
    collection.answer("p2", ids(3, 1));
    expect(published.at(-1)).toMatchObject({
      status: "ready",
      data: { items: ids(0, 4), truncated: false },
    });
  });

  it("says that the result is truncated when the last page it may open is full", () => {
    const collection = fakeCollection();
    const published: Live<PagedItems<string>>[] = [];
    startPagedSubscription(2, 2, collection.listen, (state) => published.push(state), vi.fn());
    collection.answer("start", ids(0, 2));
    collection.answer("p1", ids(2, 2));
    expect(collection.listeners.size).toBe(2);
    expect(published.at(-1)).toMatchObject({ data: { items: ids(0, 4), truncated: true } });
  });

  it("opens the later pages anew when a page ends somewhere else, and stops every page at the end", () => {
    const collection = fakeCollection();
    const published: Live<PagedItems<string>>[] = [];
    const stop = startPagedSubscription(2, 10, collection.listen, (state) => published.push(state), vi.fn());
    collection.answer("start", ids(0, 2));
    collection.answer("p1", ["p2"]);
    // A document is added on the first page, so it ends one document earlier.
    collection.answer("start", ["p0", "p00"]);
    expect(collection.stopped).toEqual(["p1"]);
    expect([...collection.listeners.keys()]).toEqual(["start", "p00"]);
    collection.answer("p00", ["p1", "p2"]);
    collection.answer("p2", []);
    expect(published.at(-1)).toMatchObject({ data: { items: ["p0", "p00", "p1", "p2"], truncated: false } });
    stop();
    expect(collection.listeners.size).toBe(0);
  });
});
