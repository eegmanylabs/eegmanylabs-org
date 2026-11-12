// The transfers of a dataset (docs/DATA_MODEL.md, section 10). The portal moves no data: a
// transfer is requested, approved by someone other than the person who asked, recorded as people
// carry it out with their institutions' own tools, and verified when a listing of the
// destination matches the source. Every step is a callable function with its audit entry.
import { advanceTransferContract, requestTransferContract } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf } from "@/data";
import { FormDialog, useAction } from "./dataset-actions";
import { APPROVAL_LABELS, ROLE_LABELS, TRANSFER_STATUS_LABELS } from "./dataset-format";

type Transfer = RecordOf<"datasetTransfers">;
type Ref = RecordOf<"datasetStorageRefs">;
type Step = "approve" | "refuse" | "start" | "complete" | "fail" | "verify";

const STEP_LABELS: Readonly<Record<Step, string>> = {
  approve: "Approve",
  refuse: "Refuse",
  start: "Record the start",
  complete: "Record completion",
  fail: "Record a failure",
  verify: "Verify against the listings",
};

/** The steps that may follow, as `advanceTransfer` decides them. */
export function stepsOf(transfer: Transfer, uid: string): Step[] {
  if (transfer.status === "initiated" && transfer.approval === "pending") {
    return transfer.initiatedBy === uid ? [] : ["approve", "refuse"];
  }
  if (transfer.approval !== "approved") return [];
  if (transfer.status === "initiated") return ["start", "fail"];
  if (transfer.status === "inProgress") return ["complete", "fail"];
  if (transfer.status === "completed") return ["verify"];
  return [];
}

function StepDialog({
  datasetKey,
  transfer,
  step,
  onClose,
}: {
  datasetKey: string;
  transfer: Transfer;
  step: Step;
  onClose: () => void;
}) {
  const action = useAction();
  const [note, setNote] = useState("");
  const [bytes, setBytes] = useState("");
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title={STEP_LABELS[step]}
      description="The step is recorded with your name and the time. The portal itself moves no data."
      submitLabel={STEP_LABELS[step]}
      failureTitle="The transfer did not change."
      busy={action.busy}
      failure={action.failure}
      onSubmit={async () => {
        const bytesTransferred = bytes.trim() === "" ? null : Number(bytes);
        if (
          await action.run(
            () =>
              callFunction(advanceTransferContract, {
                datasetKey,
                transferId: transfer.id,
                action: step,
                note: note.trim(),
                bytesTransferred:
                  bytesTransferred !== null && Number.isSafeInteger(bytesTransferred) ? bytesTransferred : null,
              }),
            "The transfer has been updated.",
            "The transfer could not be updated. Try again.",
          )
        )
          onClose();
      }}
    >
      {step === "complete" ? (
        <FormField label="Bytes transferred" hint="Optional.">
          {(control) => (
            <Input {...control} inputMode="numeric" value={bytes} onChange={(event) => setBytes(event.target.value)} />
          )}
        </FormField>
      ) : null}
      {step === "verify" ? (
        <p className="text-sm">
          The latest listing of the destination, made after completion, must match the latest listing of the source.
        </p>
      ) : (
        <FormField
          label={step === "fail" ? "What went wrong" : "Note"}
          hint={step === "fail" ? undefined : "Optional."}
        >
          {(control) => (
            <Textarea {...control} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          )}
        </FormField>
      )}
    </FormDialog>
  );
}

