import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/**
 * A short, non-interactive label. Meaning is always in the text: tone only supports it.
 *
 * | Tone      | Use for                                           |
 * |-----------|---------------------------------------------------|
 * | `neutral` | Categories and ordinary states. The default.      |
 * | `accent`  | States that deserve attention                     |
 * | `outline` | Secondary facts, such as where a value came from  |
 * | `solid`   | The one state on a view that matters most         |
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-transparent bg-tag-neutral-bg text-tag-neutral-fg",
        accent: "border-transparent bg-tag-accent-bg text-tag-accent-fg",
        outline: "border-border bg-background text-fg-secondary",
        solid: "border-accent-strong bg-accent-strong text-fg-on-accent",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
