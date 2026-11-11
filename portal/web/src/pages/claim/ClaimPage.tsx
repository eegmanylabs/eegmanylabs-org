import { claimProfileContract, type PendingRole } from "@eegml/shared";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/auth/return-path";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, useLiveDocument } from "@/data";
import { AccountPanel } from "@/pages/home/AccountPanel";
import { PendingRoleList, ProfileSummary } from "@/pages/home/ProfileSummary";
import { type ClaimCall, type ClaimView, claimView } from "./claim-state";
import { RequestAccessForm } from "./RequestAccessForm";

/** A section of the page whose heading takes focus when it replaces another, so that the outcome is read out. */
function Outcome({ title, focus, children }: { title: string; focus: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  return (
    <section
      aria-labelledby="claim-outcome-heading"
      className="grid gap-4 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="claim-outcome"
    >
      <h2
        id="claim-outcome-heading"
        ref={heading}
        tabIndex={-1}
        className="rounded-control text-lg font-medium tracking-title text-fg-strong"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Signs out, as the account menu does, so that the person can sign in with another address. */
function SignOutButton() {
  const { signOut } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const signOutNow = () => {
    setBusy(true);
    signOut().catch(() => {
      setBusy(false);
      toast.show({ tone: "error", title: "You are still signed in.", description: "Signing out failed. Try again." });
    });
  };
  return (
    <Button disabled={busy} onClick={signOutNow}>
      Sign out and use another address
    </Button>
  );
}

/**
 * Where an account goes after sign-in while it is not linked to a member profile. The page asks
 * the server to match the account's verified address, which the server reads from the sign-in
 * token: nothing typed here is ever used to look anyone up. It then shows exactly one outcome.
 */
export function ClaimPage() {
  const user = useSignedInUser();
  const { access, registration } = useAuth();
  const claim = useLiveDocument("accountClaims", [user.uid]);
  const [call, setCall] = useState<ClaimCall>({ status: "waiting" });
  const [attempt, setAttempt] = useState(0);
  // Whether the outcome has changed since the page opened, so that its heading takes focus.
  const firstView = useRef<ClaimView | null>(null);

  const registered = registration.status === "done";
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    if (!registered) return;
    let current = true;
    setCall({ status: "waiting" });
    callFunction(claimProfileContract, {}).then(
      (result) => current && setCall({ status: "done", result }),
      (error: unknown) =>
        current &&
        setCall({
          status: "failed",
          message: error instanceof CallableError ? error.message : "The portal could not reach its server.",
        }),
    );
    return () => {
      current = false;
    };
  }, [registered, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const personId = access.status === "ready" ? (access.data?.personId ?? null) : null;
  const claimStatus = claim.status === "ready" ? (claim.data?.status ?? null) : null;
  // A decision that arrives while the page is open is asked about again, which also marks its
  // notification as read: the page now shows what the notification says.
  const seenStatus = useRef(claimStatus);
  useEffect(() => {
    if (seenStatus.current !== null && claimStatus !== null && claimStatus !== seenStatus.current) retry();
    seenStatus.current = claimStatus;
  }, [claimStatus, retry]);
  const view = claimView({ personId, claimStatus, call });
  // Once the server says the account is linked, by a match here, by a reviewer's approval that
  // arrived while the page was open, or because it was linked already, the member goes on to
  // Home, which says once that the account is now linked, or back to the page that sent it
  // here. Until the server has answered, a linked access document shows the linked outcome here.
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeReturnPath(params.get("next"));
  const linked = view === "linked" && call.status === "done" && call.result.status === "linked";
  useEffect(() => {
    if (linked)
      navigate(next, { replace: true, ...(next === DEFAULT_RETURN_PATH ? { state: { justLinked: true } } : {}) });
  }, [linked, navigate, next]);
  if (view !== "checking" && firstView.current === null) firstView.current = view;
  const moved = firstView.current !== null && firstView.current !== view;

  return (
    <>
      <PageHeader
        title="Your member profile"
        description="The portal links your account to the profile the programme holds for you, using the email address you signed in with."
      />
      <div className="grid max-w-reading gap-4">
        {registration.status === "failed" ? null : (
          <ClaimOutcome
            view={view}
            focus={moved}
            personId={personId}
            pendingRoles={access.status === "ready" ? (access.data?.pendingRoles ?? []) : []}
            submittedAt={claim.status === "ready" ? (claim.data?.submittedAt.toDate() ?? null) : null}
            statementWanted={
              call.status === "done" && call.result.status === "pendingReview" && !call.result.statementGiven
            }
            failure={call.status === "failed" ? call.message : null}
            onRetry={retry}
            onRequested={retry}
          />
        )}
        <AccountPanel />
      </div>
    </>
  );
}

interface ClaimOutcomeProps {
  view: ClaimView;
  focus: boolean;
  personId: string | null;
  pendingRoles: readonly PendingRole[];
  submittedAt: Date | null;
  /** Whether the review came from an address match and the member has not yet said anything to the reviewer. */
  statementWanted: boolean;
  failure: string | null;
  onRetry: () => void;
  onRequested: () => void;
}

function ClaimOutcome({
  view,
  focus,
  personId,
  pendingRoles,
  submittedAt,
  statementWanted,
  failure,
  onRetry,
  onRequested,
}: ClaimOutcomeProps) {
  switch (view) {
    case "checking":
      return <LoadingState label="Looking for your member profile" />;
    case "failed":
      return (
        <ErrorState
          title="Your profile could not be looked up."
          description={failure ?? "Try again in a moment."}
          action={<Button onClick={onRetry}>Try again</Button>}
        />
      );
    case "linked":
      return (
        <Outcome title="Your account is linked to your profile" focus={focus}>
          <p className="text-fg-secondary">
            This is the profile the programme holds for you. If a detail is wrong, you can report it from Home.
          </p>
          {personId === null ? null : <ProfileSummary personId={personId} />}
          {pendingRoles.length === 0 ? null : (
            <div className="grid gap-2">
              <h3 className="text-md font-medium text-fg-strong">Roles waiting for an administrator</h3>
              <p className="text-fg-secondary">
                The programme's records say you hold these roles. An administrator confirms each one before it gives you
                any rights. You will get a notification when they do.
              </p>
              <PendingRoleList roles={pendingRoles} />
            </div>
          )}
          <div>
            <Button asChild variant="primary">
              <Link to="/">Go to Home</Link>
            </Button>
          </div>
        </Outcome>
      );
    case "review":
      return (
        <Outcome title="An administrator needs to review your account" focus={focus}>
          <p className="text-fg-secondary">
            Your account could not be linked to a profile automatically, so a programme administrator will check it. You
            do not need to do anything else. You will get a notification in the portal when they have decided, and this
            page will show the result.
          </p>
          {submittedAt === null ? null : (
            <p className="text-fg-secondary">
              Sent for review on <time dateTime={submittedAt.toISOString()}>{formatDateTime(submittedAt)}</time>.
            </p>
          )}
          {statementWanted ? (
            <RequestAccessForm
              onSent={onRequested}
              heading="Help the administrator identify you"
              intro="Optional. Anything you add here is shown only to the administrators who review your account."
              submitLabel="Send to the administrator"
            />
          ) : null}
        </Outcome>
      );
    case "rejected":
      return (
        <Outcome title="Your account was not linked" focus={focus}>
          <p className="text-fg-secondary">
            An administrator reviewed your account and did not link it to a profile. If you take part in the programme,
            ask for access below and say how.
          </p>
          <RequestAccessForm onSent={onRequested} />
        </Outcome>
      );
    case "noMatch":
      return (
        <Outcome title="We could not find a profile for this address" focus={focus}>
          <p className="text-fg-secondary">
            No profile in the programme's records carries the address you signed in with. If you usually use another
            address for the programme, sign out and sign in with that one. Otherwise ask for access, and an
            administrator will review your request.
          </p>
          <div>
            <SignOutButton />
          </div>
          <RequestAccessForm onSent={onRequested} />
        </Outcome>
      );
  }
}
