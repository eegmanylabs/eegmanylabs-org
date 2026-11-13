import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ROLE_LABELS } from "@/app/labels";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { programmePowersWithheld } from "@/auth/privilege";
import { usePrivilegeFacts } from "@/auth/use-privilege";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { PersonName, ScopeName } from "@/components/record-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { type AccessRecord, CallableError, retryFailedLiveData } from "@/data";
import { NotificationPreferences } from "./NotificationPreferences";
import { SecondFactorSection } from "./SecondFactorSection";

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-fg-muted">{term}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4">
      <h2 id={id} className="text-lg font-medium tracking-title text-fg-strong">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface HeldRole {
  readonly key: string;
  readonly label: string;
  readonly scope: ReactNode;
  /** Whether it is a programme role, whose powers need the second factor. */
  readonly programme: boolean;
}

/** The roles in effect, from the access document: the one record of them that an account may read. */
export function heldRoles(access: AccessRecord): HeldRole[] {
  const scoped = (role: keyof typeof ROLE_LABELS, scopeType: string, ids: readonly string[]) =>
    ids.map((id) => ({
      key: `${role} ${id}`,
      label: ROLE_LABELS[role],
      scope: <ScopeName scopeType={scopeType} scopeId={id} />,
      programme: false,
    }));
  return [
    ...access.programmeRoles.map((role) => ({
      key: role,
      label: ROLE_LABELS[role],
      scope: <>the programme</>,
      programme: true,
    })),
    ...scoped("replication_lead", "replication", access.leadReplicationIds),
    ...scoped("lab_coordinator", "laboratory", access.coordinatorLaboratoryIds),
    ...scoped("lab_member", "laboratory", access.memberLaboratoryIds),
  ];
}

function RolesList({ access }: { access: AccessRecord }) {
  const facts = usePrivilegeFacts();
  const withheld = facts !== null && programmePowersWithheld(facts);
  const roles = heldRoles(access);
  return (
    <div className="grid gap-3">
      {roles.length === 0 ? (
        <p className="text-fg-secondary">Your account holds no role yet.</p>
      ) : (
        <ul className="grid gap-2" data-testid="active-roles">
          {roles.map((role) => (
            <li key={role.key} className="flex flex-wrap items-center gap-2">
              <span>
                <span className="font-medium text-fg-strong">{role.label}</span> for {role.scope}
              </span>
              {withheld && role.programme ? <Badge tone="accent">Waiting for your second factor</Badge> : null}
            </li>
          ))}
        </ul>
      )}
      {access.pendingRoles.length === 0 ? null : (
        <div className="grid gap-2 border-t border-border pt-3">
          <h3 className="text-md font-medium text-fg-strong">Waiting for an administrator</h3>
          <ul className="grid gap-2" data-testid="pending-roles">
            {access.pendingRoles.map((role) => (
              <li key={`${role.role} ${role.scopeId}`} className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">Waiting for confirmation</Badge>
                <span>
                  {ROLE_LABELS[role.role]} for <ScopeName scopeType={role.scopeType} scopeId={role.scopeId} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionsPanel() {
  const { signOut, signOutEverywhere } = useAuth();
  const toast = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const everywhere = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await signOutEverywhere();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "Your sessions could not be ended. Try again.");
      setBusy(false);
    }
  };

  return (
    <Panel id="sessions-heading" title="Signing out">
      <p className="text-fg-secondary">
        Sign out here when you are done on a shared computer. If you think someone else may be signed in to your
        account, sign out everywhere: every device then has to sign in again with a new link.
      </p>
      {failure ? <ErrorState title="You are still signed in everywhere." description={failure} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            void signOut().catch(() =>
              toast.show({
                tone: "error",
                title: "You are still signed in.",
                description: "Signing out failed. Try again.",
              }),
            )
          }
        >
          Sign out
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Sign out everywhere</Button>
          </DialogTrigger>
          <DialogContent
            title="Sign out on every device?"
            description="Every session of your account ends, this one included. You will need a new sign-in link on each device."
          >
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={everywhere}>
                Sign out everywhere
              </Button>
              <DialogClose asChild>
                <Button>Stay signed in</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Panel>
  );
}

export function AccountPage() {
  const user = useSignedInUser();
  const { access } = useAuth();
  return (
    <>
      <PageHeader
        title="Account and security"
        description="Who you are signed in as, what you may do, and how you sign in."
      />
      <div className="grid max-w-reading gap-4">
        <LiveView
          live={access}
          loadingLabel="Loading your account"
          errorTitle="Your account could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(record) => (
            <>
              <Panel id="identity-heading" title="Your account">
                <dl className="-my-3" data-testid="account-identity">
                  <Row term="Signed in as">
                    <span className="break-all">{user.email ?? "No address"}</span>
                  </Row>
                  <Row term="Member profile">
                    {record?.personId ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <PersonName id={record.personId} />
                        <Link to="/" className="text-fg-accent underline underline-offset-2">
                          View on Home
                        </Link>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">Not linked yet</Badge>
                        <Link to="/claim" className="text-fg-accent underline underline-offset-2">
                          Link your profile
                        </Link>
                      </span>
                    )}
                  </Row>
                  <Row term="This session">
                    {user.secondFactor ? "Signed in with a second factor" : "Signed in with an email link"}
                  </Row>
                </dl>
              </Panel>
              <Panel id="roles-heading" title="Your roles">
                {record === null ? (
                  <p className="text-fg-secondary">Your account holds no role yet.</p>
                ) : (
                  <RolesList access={record} />
                )}
              </Panel>
              {record?.member === true ? <NotificationPreferences uid={user.uid} /> : null}
              <SecondFactorSection
                accountName={user.email ?? user.uid}
                required={record?.secondFactorRequired === true || (record?.programmeRoles.length ?? 0) > 0}
              />
            </>
          )}
        </LiveView>
        <SessionsPanel />
      </div>
    </>
  );
}
