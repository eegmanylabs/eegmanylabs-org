import type { CreditRoleKey, DataOrigin } from "@eegml/shared";
import { CREDIT_ROLES } from "@eegml/shared";
import { Link } from "react-router";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { RecordOf } from "@/data";
import { CREDIT_ROLE_NAMES } from "@/registry/labels";

type Contributor = RecordOf<"contributors">;

/** The name of a contributor from the verbatim parts of the row. */
export function contributorName(
  contributor: Pick<Contributor, "firstNameSource" | "middleNameSource" | "surnameSource">,
): string {
  return [contributor.firstNameSource, contributor.middleNameSource, contributor.surnameSource]
    .filter((part) => part !== undefined && part.trim() !== "")
    .join(" ");
}

/**
 * The CRediT roles of a row, in the order of the taxonomy. A role whose cell is empty is absent
 * from the row. A cell that says more than a tick keeps its verbatim value beside the role,
 * marked as a source value that nobody has reviewed.
 */
export function creditRolesOf(contributor: Pick<Contributor, "creditRoles">): string[] {
  return CREDIT_ROLES.flatMap(({ key }) => {
    const cell = contributor.creditRoles[key as CreditRoleKey];
    if (cell === undefined || cell === false || cell === "") return [];
    const name = CREDIT_ROLE_NAMES[key];
    return [cell === true ? name : `${name} (unverified source value: ${String(cell)})`];
  });
}

/**
 * The contributors of the replication's publications, from the contributor tables. Contact
 * details are never shown here. The rows carry no origin of their own, so they are labelled
 * with the origin of the replication whose tables they come from.
 */
export function ContributorsTab({
  contributors,
  origin,
}: {
  contributors: readonly Contributor[];
  origin: DataOrigin;
}) {
  const sorted = [...contributors]
    .filter((contributor) => contributor.archivedAt === null)
    .sort(
      (a, b) =>
        (a.orderInPublication ?? Number.MAX_SAFE_INTEGER) - (b.orderInPublication ?? Number.MAX_SAFE_INTEGER) ||
        contributorName(a).localeCompare(contributorName(b)),
    );
  return (
    <div className="grid gap-2" data-testid="contributors">
      <p className="flex flex-wrap items-center gap-2 text-fg-secondary">
        <OriginBadge origin={origin} showLive />
        <span>
          As the contributor tables of the replication give them. A role cell that says more than a tick is shown as an
          unverified source value.
        </span>
      </p>
      <Table caption="Contributors">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Order</TableHeaderCell>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Affiliation</TableHeaderCell>
            <TableHeaderCell>CRediT roles</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((contributor) => {
            const name = contributorName(contributor) || "Name not recorded";
            const roles = creditRolesOf(contributor);
            return (
              <TableRow key={contributor.id} className="align-top">
                <TableCell className="tabular-nums">{contributor.orderInPublication ?? <Unknown />}</TableCell>
                <TableCell>
                  {contributor.personId === null ? (
                    name
                  ) : (
                    <Link
                      to={`/members/${encodeURIComponent(contributor.personId)}`}
                      className="text-fg-strong hover:text-fg-accent"
                    >
                      {name}
                    </Link>
                  )}
                </TableCell>
                <TableCell>{contributor.affiliationSource ?? <Unknown />}</TableCell>
                <TableCell>{roles.length === 0 ? <Unknown>No role recorded</Unknown> : roles.join(", ")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
