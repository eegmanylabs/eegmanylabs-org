import { reviewLabClaimContract } from "@eegml/shared";
import { useState } from "react";
import { Link } from "react-router";
import { formatDateTime } from "@/app/labels";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { LaboratoryName } from "@/components/record-names";
import { byText, type TableSpec, useTableControls } from "@/components/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { SortHeader } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { callFunction, type RecordOf, retryFailedLiveData, useLiveDataDisconnected, useLiveDocument } from "@/data";
import { countryName } from "@/registry/labels";
import { laboratoryPath } from "@/registry/paths";
import { AdminPage } from "./AdminPage";
import { PersonOfAccount } from "./people";
import { usePendingLabClaims } from "./queues";
import { ReasonDialog } from "./ReasonDialog";

type LabClaim = RecordOf<"labClaims">;
type SortKey = "submitted" | "laboratory" | "role";

const ROLE_LABELS: Readonly<Record<LabClaim["requestedRole"], string>> = {
  coordinator: "Coordinator",
  representative: "Representative",
};

const SPEC: TableSpec<LabClaim, SortKey> = {
  searchText: (claim) => [claim.laboratoryId, claim.proposal?.name, ROLE_LABELS[claim.requestedRole]],
  sorters: {
    submitted: (a, b) => a.submittedAt.toMillis() - b.submittedAt.toMillis(),
    laboratory: (a, b) => byText(a.laboratoryId, b.laboratoryId),
    role: (a, b) => byText(a.requestedRole, b.requestedRole),
  },
  initialSort: { key: "submitted", direction: "asc" },
  pageSize: 20,
};

const yesNo = (value: unknown, yes: string, no: string, unknown: string) =>
  value === true ? <Badge tone="accent">{yes}</Badge> : value === false ? <Badge tone="neutral">{no}</Badge> : unknown;

type Proposal = NonNullable<LabClaim["proposal"]>;

/** A laboratory that a member proposes, as the member entered it. */
function ProposedLaboratory({ proposal }: { proposal: Proposal }) {
  return (
    <dl className="grid gap-0.5">
      <dt className="sr-only">Name</dt>
      <dd className="font-medium text-fg-strong">{proposal.name}</dd>
      <dt className="sr-only">Institution</dt>
      <dd className="text-fg-secondary">
        {proposal.newInstitution === undefined ? (
          <InstitutionName id={proposal.institutionId} />
        ) : (
          `${proposal.newInstitution.name}, ${proposal.newInstitution.city}, ${countryName(proposal.newInstitution.countryCode)} (a new institution)`
        )}
      </dd>
      {proposal.department === undefined ? null : (
        <>
          <dt className="sr-only">Department</dt>
          <dd className="text-fg-secondary">{proposal.department}</dd>
        </>
      )}
      {proposal.website === undefined ? null : (
        <>
          <dt className="sr-only">Website</dt>
          <dd className="break-all text-fg-secondary">{proposal.website}</dd>
        </>
      )}
    </dl>
  );
}

function InstitutionName({ id }: { id: string }) {
  const institution = useLiveDocument("institutions", [id]);
  return <>{institution.status === "ready" && institution.data !== null ? institution.data.name : id}</>;
}

/** The laboratory in the portal that a registration duplicates, beside what the member proposed. */
function DuplicateComparison({ laboratoryId, proposal }: { laboratoryId: string; proposal: Proposal }) {
  const existing = useLiveDocument("laboratories", [laboratoryId]);
  return (
    <div
      className="grid gap-2 rounded-control border border-accent bg-surface-accent p-2"
      data-testid="duplicate-comparison"
    >
      <p className="font-medium text-fg-strong">This laboratory is in the portal already</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="text-xs text-fg-muted">Proposed</p>
          <ProposedLaboratory proposal={proposal} />
        </div>
        <div>
          <p className="text-xs text-fg-muted">In the portal</p>
          {existing.status === "ready" && existing.data !== null ? (
            <dl className="grid gap-0.5">
              <dt className="sr-only">Name</dt>
              <dd className="font-medium">
                <Link to={laboratoryPath(laboratoryId)} className="text-fg-accent underline">
                  {existing.data.name}
                </Link>
              </dd>
              <dt className="sr-only">Institution</dt>
              <dd className="text-fg-secondary">
                {existing.data.institutionId === undefined ? (
                  "No institution recorded"
                ) : (
                  <InstitutionName id={existing.data.institutionId} />
                )}
              </dd>
              <dt className="sr-only">Department</dt>
              <dd className="text-fg-secondary">{existing.data.department ?? "No department recorded"}</dd>
            </dl>
          ) : (
            <span className="text-fg-secondary">Loading the laboratory</span>
          )}
        </div>
      </div>
      <p className="text-xs text-fg-muted">
        Approving gives the member the role in the laboratory that exists. Nothing is created twice.
      </p>
    </div>
  );
}

