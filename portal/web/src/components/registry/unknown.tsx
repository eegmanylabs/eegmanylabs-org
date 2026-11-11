import type { ReactNode } from "react";

/** Stands where a value is not recorded. An unknown is said in words and is never shown as zero. */
export function Unknown({ children = "Not recorded" }: { children?: ReactNode }) {
  return <span className="text-fg-muted">{children}</span>;
}
