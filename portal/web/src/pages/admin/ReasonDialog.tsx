import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { CallableError } from "@/data";

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The label of the text field, for example "Reason". */
  label: string;
  hint?: string;
  /** Whether the text may be left empty. */
  optional?: boolean;
  maxLength?: number;
  confirmLabel: string;
  /** Controls shown above the text field, such as a choice of outcome. */
  children?: ReactNode;
  /** False while those controls hold a value that cannot be sent; they say why themselves. */
  canConfirm?: boolean;
  /** Carries the action out. A rejection is shown in the dialog, which stays open. */
  onConfirm: (text: string) => Promise<void>;
}

const fieldHint = (hint: string | undefined, optional: boolean): { hint?: string } =>
  hint !== undefined ? { hint } : optional ? { hint: "Optional." } : {};

/** A confirmation that asks for a reason or a note before an administrative action is carried out. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  hint,
  optional = false,
  maxLength = 2_000,
  confirmLabel,
  children,
  canConfirm = true,
  onConfirm,
}: ReasonDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) {
      setText("");
      setError(null);
      setFailure(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!canConfirm) return;
    if ((!optional && trimmed === "") || trimmed.length > maxLength) {
      setError(`Enter a ${label.toLowerCase()}, up to ${maxLength.toLocaleString("en-GB")} characters.`);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(trimmed);
      close(false);
    } catch (failed) {
      setFailure(failed instanceof CallableError ? failed.message : "This could not be done. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title={title} description={description}>
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure ? <ErrorState title="Nothing was changed." description={failure} /> : null}
          {children}
          <FormField label={label} {...fieldHint(hint, optional)} error={error}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={maxLength}
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
              {busy ? "Working on it…" : confirmLabel}
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
