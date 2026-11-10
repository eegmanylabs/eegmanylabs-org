import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { HOME_PANELS } from "./panels";

/** Whether the claim page sent the account here just after linking it. */
function cameFromLink(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { justLinked?: unknown }).justLinked === true;
}

/** Says once, after a match has linked the account, that it is linked. */
function JustLinkedPanel() {
  return (
    <section
      aria-labelledby="just-linked-heading"
      className="grid gap-2 rounded-card border border-accent bg-surface-accent px-5 py-4"
      data-testid="just-linked"
    >
      <h2 id="just-linked-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Account linked
      </h2>
      <p className="text-fg-secondary">
        Your account is now linked to the member profile the programme holds for you. Below is the profile the programme
        holds for you. If a detail is wrong, report it from your profile. Roles that the programme's records give you
        wait for an administrator before they give you any rights.
      </p>
    </section>
  );
}

export function HomePage() {
  const { access, capabilities, registration } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Read once: the panel stays for this visit, and the state is dropped so that a reload does not show it again.
  const [justLinked] = useState(() => cameFromLink(location.state));
  useEffect(() => {
    if (cameFromLink(location.state)) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);
  // An account that is not linked to a member profile has nothing to see here yet: it goes to
  // the page that links it. Until the access document says which it is, Home waits. A refused
  // or suspended account stays, so that Home can say why it cannot act.
  const refused = access.status === "error" || registration.status === "failed";
  if (!refused && (access.status === "loading" || (access.status === "ready" && access.data === null))) {
    return <LoadingState label="Loading your account" />;
  }
  if (access.status === "ready" && access.data !== null && access.data.personId === null && !access.data.suspended) {
    return <Navigate to="/claim" replace />;
  }
  const panels = HOME_PANELS.filter((panel) => capabilities.has(panel.requires)).sort((a, b) => a.order - b.order);
  return (
    <>
      <PageHeader title="Home" />
      <div className="grid max-w-reading gap-4">
        {justLinked ? <JustLinkedPanel /> : null}
        {panels.map((panel) => (
          <panel.Component key={panel.id} />
        ))}
      </div>
    </>
  );
}
