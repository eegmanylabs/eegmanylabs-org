import type { ReactNode } from "react";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type AccessRecord, type Live, type UserRecord, useUserRecord } from "@/data";

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
    <div className="grid gap-4 py-3">
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-4 w-48 max-w-full" />
      <Skeleton className="h-4 w-56 max-w-full" />
    </div>
  );
}

/** Who is signed in and whether the account is linked to a member profile. Real data only. */
export function AccountPanel() {
  const signedIn = useSignedInUser();
  const { access, registration, retryRegistration } = useAuth();
  const user = useUserRecord(signedIn.uid);

  return (
    <section aria-labelledby="account-panel-heading" className="rounded-card border border-border bg-surface px-5 py-4">
      <h2 id="account-panel-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Your account
      </h2>
      {registration === "failed" ? (
        <ErrorState
          className="mt-3"
          title="Your account could not be registered."
          description="The portal could not record your sign-in, so it cannot show your account yet."
          action={<Button onClick={retryRegistration}>Try again</Button>}
        />
      ) : (
        <LiveView
          live={combine(user, access)}
          loadingLabel="Loading your account"
          loading={<AccountSkeleton />}
          errorTitle="Your account could not be loaded."
        >
          {(records) => (
            <dl className="mt-1" data-testid="account-details">
              <Row term="Signed in as">
                <span className="break-all">{records.user.emailLower}</span>
                {records.user.dataOrigin === "demo" ? (
                  <Badge tone="outline" className="ml-2">
                    Demonstration data
                  </Badge>
                ) : null}
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
          )}
        </LiveView>
      )}
    </section>
  );
}
