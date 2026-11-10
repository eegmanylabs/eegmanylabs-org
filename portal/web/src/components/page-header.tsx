import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The page title. Sentence case. It is the page's only first-level heading. */
  title: string;
  description?: string;
  /** Controls that act on the whole page. */
  actions?: ReactNode;
}

/** The heading block at the top of every page. Page titles are set in Fraunces. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-2">
        <h1 className="font-serif text-2xl text-fg">{title}</h1>
        {description ? <p className="max-w-reading text-fg-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
