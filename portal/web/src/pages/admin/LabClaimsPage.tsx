import { reviewLabClaimContract } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { useAuth } from "@/auth/AuthProvider";
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
  searchText: (claim) => [claim.laboratoryId, ROLE_LABELS[claim.requestedRole]],
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

/** The evidence that the server computed for a request, which only deciders may read. */
function Evidence({ claimId }: { claimId: string }) {
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
        return (
          <ul className="grid gap-1">
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
            ? "The member becomes an authorised representative of the laboratory, with the role they asked for."
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
                  <LaboratoryName id={claim.laboratoryId} />
                </TableCell>
                <TableCell>
                  <PersonOfAccount uid={claim.uid} />
                </TableCell>
                <TableCell>{ROLE_LABELS[claim.requestedRole]}</TableCell>
                <TableCell>
                  <Evidence claimId={claim.id} />
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
