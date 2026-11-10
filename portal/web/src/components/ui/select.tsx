import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/**
 * A choice from a list, as the browser's own select element: it is operated by keyboard and by
 * assistive technology the way every platform expects, also on a phone. Give it a label with
 * `FormField` or `Label`, and its options as children.
 */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className="relative block">
      <select
        className={cn(
          "h-10 w-full cursor-pointer appearance-none rounded-control border border-border-strong bg-background pr-9 pl-3 text-sm text-fg pointer-coarse:h-11",
          "aria-invalid:border-accent-strong",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-fg-muted",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.8}
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-secondary"
      />
    </span>
  );
}
