import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/**
 * | Variant   | Use for                                                        |
 * |-----------|----------------------------------------------------------------|
 * | `primary` | The one main action of a view. Deep coral with a white label.  |
 * | `outline` | Every other action. The default.                               |
 * | `ghost`   | Actions inside toolbars and menus, where a border would be noise. |
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control border font-medium whitespace-nowrap",
    "transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
    "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-fg-muted",
  ],
  {
    variants: {
      variant: {
        primary:
          "border-accent-strong bg-accent-strong text-fg-on-accent hover:border-accent-strong-hover hover:bg-accent-strong-hover",
        outline: "border-border-emphasis bg-transparent text-fg-strong hover:border-accent-strong hover:text-fg-accent",
        ghost: "border-transparent bg-transparent text-fg-secondary hover:bg-surface-muted hover:text-fg",
      },
      // A finger needs a larger target than a mouse pointer: 44px wherever the pointer is coarse.
      size: {
        sm: "h-8.5 px-3 text-sm pointer-coarse:h-11 pointer-coarse:min-w-11",
        md: "h-10 px-4 text-sm pointer-coarse:h-11 pointer-coarse:min-w-11",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the child element with the button's appearance, for example a link. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot.Root className={classes} {...props} />;
  return <button type={type ?? "button"} className={classes} {...props} />;
}
