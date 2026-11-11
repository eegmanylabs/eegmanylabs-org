import { confirmReplicationMembershipContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { replicationPath } from "@/pages/replications/replication-display";
import { MEMBERSHIP_ROLE_LABELS } from "@/registry/labels";
import { MEMBERSHIPS_TO_REVIEW, usePersons } from "@/registry/queries";
import { AdminPage } from "./AdminPage";

type Membership = RecordOf<"replicationMemberships">;

const LEADING: readonly string[] = ["lead", "coLead"];

/** The memberships that wait for review, grouped by replication, in the order of the identifiers. */
export function groupByReplication(memberships: readonly Membership[]): [string, Membership[]][] {
  const groups = new Map<string, Membership[]>();
  for (const membership of memberships) {
    if (membership.archivedAt !== null) continue;
    groups.set(membership.replicationId, [...(groups.get(membership.replicationId) ?? []), membership]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function ConfirmButton({ membership, name }: { membership: Membership; name: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      aria-label={`Confirm ${name} as ${MEMBERSHIP_ROLE_LABELS[membership.role].toLowerCase()} of ${membership.replicationId}`}
      onClick={async () => {
        setBusy(true);
        try {
          await callFunction(confirmReplicationMembershipContract, {
            replicationId: membership.replicationId,
            personId: membership.personId,
            role: membership.role,
            isCurrent: membership.isCurrent,
          });
          toast.show({ title: "The membership has been confirmed." });
        } catch (error) {
          toast.show({
            title: "The membership was not confirmed.",
            description: error instanceof CallableError ? error.message : "Try again in a moment.",
            tone: "error",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      Confirm
    </Button>
  );
}

function Queue() {
  const memberships = useLiveQuery(MEMBERSHIPS_TO_REVIEW);
  const persons = usePersons();
  const names = useMemo(
    () => new Map((persons.status === "ready" ? persons.data : []).map((person) => [person.id, person.displayName])),
    [persons],
  );
  return (
    <LiveView
      live={memberships}
      loadingLabel="Loading the memberships to review"
      errorTitle="The memberships to review could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const groups = groupByReplication(list);
        if (groups.length === 0) {
          return (
            <EmptyState title="Nothing to review" description="Every membership of every replication is confirmed." />
          );
        }
        return (
          <div className="grid gap-4">
            {groups.map(([studyKey, group]) => {
              const leads = group.filter((membership) => LEADING.includes(membership.role));
              return (
                <section key={studyKey} aria-labelledby={`review-${studyKey}`} className="grid gap-2">
                  <h2 id={`review-${studyKey}`} className="flex flex-wrap items-center gap-2 text-lg text-fg">
                    <Link to={`${replicationPath(studyKey)}?tab=leadership`} className="hover:text-fg-accent">
                      {studyKey}
                    </Link>
                    {leads.length > 1 ? <Badge tone="accent">The sources name {leads.length} leads</Badge> : null}
                  </h2>
                  <Table caption={`Memberships of ${studyKey} to review`}>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Person</TableHeaderCell>
                        <TableHeaderCell>Role</TableHeaderCell>
                        <TableHeaderCell>Current or former</TableHeaderCell>
                        <TableHeaderCell>Decision</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.map((membership) => {
                        const name = names.get(membership.personId) ?? membership.personId;
                        return (
                          <TableRow key={membership.id}>
                            <TableCell>
                              <Link
                                to={`/members/${encodeURIComponent(membership.personId)}`}
                                className="hover:text-fg-accent"
                              >
                                {name}
                              </Link>
                            </TableCell>
                            <TableCell>{MEMBERSHIP_ROLE_LABELS[membership.role]}</TableCell>
                            <TableCell>{membership.isCurrent ? "Current" : "Former"}</TableCell>
                            <TableCell>
                              <ConfirmButton membership={membership} name={name} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </section>
              );
            })}
          </div>
        );
      }}
    </LiveView>
  );
}

export function MembershipsReviewPage() {
  return (
    <AdminPage
      entryId="admin-memberships"
      description="Memberships of replications that a source states and the programme has not confirmed, such as leads on which the sources disagree. A confirmed lead still needs an approved role before it gives any rights."
    >
      <Queue />
    </AdminPage>
  );
}
