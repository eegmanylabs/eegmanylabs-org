import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createCorrectionRequest } from "@/data";

/** The details of a profile that a member can report as wrong, by the field that holds each. */
export const CORRECTABLE_PERSON_FIELDS = [
  { field: "displayName", label: "Name as shown" },
  { field: "givenName", label: "Given name" },
  { field: "familyName", label: "Family name" },
  { field: "affiliationSummary", label: "Affiliation" },
  { field: "laboratoryIds", label: "Laboratories" },
  { field: "replicationIds", label: "Replications" },
  { field: "countryCode", label: "Country" },
  { field: "orcid", label: "ORCID iD" },
] as const;

export const CORRECTABLE_FIELD_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  CORRECTABLE_PERSON_FIELDS.map((entry) => [entry.field, entry.label]),
);

const VALUE_MAX = 2_000;

/** A form, in a dialog, that reports one wrong detail of the member's own profile to the administrators. */
export function CorrectionRequestDialog({ uid, personId }: { uid: string; personId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string>(CORRECTABLE_PERSON_FIELDS[0].field);
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setField(CORRECTABLE_PERSON_FIELDS[0].field);
    setValue("");
    setMessage("");
    setValueError(null);
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const proposed = value.trim();
    if (proposed === "" || proposed.length > VALUE_MAX) {
      setValueError("Enter what the detail should say, up to 2,000 characters.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await createCorrectionRequest(uid, {
        entityType: "person",
        entityId: personId,
        field,
        proposedValue: proposed,
        ...(message.trim() === "" ? {} : { message: message.trim() }),
      });
      setOpen(false);
      reset();
      toast.show({
        title: "Your report has been sent.",
        description: "An administrator will look at it. You will get a notification when it is resolved.",
      });
    } catch {
      setFailure("Your report could not be sent. Check your connection and try again.");
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
        <Button size="sm">Report a wrong detail</Button>
      </DialogTrigger>
      <DialogContent
        title="Report a wrong detail"
        description="Tell the administrators which detail of your profile is wrong and what it should say. They correct the record."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure ? <ErrorState title="Your report was not sent." description={failure} /> : null}
          <FormField label="Which detail is wrong">
            {(control) => (
              <Select {...control} name="field" value={field} onChange={(event) => setField(event.target.value)}>
                {CORRECTABLE_PERSON_FIELDS.map((entry) => (
                  <option key={entry.field} value={entry.field}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="What it should say" error={valueError}>
            {(control) => (
              <Input
                {...control}
                name="proposedValue"
                maxLength={VALUE_MAX}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setValueError(null);
                }}
              />
            )}
          </FormField>
          <FormField label="Anything else the administrators should know" hint="Optional.">
            {(control) => (
              <Textarea
                {...control}
                name="message"
                rows={3}
                maxLength={VALUE_MAX}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Send report
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
