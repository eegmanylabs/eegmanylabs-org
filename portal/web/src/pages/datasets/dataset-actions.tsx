// What the dialogs of a dataset share: a call to a function with its busy and failed states, and
// the frame of a form in a dialog. Every action goes through a callable function, which decides
// who may act and records the action in the audit trail; the interface only offers it.
import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CallableError } from "@/data";

/** A call that a person starts, with its state. `run` resolves true when the call succeeded. */
export function useAction(): {
  readonly busy: boolean;
  readonly failure: string | null;
  readonly clear: () => void;
  run(call: () => Promise<unknown>, done: string | null, fallback: string): Promise<boolean>;
} {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return {
    busy,
    failure,
    clear: () => setFailure(null),
    async run(call, done, fallback) {
      setBusy(true);
      setFailure(null);
      try {
        await call();
        if (done !== null) toast.show({ title: done });
        return true;
      } catch (error) {
        setFailure(error instanceof CallableError ? error.message : fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

/** A dialog holding one form: its fields, the reason it failed and its two buttons. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  busy,
  failure,
  failureTitle,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  busy: boolean;
  failure: string | null;
  failureTitle: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} {...(description === undefined ? {} : { description })}>
        <form
          noValidate
          className="mt-5 grid gap-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {failure === null ? null : <ErrorState title={failureTitle} description={failure} />}
          {children}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Working on it…" : submitLabel}
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

/** Lines of "name: value", as a map of texts and numbers, or null where a line has no colon. */
export function parseValues(text: string): Record<string, string | number> | null {
  const values: Record<string, string | number> = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return null;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name === "" || name.length > 100 || value.length > 300) return null;
    values[name] = value !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
  }
  return Object.keys(values).length > 100 ? null : values;
}
