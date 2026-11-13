import { Link, Outlet, useLocation } from "react-router";
import { useCrumbs } from "@/app/route-meta";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
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
 * The refusal keeps the title of the section that was asked for as the page's heading, as every
 * other guarded route does, so that a screen reader lands on a page with a level-one heading.
 *
 * This is a convenience for the reader. The security rules refuse the reads of these pages to
 * an account that is not linked in any case.
 */
export function RequireLinked() {
  const { access } = useAuth();
  const location = useLocation();
  const section = useCrumbs()[0]?.title ?? "Members only";
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
    <>
      <PageHeader title={section} />
      <ErrorState
        title="Link your account to your member profile to see this page."
        description="This page shows the programme's records, which members read once their account is linked to their profile."
        action={
          <Button asChild variant="primary">
            <Link to={claimPathFor(`${location.pathname}${location.search}`)}>Link your account</Link>
          </Button>
        }
      />
    </>
  );
}
