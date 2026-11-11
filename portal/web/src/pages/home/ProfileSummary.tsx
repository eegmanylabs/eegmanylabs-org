import type { PendingRole } from "@eegml/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ROLE_LABELS } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { LaboratoryName, ReplicationName, ScopeName } from "@/components/record-names";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { type RecordOf, retryFailedLiveData, useLiveDocument } from "@/data";
import { replicationPath } from "@/registry/paths";

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-fg-muted">{term}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

/** A list of the units of a person, or a sentence that says there are none. */
function Units({
  ids,
  none,
  Name,
}: {
  ids: readonly string[];
  none: string;
  Name: (props: { id: string }) => ReactNode;
}) {
  if (ids.length === 0) return <span className="text-fg-secondary">{none}</span>;
  return (
    <ul className="grid gap-1">
      {ids.map((id) => (
        <li key={id}>
          <Name id={id} />
        </li>
      ))}
    </ul>
  );
}

/** The roles that wait for an administrator, in plain words. */
export function PendingRoleList({ roles }: { roles: readonly PendingRole[] }) {
  return (
    <ul className="grid gap-2">
      {roles.map((role) => (
        <li key={`${role.role} ${role.scopeType} ${role.scopeId}`} className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Waiting for confirmation</Badge>
          <span>
            {ROLE_LABELS[role.role]}
            {role.scopeType === "programme" ? null : (
              <>
                {" "}
                for <ScopeName scopeType={role.scopeType} scopeId={role.scopeId} />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-4 w-56 max-w-full" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <Skeleton className="h-4 w-40 max-w-full" />
    </div>
  );
}

/** A replication of the person, linked to its page. */
function ReplicationLink({ id }: { id: string }) {
  return (
    <Link to={replicationPath(id)} className="text-fg-accent underline">
      <ReplicationName id={id} />
    </Link>
  );
}

export function PersonDetails({ person }: { person: RecordOf<"persons"> }) {
  return (
    <dl className="-my-3" data-testid="profile-summary">
      <Row term="Name">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {person.displayName}
          {person.dataOrigin === "demo" ? <Badge tone="outline">Demonstration data</Badge> : null}
        </span>
      </Row>
      <Row term="Affiliation">
        {person.affiliationSummary ?? <span className="text-fg-secondary">No affiliation recorded</span>}
      </Row>
      <Row term="Laboratories">
        <Units ids={person.laboratoryIds} none="No laboratory recorded" Name={LaboratoryName} />
      </Row>
      <Row term="Replications">
        <Units ids={person.replicationIds} none="No replication recorded" Name={ReplicationLink} />
      </Row>
    </dl>
  );
}

/** The directory record of a person, read live. */
export function ProfileSummary({ personId }: { personId: string }) {
  const person = useLiveDocument("persons", [personId]);
  return (
    <LiveView
      live={person}
      loadingLabel="Loading your profile"
      loading={<SummarySkeleton />}
      errorTitle="Your profile could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <p className="text-fg-secondary">
            The profile your account is linked to is not in the directory. Contact a programme administrator.
          </p>
        ) : (
          <PersonDetails person={record} />
        )
      }
    </LiveView>
  );
}
