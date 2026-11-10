// Search, sort and paging of a list that the browser holds in full. Every list of the
// administration console goes through this, so they all behave the same way.
import { fold } from "@eegml/shared";
import { useMemo, useState } from "react";
import type { SortDirection } from "@/components/ui/sort-header";

export interface TableSpec<T, K extends string> {
  /** The texts of an item that the search looks in. */
  readonly searchText: (item: T) => readonly (string | null | undefined)[];
  /** How each sortable column compares two items, ascending. */
  readonly sorters: Readonly<Record<K, (a: T, b: T) => number>>;
  readonly initialSort: { readonly key: K; readonly direction: SortDirection };
  readonly pageSize: number;
}

export interface TableView<T> {
  /** The items of the current page. */
  readonly page: readonly T[];
  /** How many items match the search. */
  readonly total: number;
  readonly offset: number;
}

/** Applies a search, a sort and a page to a list. Pure, so it is tested by itself. */
export function viewOf<T, K extends string>(
  items: readonly T[],
  spec: TableSpec<T, K>,
  state: { readonly query: string; readonly sortKey: K; readonly direction: SortDirection; readonly offset: number },
): TableView<T> {
  const query = fold(state.query);
  const matching =
    query === ""
      ? [...items]
      : items.filter((item) => spec.searchText(item).some((text) => text != null && fold(text).includes(query)));
  const compare = spec.sorters[state.sortKey];
  matching.sort((a, b) => (state.direction === "asc" ? compare(a, b) : compare(b, a)));
  // A search that shrinks the list never leaves the view on a page that no longer exists.
  const offset = state.offset >= matching.length ? 0 : state.offset;
  return { page: matching.slice(offset, offset + spec.pageSize), total: matching.length, offset };
}

/** Compares two texts the way people sort names. */
export const byText = (a: string | null | undefined, b: string | null | undefined): number =>
  (a ?? "").localeCompare(b ?? "", "en", { sensitivity: "base" });

export function useTableControls<T, K extends string>(items: readonly T[], spec: TableSpec<T, K>) {
  const [query, setQueryState] = useState("");
  const [sortKey, setSortKey] = useState<K>(spec.initialSort.key);
  const [direction, setDirection] = useState<SortDirection>(spec.initialSort.direction);
  const [offset, setOffset] = useState(0);
  const view = useMemo(
    () => viewOf(items, spec, { query, sortKey, direction, offset }),
    [items, spec, query, sortKey, direction, offset],
  );
  return {
    ...view,
    query,
    setQuery(value: string) {
      setQueryState(value);
      setOffset(0);
    },
    setOffset,
    pageSize: spec.pageSize,
    /** The direction of a column, or null when the list is sorted by another one. */
    directionOf: (key: K): SortDirection | null => (key === sortKey ? direction : null),
    sortBy(key: K) {
      if (key === sortKey) setDirection(direction === "asc" ? "desc" : "asc");
      else {
        setSortKey(key);
        setDirection("asc");
      }
      setOffset(0);
    },
  };
}
