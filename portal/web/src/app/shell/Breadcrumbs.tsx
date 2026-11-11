import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { useCrumbs } from "@/app/route-meta";
import { rememberedListPath } from "@/registry/url-state";

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
            <Fragment key={crumb.path}>
              {crumb.Trail === undefined ? null : <crumb.Trail params={crumb.params} />}
              <li className="flex min-w-0 items-center gap-1.5">
                {index > 0 ? (
                  <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.8} />
                ) : null}
                {current ? (
                  <span aria-current="page" className="truncate font-medium text-fg">
                    {crumb.Label === undefined ? crumb.title : <crumb.Label params={crumb.params} />}
                  </span>
                ) : (
                  // A list is reached again with the search and filters it had in this session.
                  <Link
                    to={rememberedListPath(crumb.path)}
                    className="truncate rounded-control text-fg-secondary hover:text-fg-accent"
                  >
                    {crumb.Label === undefined ? crumb.title : <crumb.Label params={crumb.params} />}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** A crumb of a trail: a link that leads towards the current page, after a separator unless it is the first. */
export function TrailCrumb({
  to,
  first = false,
  children,
}: {
  readonly to: string;
  readonly first?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-1.5">
      {first ? null : <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.8} />}
      <Link to={to} className="truncate rounded-control text-fg-secondary hover:text-fg-accent">
        {children}
      </Link>
    </li>
  );
}
