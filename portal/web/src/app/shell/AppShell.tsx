import { Outlet } from "react-router";
import { AccountMenu } from "./AccountMenu";
import { Breadcrumbs } from "./Breadcrumbs";
import { MobileNavigation } from "./MobileNavigation";
import { Sidebar } from "./Sidebar";
import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

/**
 * The frame around every signed-in page: sidebar, top bar with breadcrumbs and the account
 * menu, and the main region that the current route renders into.
 */
export function AppShell() {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-(--shell-topbar) items-center gap-3 border-b border-border bg-background px-4">
          <MobileNavigation />
          <Breadcrumbs />
          <div className="ml-auto">
            <AccountMenu />
          </div>
        </header>
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8">
          <div className="mx-auto w-full max-w-content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
