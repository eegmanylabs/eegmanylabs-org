import { setReplicationStatusContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction } from "@/data";

const REASON_MAX = 2_000;

export interface StatusChangeDialogProps {
  studyKey: string;
  /** The status the page shows now, which the function checks is still the stored one. */
  currentStatusKey: string | null;
  statuses: readonly { readonly key: string; readonly label: string }[];
}

/**
 * Changes the status of a replication through `setReplicationStatus`, which checks the caller's
 * right, requires a reason and writes the history entry and the audit entry with the change.
 */
export function StatusChangeDialog({ studyKey, currentStatusKey, statuses }: StatusChangeDialogProps) {
  const toast = useToast();
  const choices = statuses.filter((status) => status.key !== currentStatusKey);
  const [open, setOpen] = useState(false);
  const [statusKey, setStatusKey] = useState("");
  const [reason, setReason] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStatusKey("");
    setReason("");
    setStatusError(null);
    setReasonError(null);
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    const missingStatus = statusKey === "";
    const badReason = trimmed === "" || trimmed.length > REASON_MAX;
    setStatusError(missingStatus ? "Choose the new status." : null);
    setReasonError(badReason ? "Enter a reason for the change, up to 2,000 characters." : null);
    if (missingStatus || badReason) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setReplicationStatusContract, {
        replicationId: studyKey,
        fromStatusKey: currentStatusKey,
        toStatusKey: statusKey,
        reason: trimmed,
      });
      setOpen(false);
      reset();
      toast.show({
        title: "The status has been changed.",
        description: "The change is in the activity of the replication.",
      });
    } catch (error) {
      setFailure(
        error instanceof CallableError ? error.message : "The status could not be changed. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">Change status</Button>
      </DialogTrigger>
      <DialogContent
        title={`Change the status of ${studyKey}`}
        description="The change is recorded in the activity of the replication with your reason and your name."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The status was not changed." description={failure} />}
          <FormField label="New status" error={statusError}>
            {(control) => (
              <Select {...control} value={statusKey} onChange={(event) => setStatusKey(event.target.value)}>
                <option value="">Choose a status</option>
                {choices.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" error={reasonError}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Changing the status…" : "Change status"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
