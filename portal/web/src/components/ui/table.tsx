import { type ComponentProps, useRef } from "react";
import { cn } from "@/utils/cn";
import { ScrollEdgeMarks, useScrollEdges } from "./horizontal-scroll";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the table for assistive technology. It is not shown. */
  caption: string;
}

/**
 * The frame of a data table: a bordered, horizontally scrollable region with hairline row
 * dividers and no striping. The region is positioned, so that text for assistive technology,
 * which is positioned absolutely, scrolls with the table and never widens the page. On a screen
 * too narrow for every column, a mark on the edge says that more columns lie beyond it.
 */
export function Table({ caption, className, children, ...props }: TableProps) {
  const region = useRef<HTMLElement | null>(null);
  const { edges, update } = useScrollEdges(region);
  return (
    <div className="relative min-w-0">
      <section
        ref={region}
        aria-label={caption}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must be reachable by keyboard
        tabIndex={0}
        onScroll={update}
        className="relative overflow-x-auto rounded-tile border border-border bg-surface"
      >
        <table className={cn("w-full border-collapse text-left text-sm", className)} {...props}>
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </section>
      <ScrollEdgeMarks edges={edges} />
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-muted text-micro text-fg-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child]:border-b-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("h-10 border-b border-border", className)} {...props} />;
}

export function TableHeaderCell({ className, scope = "col", ...props }: ComponentProps<"th">) {
  return <th scope={scope} className={cn("px-3 py-2 font-medium", className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 text-fg", className)} {...props} />;
}
