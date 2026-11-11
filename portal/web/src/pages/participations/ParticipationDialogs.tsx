// The changes to a participation that go beyond its checklist: its status, through
// `setParticipationStatus`, which writes the history entry with a reason; its onboarding
// details and the justification of an equipment override, which the rules let those who manage
// the participation write in its restricted document.
import {
  type ParticipationSide,
  type ParticipationStatus,
  participationStatusSchema,
  setParticipationStatusContract,
  transitionsFor,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, updateParticipationDetail } from "@/data";
import { ETHICS_STATUS_LABELS, PARTICIPATION_STATUS_LABELS, TRAINING_STATUS_LABELS } from "@/registry/labels";

const REASON_MAX = 2_000;

/** Why a direct write of the restricted detail was refused, in words the person can act on. */
function detailFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "permission-denied") {
    return "The change was refused. Once readiness is approved, ethics, training and the equipment override change only together with the approval, which the leads of the replication give. Your account may also not edit this participation.";
  }
  return "The change could not be saved. Check your connection and try again.";
}

export function ParticipationStatusDialog({
  participationId,
  current,
  label,
  sides,
  readinessApproved,
}: {
  participationId: string;
  current: ParticipationStatus;
  /** What the participation is called, for the title of the dialog. */
  label: string;
  /** The sides the account speaks for, which decide the moves it is offered (`PARTICIPATION_TRANSITIONS`). */
  sides: ReadonlySet<ParticipationSide>;
  /** Whether readiness is approved, which a move into collection needs. */
  readinessApproved: boolean;
}) {
  const toast = useToast();
  const moves = transitionsFor(current, sides);
  const choices = moves.filter((move) => readinessApproved || !move.requiresApprovedReadiness).map((move) => move.to);
  const waitsForReadiness = moves.some((move) => move.requiresApprovedReadiness) && !readinessApproved;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ status?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setStatus("");
    setReason("");
    setErrors({});
    setFailure(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    const next = participationStatusSchema.safeParse(status);
    const found = {
      ...(next.success ? {} : { status: "Choose the new status." }),
      ...(trimmed === "" || trimmed.length > REASON_MAX ? { reason: "Enter a reason, up to 2,000 characters." } : {}),
    };
    setErrors(found);
    if (!next.success || Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setParticipationStatusContract, {
        participationId,
        fromStatus: current,
        toStatus: next.data,
        reason: trimmed,
      });
      setOpen(false);
      reset();
      toast.show({ title: "The status has been changed.", description: "The change is in the activity." });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The status could not be changed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  if (choices.length === 0) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" aria-label={`Change status: ${label}`}>
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Change the status of ${label}`}
        description="The change is recorded in the history of the participation with your reason and your name. Every member of the portal can read the reason, so keep ethics, staffing and personal details out of it and record those in the onboarding details."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {waitsForReadiness ? (
            <p className="text-fg-secondary">Collection can start once the readiness of the laboratory is approved.</p>
          ) : null}
          {failure === null ? null : <ErrorState title="The status was not changed." description={failure} />}
          <FormField label="New status" error={errors.status ?? null}>
            {(control) => (
              <Select {...control} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Choose a status</option>
                {choices.map((choice) => (
                  <option key={choice} value={choice}>
                    {PARTICIPATION_STATUS_LABELS[choice]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" error={errors.reason ?? null}>
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

type Detail = RecordOf<"participationDetail">;

export function OnboardingDetailDialog({
  uid,
  participationId,
  detail,
  label,
}: {
  uid: string;
  participationId: string;
  detail: Detail;
  label: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ethicsStatus, setEthicsStatus] = useState(detail.ethicsStatus);
  const [ethicsReference, setEthicsReference] = useState(detail.ethicsReference ?? "");
  const [trainingStatus, setTrainingStatus] = useState(detail.trainingStatus);
  const [notes, setNotes] = useState(detail.notes ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await updateParticipationDetail(uid, participationId, {
        ethicsStatus,
        ethicsReference: ethicsReference.trim() === "" ? null : ethicsReference.trim().slice(0, 200),
        trainingStatus,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      setOpen(false);
      toast.show({ title: "The onboarding details have been saved." });
    } catch (error) {
      setFailure(detailFailure(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setEthicsStatus(detail.ethicsStatus);
          setEthicsReference(detail.ethicsReference ?? "");
          setTrainingStatus(detail.trainingStatus);
          setNotes(detail.notes ?? "");
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" aria-label={`Edit details: ${label}`}>
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Onboarding details of ${label}`}
        description="These details are visible to the laboratory, the team of the replication and the programme only."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="Nothing was saved." description={failure} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Ethics">
              {(control) => (
                <Select
                  {...control}
                  value={ethicsStatus}
                  onChange={(event) => setEthicsStatus(event.target.value as Detail["ethicsStatus"])}
                >
                  {(Object.keys(ETHICS_STATUS_LABELS) as Detail["ethicsStatus"][]).map((status) => (
                    <option key={status} value={status}>
                      {ETHICS_STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Ethics reference" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  value={ethicsReference}
                  onChange={(event) => setEthicsReference(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <FormField label="Training">
            {(control) => (
              <Select
                {...control}
                value={trainingStatus}
                onChange={(event) => setTrainingStatus(event.target.value as Detail["trainingStatus"])}
              >
                {(Object.keys(TRAINING_STATUS_LABELS) as Detail["trainingStatus"][]).map((status) => (
                  <option key={status} value={status}>
                    {TRAINING_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Notes" hint="Optional.">
            {(control) => (
              <Textarea {...control} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Save the details
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EquipmentOverrideDialog({
  uid,
  participationId,
  current,
  label,
}: {
  uid: string;
  participationId: string;
  current: string | undefined;
  label: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" && current === undefined) {
      setError("Explain why the laboratory can take part although its equipment misses a requirement.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await updateParticipationDetail(uid, participationId, {
        equipmentOverrideJustification: trimmed === "" ? null : trimmed,
      });
      setOpen(false);
      toast.show({ title: trimmed === "" ? "The override has been removed." : "The override has been recorded." });
    } catch (failed) {
      setFailure(detailFailure(failed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText(current ?? "");
          setError(null);
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          aria-label={`${current === undefined ? "Record an override" : "Change the override"}: ${label}`}
        >
          {current === undefined ? "Record an override" : "Change the override"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Equipment override for ${label}`}
        description="An override records why the laboratory can take part although its equipment misses or does not state a requirement. Leave the text empty to remove it."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="Nothing was saved." description={failure} />}
          <FormField label="Justification" error={error}>
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                maxLength={10_000}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setError(null);
                }}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Save the override
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
