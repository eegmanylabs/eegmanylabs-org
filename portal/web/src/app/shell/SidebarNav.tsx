import { NavLink } from "react-router";
import { visibleNavigation } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/utils/cn";

export interface SidebarNavProps {
  /** Show icons only. Labels stay available to assistive technology and as tooltips. */
  collapsed?: boolean;
  /** Called when a destination is chosen, so an overlay that contains the list can close. */
  onNavigate?: () => void;
}

/** The list of destinations from the navigation registry that the account may see. */
export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const { capabilities } = useAuth();
  return (
    <nav aria-label="Main">
      <ul className="grid gap-1">
        {visibleNavigation(capabilities).map((entry) => {
          const link = (
            <NavLink
              to={entry.to}
              end
              {...(onNavigate ? { onClick: onNavigate } : {})}
              className={cn(
                "relative flex h-9 items-center gap-3 rounded-control text-fg-secondary transition-colors hover:bg-surface hover:text-fg",
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
    </nav>
  );
}
