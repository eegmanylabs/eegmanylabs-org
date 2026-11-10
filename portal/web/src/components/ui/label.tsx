import { Label as RadixLabel } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

export function Label({ className, ...props }: ComponentProps<typeof RadixLabel.Root>) {
  return <RadixLabel.Root className={cn("text-sm font-medium text-fg-secondary", className)} {...props} />;
}
