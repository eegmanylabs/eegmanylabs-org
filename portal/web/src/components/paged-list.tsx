// A list that shows a page of its items at a time, with the shared pagination beneath it, so
// that a list of any length draws a bounded number of rows (R18.13).
import { type ComponentProps, type ReactNode, useState } from "react";
import { Pagination } from "@/components/ui/pagination";

/** How many items a paged list shows at once, unless it says otherwise. */
export const LIST_PAGE_SIZE = 50;

export interface PagedListProps<T> extends Omit<ComponentProps<"ul">, "children"> {
  readonly items: readonly T[];
  /** Names what is listed, for the pagination, for example "archived pages". */
  readonly label: string;
  readonly pageSize?: number;
  readonly keyOf: (item: T) => string;
  readonly children: (item: T) => ReactNode;
}

export function PagedList<T>({ items, label, pageSize = LIST_PAGE_SIZE, keyOf, children, ...list }: PagedListProps<T>) {
  const [offset, setOffset] = useState(0);
  // A list that shrank below the page shown goes back to its last page.
  const lastStart = items.length === 0 ? 0 : Math.floor((items.length - 1) / pageSize) * pageSize;
  const start = Math.min(offset, lastStart);
  return (
    <div className="grid gap-1">
      <ul {...list}>
        {items.slice(start, start + pageSize).map((item) => (
          <li key={keyOf(item)}>{children(item)}</li>
        ))}
      </ul>
      <Pagination offset={start} pageSize={pageSize} total={items.length} label={label} onChange={setOffset} />
    </div>
  );
}
