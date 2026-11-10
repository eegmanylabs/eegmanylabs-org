import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { LoadingState } from "@/components/feedback/loading-state";
import { useAuth } from "./AuthProvider";
import { signInPathFor } from "./return-path";

/**
 * Shows its children to signed-in visitors only. Anyone else is sent to the sign-in page,
 * which brings them back to the page they asked for.
 *
 * This is a convenience, not a control: a signed-out visitor who got past it would still be
 * refused every read by the security rules.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, link } = useAuth();
  const location = useLocation();

  if (session.status === "loading" || link.status === "completing") {
    return <LoadingState label="Checking your sign-in" size="page" />;
  }
  if (session.status === "signed-out") {
    return <Navigate to={signInPathFor(`${location.pathname}${location.search}`)} replace />;
  }
  return <>{children}</>;
}
