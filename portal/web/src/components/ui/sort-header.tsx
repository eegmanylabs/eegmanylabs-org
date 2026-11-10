import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { TableHeaderCell } from "./table";

export type SortDirection = "asc" | "desc";

export interface SortHeaderProps {
  children: ReactNode;
  /** The direction the column sorts in now, or null when the table is sorted by another column. */
  direction: SortDirection | null;
  onSort: () => void;
}

/** The header of a sortable column: a button that sorts by it, with the state for assistive technology. */
export function SortHeader({ children, direction, onSort }: SortHeaderProps) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <TableHeaderCell aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={onSort}
        className="-mx-1 inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-control px-1 font-medium hover:text-fg pointer-coarse:min-h-11"
      >
        {children}
        <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      </button>
    </TableHeaderCell>
  );
}
