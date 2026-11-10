import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/** A placeholder with the size of the content that is loading. Size it with a class name. */
export function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-control bg-surface-muted", className)}
      {...props}
    />
  );
}
