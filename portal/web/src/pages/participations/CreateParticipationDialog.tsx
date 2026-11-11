// Adds a laboratory to a replication through `createParticipation`, which the leads of the
// replication, the core team and administrators may call. The function writes the participation
// with its checklist and its history; a laboratory that takes part already is refused there.
import { createParticipationContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction } from "@/data";
import { laboratoryDialogPath } from "@/registry/paths";

export interface LaboratoryChoice {
  readonly id: string;
  readonly name: string;
}

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
  readonly laboratoryIds: readonly string[];
}

/** Reads a target as a whole number, null for an empty field, or NaN where it is no count. */
function readTarget(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d{1,7}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * What the dialog says when there is no laboratory to add: none is registered in the portal
 * yet, which is how a real project starts, or every one takes part already.
 */
export function NoLaboratoryToAdd({ registeredCount, canCreate }: { registeredCount: number; canCreate: boolean }) {
  if (registeredCount > 0) {
    return <p className="text-fg-secondary">Every laboratory in the portal takes part in this replication already.</p>;
  }
  return (
    <div className="grid gap-2" data-testid="no-laboratory-registered">
      <p className="text-fg-secondary">
        No laboratory is registered in the portal yet. A laboratory is registered by one of its members and reviewed by
        the programme, and then it can be added here.
      </p>
      <p className="flex flex-wrap gap-3">
        <Link className="text-fg-accent underline" to={laboratoryDialogPath("register")}>
          Register a laboratory
        </Link>
        {canCreate ? (
          <Link className="text-fg-accent underline" to={laboratoryDialogPath("create")}>
            Create a laboratory
          </Link>
        ) : null}
      </p>
    </div>
  );
}

export function CreateParticipationDialog({
  studyKey,
  laboratories,
  registeredCount,
  canCreateLaboratory,
  persons,
}: {
  studyKey: string;
  /** The laboratories that do not take part yet. */
  laboratories: readonly LaboratoryChoice[];
  /** How many laboratories the portal holds, whether or not they take part. */
  registeredCount: number;
  /** Whether the account may create a laboratory directly. */
  canCreateLaboratory: boolean;
  persons: readonly PersonChoice[];
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [laboratoryId, setLaboratoryId] = useState("");
  const [localLead, setLocalLead] = useState("");
  const [main, setMain] = useState("");
  const [rest, setRest] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ laboratory?: string; main?: string; rest?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setLaboratoryId("");
    setLocalLead("");
    setMain("");
    setRest("");
    setReason("");
    setErrors({});
    setFailure(null);
  };
  const leads = persons.filter((person) => person.laboratoryIds.includes(laboratoryId));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const targetNMain = readTarget(main);
    const targetNRest = readTarget(rest);
    const found = {
      ...(laboratoryId === "" ? { laboratory: "Choose the laboratory to add." } : {}),
      ...(Number.isNaN(targetNMain) ? { main: "Enter a whole number of participants, or leave it empty." } : {}),
      ...(Number.isNaN(targetNRest) ? { rest: "Enter a whole number of participants, or leave it empty." } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(createParticipationContract, {
        replicationId: studyKey,
        laboratoryId,
        ...(localLead === "" ? {} : { localLeadPersonId: localLead }),
        ...(targetNMain === null ? {} : { targetNMain }),
        ...(targetNRest === null ? {} : { targetNRest }),
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
      });
      setOpen(false);
      reset();
      toast.show({
        title: "The laboratory has been invited.",
        description: "Its onboarding checklist is ready on its participation.",
      });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The laboratory could not be added. Try again.");
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
        <Button variant="primary">Add a laboratory</Button>
      </DialogTrigger>
      <DialogContent
        title={`Add a laboratory to ${studyKey}`}
        description="The laboratory is invited to the replication, and its onboarding checklist is created from the programme's template."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="No laboratory was added." description={failure} />}
          {laboratories.length === 0 ? (
            <NoLaboratoryToAdd registeredCount={registeredCount} canCreate={canCreateLaboratory} />
          ) : null}
          {laboratories.length === 0 ? null : (
            <>
              <FormField label="Laboratory" error={errors.laboratory ?? null}>
                {(control) => (
                  <Select
                    {...control}
                    value={laboratoryId}
                    onChange={(event) => {
                      setLaboratoryId(event.target.value);
                      setLocalLead("");
                    }}
                  >
                    <option value="">Choose a laboratory</option>
                    {laboratories.map((laboratory) => (
                      <option key={laboratory.id} value={laboratory.id}>
                        {laboratory.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label="Local lead" hint="Optional. The confirmed members of the laboratory.">
                {(control) => (
                  <Select {...control} value={localLead} onChange={(event) => setLocalLead(event.target.value)}>
                    <option value="">Not decided yet</option>
                    {leads.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Target, main experiment" hint="Participants. Optional." error={errors.main ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="numeric"
                      value={main}
                      onChange={(event) => setMain(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Target, resting state" hint="Participants. Optional." error={errors.rest ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      inputMode="numeric"
                      value={rest}
                      onChange={(event) => setRest(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
              <FormField label="Reason" hint="Optional. Recorded in the history of the participation.">
                {(control) => (
                  <Textarea
                    {...control}
                    rows={2}
                    maxLength={2_000}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                )}
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy ? "Inviting the laboratory…" : "Invite the laboratory"}
                </Button>
              </div>
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
