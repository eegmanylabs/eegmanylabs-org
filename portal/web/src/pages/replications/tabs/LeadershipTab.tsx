import { Link } from "react-router";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { RecordOf } from "@/data";
import { MEMBERSHIP_ROLE_LABELS } from "@/registry/labels";
import { Section } from "./OverviewTab";

type Membership = RecordOf<"replicationMemberships">;

const LEADING: readonly string[] = ["lead", "coLead"];
const ROLE_ORDER = Object.keys(MEMBERSHIP_ROLE_LABELS);

/** Whether the lead memberships the caller sees leave the lead undecided: one or more of them await review. */
export function leadsUndecided(memberships: readonly Membership[]): boolean {
  return memberships.some(
    (membership) =>
      LEADING.includes(membership.role) && membership.reviewStatus === "needsReview" && membership.archivedAt === null,
  );
}

export interface LeadershipTabProps {
  memberships: readonly Membership[];
  personNames: ReadonlyMap<string, string>;
  /** Whether the caller sees the memberships that await review as well as the confirmed ones. */
  seesUnconfirmed: boolean;
  /** Whether the caller holds the capability to settle a membership, and is offered the review queue. */
  reviews: boolean;
  hasConfirmedLead: boolean;
}

export function LeadershipTab({
  memberships,
  personNames,
  seesUnconfirmed,
  reviews,
  hasConfirmedLead,
}: LeadershipTabProps) {
  const sorted = [...memberships]
    .filter((membership) => membership.archivedAt === null)
    .sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) ||
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        (personNames.get(a.personId) ?? a.personId).localeCompare(personNames.get(b.personId) ?? b.personId),
    );
  const undecided = leadsUndecided(sorted);
  const leadsToReview = sorted.filter(
    (membership) => LEADING.includes(membership.role) && membership.reviewStatus === "needsReview",
  );
  return (
    <div className="grid gap-4">
      {undecided ? (
        <Section title="The lead is not settled">
          <p className="text-fg-secondary" data-testid="lead-conflict">
            {leadsToReview.length > 1
              ? `The sources disagree about who leads this replication: they name ${leadsToReview.length} people. `
              : "A source names a lead that the programme has not confirmed. "}
            None of them counts as a lead until a programme administrator or the core team confirms one.
          </p>
          {reviews ? (
            <p>
              <Link to="/admin/memberships" className="text-fg-accent underline">
                Open the memberships to review
              </Link>
            </p>
          ) : null}
        </Section>
      ) : !hasConfirmedLead ? (
        <p className="text-fg-secondary">No lead of this replication is confirmed yet.</p>
      ) : null}
      {sorted.length === 0 ? null : (
        <Table caption="Memberships of the replication">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Person</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Current or former</TableHeaderCell>
              <TableHeaderCell>Review</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((membership) => (
              <TableRow key={membership.id}>
                <TableCell>
                  <Link
                    to={`/members/${encodeURIComponent(membership.personId)}`}
                    className="text-fg-strong hover:text-fg-accent"
                  >
                    {personNames.get(membership.personId) ?? membership.personId}
                  </Link>
                </TableCell>
                <TableCell>{MEMBERSHIP_ROLE_LABELS[membership.role]}</TableCell>
                <TableCell>{membership.isCurrent ? "Current" : "Former"}</TableCell>
                <TableCell>
                  {membership.reviewStatus === "confirmed" ? (
                    <Badge tone="neutral">Confirmed</Badge>
                  ) : (
                    <Badge tone="accent">Needs review</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {seesUnconfirmed ? null : (
        <Unknown>
          Memberships that wait for review are shown to the team of the replication and to the programme only.
        </Unknown>
      )}
    </div>
  );
}