/** The evidence that the server computed for a request, which only deciders may read. */
function Evidence({ claimId, proposal }: { claimId: string; proposal: Proposal | undefined }) {
  const review = useLiveDocument("labClaimReview", [claimId]);
  return (
    <LiveView
      live={review}
      loadingLabel="Loading the evidence"
      errorTitle="The evidence could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) => {
        if (record === null) return <span className="text-fg-secondary">No evidence recorded</span>;
        const { evidence } = record;
        const entry = evidence.memberEntry as { status?: unknown; role?: unknown } | null | undefined;
        const duplicateOf =
          typeof evidence.duplicateOfLaboratoryId === "string" ? evidence.duplicateOfLaboratoryId : null;
        return (
          <ul className="grid gap-1">
            {proposal !== undefined && duplicateOf !== null ? (
              <li>
                <DuplicateComparison laboratoryId={duplicateOf} proposal={proposal} />
              </li>
            ) : null}
            <li>
              {yesNo(
                evidence.personListsLaboratory,
                "Their profile lists this laboratory",
                "Their profile does not list it",
                "Profile not checked",
              )}
            </li>
            <li>
              {yesNo(
                evidence.emailDomainMatchesInstitution,
                "Address in the institution's domain",
                "Address outside the institution's domains",
                "The institution has no domains recorded",
              )}
            </li>
            <li className="text-fg-secondary">
              {entry
                ? `Member entry: ${String(entry.role ?? "unknown role")}, ${String(entry.status ?? "unknown status")}`
                : "No member entry"}
            </li>
            {typeof evidence.message === "string" ? (
              <li className="whitespace-pre-line">“{evidence.message}”</li>
            ) : null}
          </ul>
        );
      }}
    </LiveView>
  );
}

function Decision({ claim }: { claim: LabClaim }) {
  const toast = useToast();
  const offline = useLiveDataDisconnected();
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const own = claim.uid === useSignedInUser().uid;
  // Nobody decides their own request, which the function refuses as well.
  if (own) {
    return <span className="text-fg-secondary">Your own request: another reviewer decides it</span>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={offline} onClick={() => setDeciding("approve")}>
          Approve
        </Button>
        <Button size="sm" disabled={offline} onClick={() => setDeciding("reject")}>
          Reject
        </Button>
      </div>
      <ReasonDialog
        open={deciding !== null}
        onOpenChange={(open) => (open ? null : setDeciding(null))}
        title={deciding === "approve" ? "Approve this request?" : "Reject this request?"}
        description={
          deciding === "approve"
            ? claim.proposal === undefined
              ? "The member becomes an authorised representative of the laboratory, with the role they asked for."
              : "The laboratory is created, with its institution where that is new, and the member represents it with the role they asked for. If it is in the portal already, nothing is created twice."
            : "The member is told that the request was not approved."
        }
        label="Note"
        optional={deciding === "approve"}
        confirmLabel={deciding === "approve" ? "Approve" : "Reject"}
        onConfirm={async (note) => {
          if (deciding === "approve") {
            await callFunction(reviewLabClaimContract, {
              claimId: claim.id,
              decision: "approve",
              ...(note === "" ? {} : { note }),
            });
            toast.show({ title: "The request has been approved." });
          } else {
            await callFunction(reviewLabClaimContract, { claimId: claim.id, decision: "reject", note });
            toast.show({ title: "The request has been rejected." });
          }
        }}
      />
    </>
  );
}

function LabClaimTable({ claims }: { claims: readonly LabClaim[] }) {
  const table = useTableControls(claims, SPEC);
  if (claims.length === 0) {
    return (
      <EmptyState
        title="No requests wait for a decision"
        description="Requests to represent a laboratory appear here."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <FormField label="Search requests" className="max-w-sm">
        {(control) => (
          <Input
            {...control}
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
          />
        )}
      </FormField>
      {table.total === 0 ? (
        <EmptyState title="No request matches your search" />
      ) : (
        <Table caption="Requests to represent a laboratory">
          <TableHead>
            <TableRow>
              <SortHeader direction={table.directionOf("laboratory")} onSort={() => table.sortBy("laboratory")}>
                Laboratory
              </SortHeader>
              <TableHeaderCell>Member</TableHeaderCell>
              <SortHeader direction={table.directionOf("role")} onSort={() => table.sortBy("role")}>
                Asks to be
              </SortHeader>
              <TableHeaderCell>Evidence</TableHeaderCell>
              <SortHeader direction={table.directionOf("submitted")} onSort={() => table.sortBy("submitted")}>
                Sent
              </SortHeader>
              <TableHeaderCell>Decision</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {table.page.map((claim) => (
              <TableRow key={claim.id} className="align-top">
                <TableCell>
                  {claim.proposal === undefined ? (
                    <LaboratoryName id={claim.laboratoryId} />
                  ) : (
                    <div className="grid gap-1">
                      <Badge tone="outline">New laboratory</Badge>
                      <ProposedLaboratory proposal={claim.proposal} />
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <PersonOfAccount uid={claim.uid} />
                </TableCell>
                <TableCell>{ROLE_LABELS[claim.requestedRole]}</TableCell>
                <TableCell>
                  <Evidence claimId={claim.id} proposal={claim.proposal} />
                </TableCell>
                <TableCell>
                  <time dateTime={claim.submittedAt.toDate().toISOString()}>
                    {formatDateTime(claim.submittedAt.toDate())}
                  </time>
                </TableCell>
                <TableCell>
                  <Decision claim={claim} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        offset={table.offset}
        pageSize={table.pageSize}
        total={table.total}
        label="requests"
        onChange={table.setOffset}
      />
    </div>
  );
}

/** Requests by members to represent a laboratory, for programme staff and for the laboratory's coordinators. */
export function LabClaimsPage() {
  return (
    <AdminPage
      entryId="admin-lab-claims"
      description="Members who ask to coordinate or represent a laboratory. The evidence was checked by the server when they asked."
    >
      <LabClaimQueue />
    </AdminPage>
  );
}

function LabClaimQueue() {
  const { access } = useAuth();
  const claims = usePendingLabClaims(access.status === "ready" ? access.data : null);
  return (
    <LiveView
      live={claims}
      loadingLabel="Loading the requests"
      errorTitle="The requests could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => <LabClaimTable claims={list} />}
    </LiveView>
  );
}
