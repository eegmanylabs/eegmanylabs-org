import { Fragment } from "react";
import { NavLink } from "react-router";
import { NAVIGATION_GROUP_LABELS, NAVIGATION_GROUPS, visibleNavigation } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { useNavigableCapabilities } from "@/auth/use-privilege";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

export interface SidebarNavProps {
  /** Show icons only. Labels stay available to assistive technology and as tooltips. */
  collapsed?: boolean;
  /** Called when a destination is chosen, so an overlay that contains the list can close. */
  onNavigate?: () => void;
}

/**
 * The list of destinations from the navigation registry that the account may see, in groups.
 * A destination that waits for the account's second factor is listed, and its page says what
 * to do.
 */
export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const { access } = useAuth();
  const linked = access.status !== "ready" || access.data?.personId != null;
  const entries = visibleNavigation(useNavigableCapabilities(), undefined, linked);
  return (
    <nav aria-label="Main">
      {NAVIGATION_GROUPS.map((group) => {
        const inGroup = entries.filter((entry) => entry.group === group);
        if (inGroup.length === 0) return null;
        const headingId = `navigation-group-${group}`;
        return (
          <Fragment key={group}>
            {group === "main" ? null : (
              <h2
                id={headingId}
                className={cn(
                  "mt-5 mb-1 px-3 text-micro font-medium tracking-label text-fg-muted",
                  collapsed && "sr-only",
                )}
              >
                {NAVIGATION_GROUP_LABELS[group]}
              </h2>
            )}
            <ul className="grid gap-1" {...(group === "main" ? {} : { "aria-labelledby": headingId })}>
              {inGroup.map((entry) => {
                const link = (
                  <NavLink
                    to={entry.to}
                    end
                    {...(onNavigate ? { onClick: onNavigate } : {})}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-control text-fg-secondary transition-colors hover:bg-surface hover:text-fg pointer-coarse:h-11",
                      // The current page: darker text on white, with a coral bar on the left edge.
                      "aria-[current=page]:bg-surface aria-[current=page]:font-medium aria-[current=page]:text-fg",
                      "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-pill aria-[current=page]:before:bg-accent",
                      collapsed ? "justify-center px-0" : "px-3",
                    )}
                  >
                    <entry.icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    <span className={cn(collapsed && "sr-only")}>{entry.label}</span>
                  </NavLink>
                );
                return (
                  <li key={entry.id}>
                    {collapsed ? (
                      <Tooltip content={entry.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </Fragment>
        );
      })}
    </nav>
  );
}
