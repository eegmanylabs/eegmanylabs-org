import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/** A text field of several lines. Give it a label with `FormField` or `Label`. */
export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(
        "w-full resize-y rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-fg",
        "placeholder:text-fg-muted aria-invalid:border-accent-strong",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
