import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link } from "react-router";
import logo from "@/assets/logo.png";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/utils/cn";
import { SidebarNav } from "./SidebarNav";
import { SidebarShortcuts } from "./SidebarShortcuts";
import { SidebarWorkspace } from "./SidebarWorkspace";

export const SIDEBAR_ID = "portal-sidebar";

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** The persistent sidebar of wide screens. Narrow screens use `MobileNavigation` instead. */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      id={SIDEBAR_ID}
      aria-label="Sidebar"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r border-border bg-surface-muted p-2 transition-[width] md:flex",
        collapsed ? "w-(--shell-sidebar-rail)" : "w-(--shell-sidebar)",
      )}
    >
      <div className={cn("flex h-10 items-center", collapsed ? "justify-center" : "justify-between gap-2 pl-2")}>
        {collapsed ? null : (
          <Link to="/" aria-label="EEGManyLabs members' portal, home" className="rounded-control">
            <img src={logo} alt="" width={1600} height={355} className="h-7 w-auto" />
          </Link>
        )}
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls={SIDEBAR_ID}
          tooltipSide="right"
          onClick={onToggle}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <PanelLeftClose aria-hidden="true" strokeWidth={1.8} />
          )}
        </IconButton>
      </div>
      <div className="grid min-h-0 content-start gap-0 overflow-y-auto">
        <SidebarNav collapsed={collapsed} />
        {collapsed ? null : <SidebarWorkspace />}
        {collapsed ? null : <SidebarShortcuts />}
      </div>
    </aside>
  );
}
