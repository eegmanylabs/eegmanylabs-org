import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/** A single-line text field. Give it a label with `FormField` or `Label`. */
export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "h-10 w-full rounded-control border border-border-strong bg-background px-3 text-sm text-fg",
        "placeholder:text-fg-muted aria-invalid:border-accent-strong",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
