// The route table. Routes are hash-based (#/login), so the application needs no server
// rewrites and works at any address GitHub Pages serves it from.
//
// To add a page: add its route here with a `handle.title`, and, if it belongs in the sidebar,
// one entry in navigation.ts.
import { createHashRouter, type RouteObject } from "react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { HomePage } from "@/pages/home/HomePage";
import { LoginPage } from "@/pages/login/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { Root } from "./Root";
import { RouteError } from "./RouteError";
import type { RouteHandle } from "./route-meta";
import { AppShell } from "./shell/AppShell";

const titled = (title: string): { handle: RouteHandle } => ({ handle: { title } });

export function portalRoutes(signInLink: string | null): RouteObject[] {
  return [
    {
      element: <Root signInLink={signInLink} />,
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
              children: [{ index: true, element: <HomePage />, ...titled("Home") }],
            },
          ],
        },
        { path: "*", element: <NotFoundPage />, ...titled("Page not found") },
      ],
    },
  ];
}

/** `signInLink` is the sign-in link the page was opened from, if any (see captureSignInLink). */
export function createPortalRouter(signInLink: string | null) {
  return createHashRouter(portalRoutes(signInLink));
}
