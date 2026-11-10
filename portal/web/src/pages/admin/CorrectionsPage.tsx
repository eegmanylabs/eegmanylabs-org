import { can, correctionCanBeApplied, resolveCorrectionRequestContract } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { useAuth } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { PersonName } from "@/components/record-names";
import { byText, type TableSpec, useTableControls } from "@/components/table-controls";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { SortHeader } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { callFunction, type RecordOf, retryFailedLiveData, useLiveDataDisconnected, useLiveQuery } from "@/data";
import { CORRECTABLE_FIELD_LABELS } from "@/pages/home/CorrectionRequestDialog";
import { AdminPage } from "./AdminPage";
import { PersonOfAccount } from "./people";
import { OPEN_CORRECTION_REQUESTS } from "./queues";
import { ReasonDialog } from "./ReasonDialog";

type Request = RecordOf<"correctionRequests">;
type SortKey = "sent" | "field";

const SPEC: TableSpec<Request, SortKey> = {
  searchText: (request) => [
    request.field,
    CORRECTABLE_FIELD_LABELS[request.field],
    String(request.proposedValue),
    request.message,
    request.entityId,
  ],
  sorters: {
    sent: (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis(),
    field: (a, b) => byText(a.field, b.field),
  },
  initialSort: { key: "sent", direction: "asc" },
  pageSize: 20,
};

type Decision = "apply" | "accepted" | "rejected";

const DECISION_TOASTS: Record<Decision, string> = {
  apply: "The report was accepted and the record corrected.",
  accepted: "The report was accepted.",
  rejected: "The report was not accepted.",
};

function Resolve({ request }: { request: Request }) {
  const toast = useToast();
  const offline = useLiveDataDisconnected();
  const applicable = correctionCanBeApplied(request);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision>(applicable ? "apply" : "accepted");
  const label = CORRECTABLE_FIELD_LABELS[request.field] ?? request.field;
  return (
    <>
      <Button size="sm" disabled={offline} onClick={() => setOpen(true)}>
        Resolve
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Resolve this report"
        description={
          applicable
            ? `Accepting can also set the record's ${label.toLowerCase()} to the value the member proposed. The member is notified, with your message.`
            : `The ${label.toLowerCase()} comes from other records, such as affiliations, laboratory entries or memberships, and is corrected there. Accepting records that the report is right, and the member sees it as accepted and not yet corrected until then. The member is notified, with your message.`
        }
        label="Message to the member"
        optional
        maxLength={500}
        confirmLabel="Resolve"
        onConfirm={async (message) => {
          await callFunction(resolveCorrectionRequestContract, {
            requestId: request.id,
            outcome: decision === "rejected" ? "rejected" : "accepted",
            ...(decision === "apply" ? { apply: true } : {}),
            ...(message === "" ? {} : { messageToRequester: message }),
          });
          toast.show({ title: DECISION_TOASTS[decision] });
        }}
      >
        <FormField label="Outcome">
          {(control) => (
            <Select
              {...control}
              value={decision}
              onChange={(event) =>
                setDecision(
                  event.target.value === "rejected"
                    ? "rejected"
                    : event.target.value === "apply"
                      ? "apply"
                      : "accepted",
                )
              }
            >
              {applicable ? <option value="apply">The detail is wrong: accept and correct the record</option> : null}
              <option value="accepted">
                {applicable
                  ? "The detail is wrong: accept, and correct the record later"
                  : "The detail is wrong: accept"}
              </option>
              <option value="rejected">The detail is right: do not accept</option>
            </Select>
          )}
        </FormField>
      </ReasonDialog>
    </>
  );
}

function RequestTable({ requests, canResolve }: { requests: readonly Request[]; canResolve: boolean }) {
  const table = useTableControls(requests, SPEC);
  if (requests.length === 0) {
    return (
      <EmptyState
        title="No reports wait for a decision"
        description="Reports of wrong details that members send appear here."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <FormField label="Search reports" className="max-w-sm">
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
        <EmptyState title="No report matches your search" />
      ) : (
        <Table caption="Reports of wrong details">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Record</TableHeaderCell>
              <SortHeader direction={table.directionOf("field")} onSort={() => table.sortBy("field")}>
                Detail
              </SortHeader>
              <TableHeaderCell>Should say</TableHeaderCell>
              <TableHeaderCell>Sent by</TableHeaderCell>
              <SortHeader direction={table.directionOf("sent")} onSort={() => table.sortBy("sent")}>
                Sent
              </SortHeader>
              {canResolve ? <TableHeaderCell>Decision</TableHeaderCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {table.page.map((request) => (
              <TableRow key={request.id} className="align-top">
                <TableCell>
                  {request.entityType === "person" ? (
                    <PersonName id={request.entityId} />
                  ) : (
                    `${request.entityType} ${request.entityId}`
                  )}
                </TableCell>
                <TableCell>{CORRECTABLE_FIELD_LABELS[request.field] ?? request.field}</TableCell>
                <TableCell>
                  <span className="break-words">{String(request.proposedValue)}</span>
                  {request.message ? (
                    <span className="mt-1 block whitespace-pre-line text-fg-secondary">{request.message}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <PersonOfAccount uid={request.uid} />
                </TableCell>
                <TableCell>
                  <time dateTime={request.createdAt.toDate().toISOString()}>
                    {formatDateTime(request.createdAt.toDate())}
                  </time>
                </TableCell>
                {canResolve ? (
                  <TableCell>
                    <Resolve request={request} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        offset={table.offset}
        pageSize={table.pageSize}
        total={table.total}
        label="reports"
        onChange={table.setOffset}
      />
    </div>
  );
}

/** Members' reports that a detail of a record is wrong, oldest first. */
export function CorrectionsPage() {
  return (
    <AdminPage
      entryId="admin-corrections"
      description="Reports from members that a detail of their record is wrong. Check each one and resolve it. A name or a country can be corrected as you accept the report."
    >
      <Requests />
    </AdminPage>
  );
}

function Requests() {
  const { access } = useAuth();
  const requests = useLiveQuery(OPEN_CORRECTION_REQUESTS);
  const canResolve =
    access.status === "ready" && access.data !== null && can(access.data, "people.manage", "programme");
  return (
    <LiveView
      live={requests}
      loadingLabel="Loading the reports"
      errorTitle="The reports could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => <RequestTable requests={list} canResolve={canResolve} />}
    </LiveView>
  );
}
