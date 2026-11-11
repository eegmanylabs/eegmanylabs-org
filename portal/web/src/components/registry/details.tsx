import type { ReactNode } from "react";

/** A list of terms and their values, one per row, in the dense layout of the registry. */
export function Details({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={className ?? "grid gap-0"}>{children}</dl>;
}

export function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-border py-2 last:border-b-0 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-fg-muted">{term}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}
