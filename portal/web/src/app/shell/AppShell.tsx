import { Outlet } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { AccountMenu } from "./AccountMenu";
import { Breadcrumbs } from "./Breadcrumbs";
import { ConnectionBanner } from "./ConnectionBanner";
import { MobileNavigation } from "./MobileNavigation";
import { NotificationBell } from "./NotificationBell";
import { Sidebar } from "./Sidebar";
import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

/**
 * The frame around every signed-in page: sidebar, top bar with breadcrumbs, notifications and
 * the account menu, and the main region that the current route renders into.
 *
 * For an account that the server refuses, a suspended one, the shell offers no navigation and
 * no notifications: nothing behind them would open. The account menu stays, for signing out.
 */
export function AppShell() {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const { registration } = useAuth();
  const refused = registration.status === "failed" && registration.code === "permission-denied";
  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      {refused ? null : <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--shell-topbar) items-center gap-3 border-b border-border bg-background px-4">
          {refused ? null : <MobileNavigation />}
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            {refused ? null : <NotificationBell />}
            <AccountMenu />
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8">
          <div className="mx-auto w-full max-w-content">
            <ConnectionBanner />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