function RequestDialog({
  datasetKey,
  refs,
  endpointName,
  onClose,
}: {
  datasetKey: string;
  refs: readonly Ref[];
  endpointName: (key: string) => string;
  onClose: () => void;
}) {
  const action = useAction();
  const current = refs.filter((ref) => ref.validTo === null && ref.archivedAt === null);
  const [from, setFrom] = useState(current[0]?.id ?? "");
  const [to, setTo] = useState(current[1]?.id ?? "");
  const [reason, setReason] = useState("");
  const label = (ref: Ref) => `${ROLE_LABELS[ref.role]} copy on ${endpointName(ref.endpointKey)}`;
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Request a transfer"
      description="Raw research data moves only after someone else who manages the dataset approves it, and people carry the transfer out with their institutions' tools."
      submitLabel="Request the transfer"
      failureTitle="Nothing was requested."
      busy={action.busy}
      failure={action.failure}
      onSubmit={async () => {
        if (
          await action.run(
            () =>
              callFunction(requestTransferContract, {
                datasetKey,
                fromRefId: from,
                toRefId: to,
                reason: reason.trim(),
              }),
            "The transfer has been requested and waits for approval.",
            "The transfer could not be requested. Try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="From">
        {(control) => (
          <Select {...control} value={from} onChange={(event) => setFrom(event.target.value)}>
            {current.map((ref) => (
              <option key={ref.id} value={ref.id}>
                {label(ref)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="To" hint="Register the destination as a copy first.">
        {(control) => (
          <Select {...control} value={to} onChange={(event) => setTo(event.target.value)}>
            {current.map((ref) => (
              <option key={ref.id} value={ref.id}>
                {label(ref)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Reason">
        {(control) => (
          <Textarea {...control} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

export function TransfersSection({
  datasetKey,
  transfers,
  refs,
  manages,
  uid,
  endpointName,
}: {
  datasetKey: string;
  transfers: readonly Transfer[];
  refs: readonly Ref[];
  manages: boolean;
  uid: string;
  endpointName: (key: string) => string;
}) {
  const [requesting, setRequesting] = useState(false);
  const [step, setStep] = useState<{ transfer: Transfer; step: Step } | null>(null);
  const currentCopies = refs.filter((ref) => ref.validTo === null && ref.archivedAt === null).length;
  const label = (id: string) => {
    const ref = refs.find((candidate) => candidate.id === id);
    return ref === undefined ? "A copy" : `${ROLE_LABELS[ref.role]} on ${endpointName(ref.endpointKey)}`;
  };
  const ordered = [...transfers].sort((a, b) => b.initiatedAt.toMillis() - a.initiatedAt.toMillis());
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-fg-secondary">
          The portal records and requests transfers. It never moves data itself.
        </p>
        {manages && currentCopies >= 2 ? (
          <Button variant="primary" onClick={() => setRequesting(true)}>
            Request a transfer
          </Button>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <EmptyState
          title="No transfers"
          description={
            currentCopies >= 2 ? "No transfer has been requested." : "A transfer goes between two registered copies."
          }
        />
      ) : (
        <Table caption="Transfers of the dataset" data-testid="transfers">
          <TableHead>
            <TableRow>
              <TableHeaderCell>From and to</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Requested</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((transfer) => (
              <TableRow key={transfer.id}>
                <TableCell>
                  {label(transfer.fromRefId)} to {label(transfer.toRefId)}
                  <span className="block text-xs text-fg-muted">{transfer.reason}</span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <Badge>{TRANSFER_STATUS_LABELS[transfer.status]}</Badge>
                    <Badge tone={transfer.approval === "pending" ? "accent" : "outline"}>
                      {APPROVAL_LABELS[transfer.approval]}
                    </Badge>
                  </span>
                  {transfer.error === undefined ? null : (
                    <span className="block text-xs text-fg-accent">{transfer.error}</span>
                  )}
                </TableCell>
                <TableCell>{formatDateTime(transfer.initiatedAt.toDate())}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1.5">
                    {manages
                      ? stepsOf(transfer, uid).map((next) => (
                          <Button key={next} size="sm" onClick={() => setStep({ transfer, step: next })}>
                            {STEP_LABELS[next]}
                          </Button>
                        ))
                      : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {requesting ? (
        <RequestDialog
          datasetKey={datasetKey}
          refs={refs}
          endpointName={endpointName}
          onClose={() => setRequesting(false)}
        />
      ) : null}
      {step === null ? null : (
        <StepDialog datasetKey={datasetKey} transfer={step.transfer} step={step.step} onClose={() => setStep(null)} />
      )}
    </div>
  );
}
