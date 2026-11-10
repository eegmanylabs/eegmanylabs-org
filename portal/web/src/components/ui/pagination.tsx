import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

export interface PaginationProps {
  /** The first item shown, counted from zero. */
  offset: number;
  /** How many items a page shows. */
  pageSize: number;
  /** How many items there are in all. */
  total: number;
  /** Names what is paged, for assistive technology, for example "accounts". */
  label: string;
  onChange: (offset: number) => void;
}

/** Moves through a long list a page at a time, and says which part of it is shown. */
export function Pagination({ offset, pageSize, total, label, onChange }: PaginationProps) {
  if (total <= pageSize && offset === 0) return null;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + pageSize, total);
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="text-fg-secondary" aria-live="polite">
        Showing {first} to {last} of {total} {label}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
          <ChevronLeft aria-hidden="true" strokeWidth={1.8} />
          Previous
        </Button>
        <Button size="sm" disabled={last >= total} onClick={() => onChange(offset + pageSize)}>
          Next
          <ChevronRight aria-hidden="true" strokeWidth={1.8} />
        </Button>
      </div>
    </nav>
  );
}
