import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the table for assistive technology. It is not shown. */
  caption: string;
}

/**
 * The frame of a data table: a bordered, horizontally scrollable region with hairline row
 * dividers and no striping. The region is positioned, so that text for assistive technology,
 * which is positioned absolutely, scrolls with the table and never widens the page.
 */
export function Table({ caption, className, children, ...props }: TableProps) {
  return (
    <section
      aria-label={caption}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must be reachable by keyboard
      tabIndex={0}
      className="relative overflow-x-auto rounded-tile border border-border bg-surface"
    >
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </section>
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
