import { DropdownMenu as RadixMenu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/**
 * A menu that opens from a button. It is not modal: the rest of the page stays available to
 * assistive technology, and the menu closes as soon as focus or a click goes elsewhere.
 */
export function DropdownMenu(props: ComponentProps<typeof RadixMenu.Root>) {
  return <RadixMenu.Root modal={false} {...props} />;
}
export const DropdownMenuTrigger = RadixMenu.Trigger;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        sideOffset={sideOffset}
        // With no shadow to lift the menu off the page, a strong border separates the layers.
        className={cn(
          "z-50 min-w-48 rounded-tile border border-border-strong bg-surface p-1 text-sm text-fg",
          className,
        )}
        {...props}
      />
    </RadixMenu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof RadixMenu.Item>) {
  return (
    <RadixMenu.Item
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2 rounded-control px-2.5 text-fg-secondary select-none",
        // The focused item is the highlighted one. The outline sits inside so the menu's edge does not clip it.
        "outline-focus data-highlighted:bg-surface-muted data-highlighted:text-fg data-highlighted:outline-2 data-highlighted:-outline-offset-2",
        "data-disabled:cursor-not-allowed data-disabled:text-fg-muted [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof RadixMenu.Label>) {
  return <RadixMenu.Label className={cn("px-2.5 py-2 text-xs text-fg-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof RadixMenu.Separator>) {
  return <RadixMenu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
