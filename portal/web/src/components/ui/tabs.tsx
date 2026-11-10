import { Tabs as RadixTabs } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("flex gap-5 border-b border-border", className)} {...props} />;
}

/** The current tab is marked the way the public site marks the current page: a coral underline. */
export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "-mb-px h-10 cursor-pointer border-b-2 border-transparent text-md text-fg-secondary transition-colors hover:text-fg",
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
