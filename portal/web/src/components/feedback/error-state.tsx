import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

export interface ErrorStateProps {
  /** What went wrong, in a few words. */
  title: string;
  /** What it means for the person and what they can do. */
  description?: string;
  /** One control that helps, for example a button that tries again. */
  action?: ReactNode;
  className?: string;
}

/** The one way the portal says that something failed. */
export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-r-card border-l-4 border-accent bg-surface-accent p-4 text-fg", className)}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-accent" strokeWidth={1.8} />
      <div className="grid gap-1">
        <p className="font-medium text-fg-strong">{title}</p>
        {description ? <p className="text-fg-secondary">{description}</p> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
