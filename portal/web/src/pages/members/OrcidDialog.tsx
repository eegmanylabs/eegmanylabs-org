import { setPersonOrcidContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction } from "@/data";

/**
 * Sets, changes or removes the ORCID iD of a person through `setPersonOrcid`, which reserves the
 * iD so that no two persons hold it. A person states that the iD is their own.
 */
export function OrcidDialog({ personId, current, own }: { personId: string; current: string | null; own: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const orcid = value.trim().toUpperCase();
    const input = { personId, orcid: orcid === "" ? null : orcid, confirmedOwn: own && confirmed };
    const parsed = setPersonOrcidContract.input.safeParse(input);
    setError(
      parsed.success ? null : "Enter an ORCID iD such as 0000-0002-1825-0097, or leave the field empty to remove it.",
    );
    setConfirmError(own && !confirmed ? "Confirm that this ORCID iD is your own." : null);
    if (!parsed.success || (own && !confirmed)) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setPersonOrcidContract, input);
      setOpen(false);
      toast.show({ title: input.orcid === null ? "The ORCID iD has been removed." : "The ORCID iD has been saved." });
    } catch (callError) {
      setFailure(
        callError instanceof CallableError ? callError.message : "The ORCID iD could not be saved. Try again.",
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
        if (next) {
          setValue(current ?? "");
          setConfirmed(false);
          setError(null);
          setConfirmError(null);
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {current === null ? "Add ORCID iD" : "Change ORCID iD"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={current === null ? "Add an ORCID iD" : "Change the ORCID iD"}
        description="The programme uses the iD to find this person again in its records. No two people can hold the same iD."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The ORCID iD was not saved." description={failure} />}
          <FormField
            label="ORCID iD"
            hint="Sixteen digits in groups of four, for example 0000-0002-1825-0097."
            error={error}
          >
            {(control) => (
              <Input {...control} value={value} maxLength={19} onChange={(event) => setValue(event.target.value)} />
            )}
          </FormField>
          {own ? (
            <FormField label="This ORCID iD is my own" error={confirmError}>
              {(control) => (
                <input
                  {...control}
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="size-5 cursor-pointer"
                />
              )}
            </FormField>
          ) : null}
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Save the ORCID iD
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
