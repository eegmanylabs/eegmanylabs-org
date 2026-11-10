import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface EmptyStateProps {
  /** What is missing, in a few words. */
  title: string;
  /** Why it is missing, or what would make something appear here. */
  description?: string;
  /** One control that helps, for example a button that adds the first item. */
  action?: ReactNode;
  className?: string;
}

/** Shown where a list or a view has nothing to show. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("rounded-card border border-dashed border-border-strong bg-surface p-7 text-fg-muted", className)}
    >
      <p className="font-medium text-fg-strong">{title}</p>
      {description ? <p className="mt-1">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
