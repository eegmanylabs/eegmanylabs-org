import type { ReactNode } from "react";
import { restartApplication } from "@/app/restart";
import { type RegistrationState, useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type AccessRecord, type Live, retryFailedLiveData, type UserRecord, useUserRecord } from "@/data";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short" });

interface AccountRecords {
  readonly user: UserRecord;
  readonly access: AccessRecord;
}

/**
 * One live value from the two documents. Both are created by the server shortly after the
 * first sign-in, so "not there yet" is treated as loading.
 */
function combine(user: Live<UserRecord | null>, access: Live<AccessRecord | null>): Live<AccountRecords> {
  if (user.status === "error") return user;
  if (access.status === "error") return access;
  if (user.status !== "ready" || access.status !== "ready" || user.data === null || access.data === null) {
    return { status: "loading" };
  }
  return {
    status: "ready",
    data: { user: user.data, access: access.data },
    fromCache: user.fromCache || access.fromCache,
    hasPendingWrites: user.hasPendingWrites || access.hasPendingWrites,
  };
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-fg-muted">{term}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function AccountSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-4 w-48 max-w-full" />
      <Skeleton className="h-4 w-56 max-w-full" />
    </div>
  );
}

/**
 * Why the server would not start a session for this account, and what the person can do. The
 * message comes from the server when it wrote one for the person, and is a general text
 * otherwise, so it can be shown as it stands.
 */
function RegistrationFailure({ failure }: { failure: Extract<RegistrationState, { status: "failed" }> }) {
  const { retryRegistration, signOut } = useAuth();
  if (failure.code === "permission-denied") {
    // For example a suspended account. The page has let go of the account's data by now, so
    // trying again means starting afresh. The button is for the day the suspension is lifted.
    return (
      <ErrorState
        title="This account cannot use the portal at the moment."
        description={failure.message}
        action={<Button onClick={() => restartApplication()}>Try again</Button>}
      />
    );
  }
  if (failure.code === "unauthenticated") {
    return (
      <ErrorState
        title="You need to sign in again."
        description={failure.message}
        action={<Button onClick={() => void signOut().catch(() => {})}>Sign out</Button>}
      />
    );
  }
  return (
    <ErrorState
      title="Your account could not be registered."
      description={failure.message}
      action={
        <Button
          onClick={() => {
            // Asks the server again, and opens the listeners again that have given up meanwhile.
            retryRegistration();
            retryFailedLiveData();
          }}
        >
          Try again
        </Button>
      }
    />
  );
}

/** Who is signed in and whether the account is linked to a member profile. Real data only. */
export function AccountPanel() {
  const signedIn = useSignedInUser();
  const { access, registration } = useAuth();
  const user = useUserRecord(signedIn.uid);

  return (
    <section aria-labelledby="account-panel-heading" className="rounded-card border border-border bg-surface px-5 py-4">
      <h2 id="account-panel-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Your account
      </h2>
      {/* One offset for every state of the panel: loading, failed and ready. */}
      <div className="mt-3">
        {registration.status === "failed" ? (
          <RegistrationFailure failure={registration} />
        ) : (
          <LiveView
            live={combine(user, access)}
            loadingLabel="Loading your account"
            loading={<AccountSkeleton />}
            errorTitle="Your account could not be loaded."
            onRetry={retryFailedLiveData}
          >
            {(records) => <AccountDetails records={records} />}
          </LiveView>
        )}
      </div>
    </section>
  );
}

function AccountDetails({ records }: { records: AccountRecords }) {
  return (
    <dl className="-my-3" data-testid="account-details">
      <Row term="Signed in as">
        {/* Address and label wrap as one group, so a wrapped label lines up with the address. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all">{records.user.emailLower}</span>
          {records.user.dataOrigin === "demo" ? <Badge tone="outline">Demonstration data</Badge> : null}
        </span>
      </Row>
      {records.user.displayName ? <Row term="Name">{records.user.displayName}</Row> : null}
      <Row term="Account status">{records.user.status === "active" ? "Active" : "Suspended"}</Row>
      <Row term="Member profile">
        {records.access.personId === null ? (
          <>
            <Badge tone="neutral">Not linked yet</Badge>
            <p className="mt-1.5 text-fg-secondary">
              You are signed in, but this account has not been matched to a person in the programme's records.
            </p>
          </>
        ) : (
          <Badge tone="accent">Linked to a member profile</Badge>
        )}
      </Row>
      <Row term="Last sign-in recorded">
        <time dateTime={records.user.lastSeenAt.toDate().toISOString()}>
          {dateTime.format(records.user.lastSeenAt.toDate())}
        </time>
      </Row>
    </dl>
  );
}
