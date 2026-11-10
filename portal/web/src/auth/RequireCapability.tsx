import type { Capability } from "@eegml/shared";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { retryFailedLiveData } from "@/data";
import { useAuth } from "./AuthProvider";
import { decidePrivilege } from "./privilege";
import { SecondFactorPrompt } from "./SecondFactorPrompt";
import { usePrivilegeFacts } from "./use-privilege";

export interface RequireCapabilityProps {
  capability: Capability;
  /** The title of the page, shown above a refusal or a prompt so that the reader knows where they are. */
  title: string;
  children: ReactNode;
}

/**
 * Shows a page only to an account whose access document holds the capability, whatever address
 * was typed. An account that would hold it once its second factor is in place is asked for
 * that instead.
 *
 * This is a convenience for the reader. The security rules and the callable functions refuse
 * the page's reads and actions to an account without the capability in any case.
 */
export function RequireCapability({ capability, title, children }: RequireCapabilityProps) {
  const { access } = useAuth();
  const facts = usePrivilegeFacts();
  if (access.status === "error") {
    return (
      <>
        <PageHeader title={title} />
        <ErrorState
          title="Your access could not be checked."
          description="Reload the page to try again."
          action={<Button onClick={retryFailedLiveData}>Try again</Button>}
        />
      </>
    );
  }
  if (facts === null) return <LoadingState label="Checking your access" />;
  const decision = decidePrivilege(facts, capability);
  if (decision === "allowed") return <>{children}</>;
  return (
    <>
      <PageHeader title={title} />
      {decision === "denied" ? (
        <ErrorState
          title="You do not have access to this page."
          description="Your account does not hold the role this page needs. If you think it should, contact a programme administrator."
        />
      ) : (
        <SecondFactorPrompt kind={decision === "enrol-factor" ? "enrol" : "sign-in"} />
      )}
    </>
  );
}
