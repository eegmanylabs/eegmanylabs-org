import { requestAccessContract } from "@eegml/shared";
import { type FormEvent, useRef, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CallableError, callFunction } from "@/data";

type Field = "statedName" | "affiliation" | "message";

const FIELD_MESSAGES: Readonly<Record<Field, string>> = {
  statedName: "Enter your name, up to 200 characters.",
  affiliation: "Enter your institution or laboratory, up to 300 characters.",
  message: "Say briefly how you take part in the programme, up to 2,000 characters.",
};

export interface RequestAccessFormProps {
  onSent: () => void;
  /** The heading of the form. */
  heading?: string;
  /** A sentence under the heading. */
  intro?: string;
  submitLabel?: string;
}

/**
 * A short statement for a reviewer: a request for access, for an account whose address matched
 * no member profile, or what helps a reviewer tell the candidates apart, for one that an
 * address match sent to review.
 */
export function RequestAccessForm({
  onSent,
  heading = "Ask for access",
  intro,
  submitLabel = "Send request",
}: RequestAccessFormProps) {
  const [values, setValues] = useState<Record<Field, string>>({ statedName: "", affiliation: "", message: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = { statedName: useRef<HTMLInputElement>(null), affiliation: useRef<HTMLInputElement>(null) };
  const messageField = useRef<HTMLTextAreaElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = requestAccessContract.input.safeParse(values);
    if (!parsed.success) {
      const wrong = new Set(parsed.error.issues.map((issue) => issue.path[0] as Field));
      setErrors(Object.fromEntries([...wrong].map((field) => [field, FIELD_MESSAGES[field]])));
      // Focus goes to the first field that needs attention, so that its message is read out.
      if (wrong.has("statedName")) fields.statedName.current?.focus();
      else if (wrong.has("affiliation")) fields.affiliation.current?.focus();
      else messageField.current?.focus();
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      await callFunction(requestAccessContract, parsed.data);
      onSent();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "Your request could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const change = (field: Field) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  return (
    <form noValidate onSubmit={submit} className="grid max-w-form gap-4" aria-labelledby="request-access-heading">
      <h3 id="request-access-heading" className="text-md font-medium text-fg-strong">
        {heading}
      </h3>
      {intro ? <p className="text-fg-secondary">{intro}</p> : null}
      {failure ? <ErrorState title="Your request was not sent." description={failure} /> : null}
      <FormField label="Your name" error={errors.statedName ?? null}>
        {(control) => (
          <Input
            {...control}
            ref={fields.statedName}
            name="statedName"
            autoComplete="name"
            maxLength={200}
            value={values.statedName}
            onChange={(event) => change("statedName")(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Affiliation" hint="Your institution or laboratory." error={errors.affiliation ?? null}>
        {(control) => (
          <Input
            {...control}
            ref={fields.affiliation}
            name="affiliation"
            autoComplete="organization"
            maxLength={300}
            value={values.affiliation}
            onChange={(event) => change("affiliation")(event.target.value)}
          />
        )}
      </FormField>
      <FormField
        label="Message"
        hint="How you take part in the programme, for example the replication or laboratory you work with."
        error={errors.message ?? null}
      >
        {(control) => (
          <Textarea
            {...control}
            ref={messageField}
            name="message"
            maxLength={2000}
            value={values.message}
            onChange={(event) => change("message")(event.target.value)}
          />
        )}
      </FormField>
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
