import { Popover as RadixPopover } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export interface PopoverContentProps extends ComponentProps<typeof RadixPopover.Content> {
  /** Names the panel for assistive technology. */
  "aria-label": string;
}

/**
 * A panel that opens from a button and holds controls of its own, such as a list of links.
 * Focus moves into it when it opens and returns to the button when Escape closes it.
 */
export function PopoverContent({ className, sideOffset = 6, collisionPadding = 16, ...props }: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // As with menus: no shadow, so a strong border separates the panel from the page.
        className={cn(
          "z-50 w-[min(24rem,calc(100vw-2rem))] rounded-tile border border-border-strong bg-surface p-2 text-sm text-fg",
          className,
        )}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
