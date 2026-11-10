// The route table. Routes are hash-based (#/login), so the application needs no server
// rewrites and works at any address GitHub Pages serves it from.
//
// To add a page: add its route here with a `handle.title`, and, if it belongs in the sidebar,
// one entry in navigation.ts.
import type { ComponentType } from "react";
import { createHashRouter, type RouteObject } from "react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { LoadingState } from "@/components/feedback/loading-state";
import { ClaimPage } from "@/pages/claim/ClaimPage";
import { HomePage } from "@/pages/home/HomePage";
import { LoginPage } from "@/pages/login/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { Root } from "./Root";
import { RouteError } from "./RouteError";
import type { RouteHandle } from "./route-meta";
import { AppShell } from "./shell/AppShell";

const titled = (title: string): { handle: RouteHandle } => ({ handle: { title } });

// The sign-in page, Home and the claim page are in the first bundle, because every visit starts
// with one of them. The account page and the administration console load when first opened,
// so that a member on a slow connection waits for less.
const lazyPage = (load: () => Promise<ComponentType>): Pick<RouteObject, "lazy"> => ({
  lazy: async () => ({ Component: await load() }),
});

/**
 * Routes of emulator builds only. Vite replaces `import.meta.env.MODE` with the mode's name
 * when it builds, so in staging and production this list is empty and the pages it names are
 * left out of the bundle. portal/tests/architecture/production-build.test.ts builds for production and
 * checks that.
 */
const emulatorRoutes: RouteObject[] =
  import.meta.env.MODE === "emulator"
    ? [
        {
          // Every interface primitive on one page, for the browser tests.
          path: "/dev/components",
          lazy: async () => ({ Component: (await import("@/pages/dev/ComponentsPage")).ComponentsPage }),
          ...titled("Interface components"),
        },
      ]
    : [];

export function portalRoutes(signInLink: string | null): RouteObject[] {
  return [
    {
      element: <Root signInLink={signInLink} />,
      // Shown while the first page of a visit loads, when it is one that loads on demand.
      hydrateFallbackElement: <LoadingState label="Loading the members' portal" size="page" />,
      // Catches a failure in the frame itself. Failures inside a page are caught further down.
      errorElement: <RouteError />,
      children: [
        { path: "/login", element: <LoginPage />, ...titled("Sign in") },
        {
          // Everything in here needs a signed-in account and is shown inside the shell.
          element: (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          ),
          children: [
            {
              // A page that fails is replaced by an error message. The shell stays usable.
              errorElement: <RouteError />,
              children: [
                { index: true, element: <HomePage />, ...titled("Home") },
                { path: "/claim", element: <ClaimPage />, ...titled("Your member profile") },
                {
                  path: "/account",
                  ...lazyPage(async () => (await import("@/pages/account/AccountPage")).AccountPage),
                  ...titled("Account and security"),
                },
                // Each page of the console checks the capability of its navigation entry itself
                // (AdminPage), so typing the address opens nothing more than the sidebar shows.
                {
                  path: "/admin/claims",
                  ...lazyPage(async () => (await import("@/pages/admin/ClaimsPage")).ClaimsPage),
                  ...titled("Account claims"),
                },
                {
                  path: "/admin/lab-claims",
                  ...lazyPage(async () => (await import("@/pages/admin/LabClaimsPage")).LabClaimsPage),
                  ...titled("Laboratory claims"),
                },
                {
                  path: "/admin/corrections",
                  ...lazyPage(async () => (await import("@/pages/admin/CorrectionsPage")).CorrectionsPage),
                  ...titled("Correction requests"),
                },
                {
                  path: "/admin/users",
                  ...lazyPage(async () => (await import("@/pages/admin/UsersPage")).UsersPage),
                  ...titled("Users"),
                },
                {
                  path: "/admin/roles",
                  ...lazyPage(async () => (await import("@/pages/admin/RolesPage")).RolesPage),
                  ...titled("Roles and capabilities"),
                },
                {
                  path: "/admin/audit",
                  ...lazyPage(async () => (await import("@/pages/admin/AuditPage")).AuditPage),
                  ...titled("Audit log"),
                },
              ],
            },
          ],
        },
        ...emulatorRoutes,
        { path: "*", element: <NotFoundPage />, ...titled("Page not found") },
      ],
    },
  ];
}

/** `signInLink` is the sign-in link the page was opened from, if any (see captureSignInLink). */
export function createPortalRouter(signInLink: string | null) {
  return createHashRouter(portalRoutes(signInLink));
}
