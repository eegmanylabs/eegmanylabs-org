// A collection read in pages of at most the size that one query may ask for, each page a live
// listener that starts after the last document of the page before it. The pages are opened one
// after another while each comes back full, so a collection of any size up to the bound is read
// whole, and the result is shown only once every page that is open has answered.
import type { Fail, LiveError, Publish } from "./subscription-cache";

/** What one page of a collection holds. */
export interface PageSnapshot<T> {
  readonly items: readonly T[];
  /** The identifier of the last document of the page, or null for an empty page. */
  readonly lastId: string | null;
  readonly fromCache: boolean;
  readonly hasPendingWrites: boolean;
}

/** Opens the listener of one page, starting after a document or at the beginning. Returns the function that stops it. */
export type ListenPage<T> = (
  startAfterId: string | undefined,
  onPage: (page: PageSnapshot<T>) => void,
  onError: (error: LiveError) => void,
) => () => void;

/** The result of a paged read: every document of the open pages, in order. */
export interface PagedItems<T> {
  readonly items: readonly T[];
  /** True when the last page that may be opened is full, so that documents may lie beyond it. */
  readonly truncated: boolean;
}

/**
 * Starts a paged read. A page that comes back full opens the next page after its last document,
 * up to `maxPages`. A page whose last document changes, or that stops being full, closes the
 * pages after it, which open anew from its new end. Returns the function that stops every page.
 */
export function startPagedSubscription<T>(
  pageSize: number,
  maxPages: number,
  listen: ListenPage<T>,
  publish: Publish<PagedItems<T>>,
  fail: Fail,
): () => void {
  const pages: (PageSnapshot<T> | undefined)[] = [];
  const stops: (() => void)[] = [];

  const closeFrom = (index: number) => {
    for (const stop of stops.splice(index)) stop();
    pages.splice(index);
  };

  const emit = () => {
    if (pages.length < stops.length || pages.some((page) => page === undefined)) return;
    const loaded = pages as PageSnapshot<T>[];
    const last = loaded.at(-1);
    publish({
      status: "ready",
      data: {
        items: loaded.flatMap((page) => page.items),
        truncated: loaded.length === maxPages && last !== undefined && last.items.length === pageSize,
      },
      fromCache: loaded.some((page) => page.fromCache),
      hasPendingWrites: loaded.some((page) => page.hasPendingWrites),
    });
  };

  const open = (index: number, after: string | undefined) => {
    pages[index] = undefined;
    // The place is taken before the listener starts, so that a page that answers at once is kept.
    stops[index] = () => undefined;
    const stop = listen(
      after,
      (page) => {
        if (stops.length <= index) return;
        const previous = pages[index];
        pages[index] = page;
        const full = page.items.length === pageSize && page.lastId !== null;
        if (previous !== undefined && (previous.lastId !== page.lastId || !full)) closeFrom(index + 1);
        if (full && stops.length === index + 1 && index + 1 < maxPages) {
          open(index + 1, page.lastId ?? undefined);
          return;
        }
        emit();
      },
      (error) => fail(error),
    );
    if (stops.length > index) stops[index] = stop;
    else stop();
  };

  open(0, undefined);
  return () => closeFrom(0);
}
