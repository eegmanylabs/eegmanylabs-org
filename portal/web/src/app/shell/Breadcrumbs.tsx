import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { useCrumbs } from "@/app/route-meta";

/** Where the current page sits, from the titles of the matched routes. */
export function Breadcrumbs() {
  const crumbs = useCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-md">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.8} />
              ) : null}
              {current ? (
                <span aria-current="page" className="truncate font-medium text-fg">
                  {crumb.title}
                </span>
              ) : (
                <Link to={crumb.path} className="truncate rounded-control text-fg-secondary hover:text-fg-accent">
                  {crumb.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
