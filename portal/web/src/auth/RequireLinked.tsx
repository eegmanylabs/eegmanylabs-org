import { Link, Outlet, useLocation } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { retryFailedLiveData } from "@/data";
import { useAuth } from "./AuthProvider";

/** The address of the claim page that brings the account back to `path` once it is linked. */
export function claimPathFor(path: string): string {
  return `/claim?next=${encodeURIComponent(path)}`;
}

/**
 * Shows the pages of the registry only to an account that is linked to a member profile, as
 * the navigation lists them (`audience: "linked"`), whatever address was typed or followed. An
 * account that is not linked is sent to link itself, with the address it wanted kept, instead
 * of waiting for reads that the rules refuse.
 *
 * This is a convenience for the reader. The security rules refuse the reads of these pages to
 * an account that is not linked in any case.
 */
export function RequireLinked() {
  const { access } = useAuth();
  const location = useLocation();
  if (access.status === "error") {
    return (
      <ErrorState
        title="Your access could not be checked."
        description="Check your connection, then try again."
        action={<Button onClick={retryFailedLiveData}>Try again</Button>}
      />
    );
  }
  if (access.status !== "ready") return <LoadingState label="Checking your access" />;
  if (access.data?.personId != null) return <Outlet />;
  return (
    <ErrorState
      title="Link your account to your member profile to see this page."
      description="This page shows the programme's records, which members read once their account is linked to their profile."
      action={
        <Button asChild variant="primary">
          <Link to={claimPathFor(`${location.pathname}${location.search}`)}>Link your account</Link>
        </Button>
      }
    />
  );
}
