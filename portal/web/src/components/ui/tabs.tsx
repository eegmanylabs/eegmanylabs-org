import { Tabs as RadixTabs } from "radix-ui";
import { type ComponentProps, useCallback } from "react";
import { cn } from "@/utils/cn";

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("flex gap-5 border-b border-border", className)} {...props} />;
}

/**
 * The current tab is marked the way the public site marks the current page: a coral underline.
 * A tab draws its focus ring inside itself, so that a list that scrolls sideways on a narrow
 * screen does not cut the ring off, and the tab that is current when the list appears is
 * scrolled into the list's view.
 */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  // The list is scrolled by hand rather than with scrollIntoView, which would also move the point
  // that the Tab key starts from to this tab, past the skip link and the navigation.
  const reveal = useCallback((element: HTMLButtonElement | null) => {
    const list = element?.parentElement;
    if (element === null || list === null || list === undefined || element.getAttribute("data-state") !== "active") {
      return;
    }
    const offset = element.getBoundingClientRect().left - list.getBoundingClientRect().left;
    if (offset < 0) list.scrollLeft += offset;
    else if (offset + element.offsetWidth > list.clientWidth) {
      list.scrollLeft += offset + element.offsetWidth - list.clientWidth;
    }
  }, []);
  return (
    <RadixTabs.Trigger
      ref={reveal}
      className={cn(
        "-mb-px h-10 cursor-pointer rounded-control border-b-2 border-transparent px-1 text-md text-fg-secondary transition-colors hover:text-fg",
        "focus-visible:outline-offset-[-3px]",
        "data-[state=active]:border-accent data-[state=active]:text-fg",
        "disabled:cursor-not-allowed disabled:text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn("pt-4", className)} {...props} />;
}
