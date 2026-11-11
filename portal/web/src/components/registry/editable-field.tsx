// A field of a record that the people allowed to may edit where it is shown. The value is
// checked against the shared schema before anything is sent. The change is written at once to
// the local copy, so the page shows it while the server confirms it, marked as not saved yet
// until the server has answered, and if the security rules refuse it the local copy returns to
// the stored value and the person is told why.
import type { z } from "@eegml/shared";
import { Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Detail } from "./details";
import { Unknown } from "./unknown";

export type EditableValue = string | number | boolean;

export type FieldKind = "text" | "longText" | "year" | "url" | "doi" | "yesNo";

export interface EditableFieldProps {
  label: string;
  value: EditableValue | undefined;
  kind: FieldKind;
  /** The schema of the field in the shared package, which decides what is valid. */
  schema: z.ZodType;
  /** What the person is told when the value does not fit, for example "Enter a year from 1800 to 2200." */
  invalidMessage: string;
  canEdit: boolean;
  /** Writes the value, or removes it where the person cleared the field. Rejects when the write is refused. */
  onSave: (value: EditableValue | null) => Promise<void>;
  /** How the stored value is shown. The value itself where absent. */
  display?: (value: EditableValue) => ReactNode;
}

/** How long a save may wait for the server before the person is told that it waits for the connection. */
export const SLOW_SAVE_MS = 8_000;

/** The text of a failure to save, by what went wrong. */
export function saveFailureMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "permission-denied") {
    return "The change was refused: your account may not edit this field. Your edit has been undone. If you think you should be able to, ask a programme administrator.";
  }
  if (code === "unavailable") return "The portal could not reach its server. Check your connection and save again.";
  return "The change could not be saved. Reload the page and try again.";
}

function toText(value: EditableValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/** Reads the typed text as the value the schema expects, or null for an empty field. */
export function readFieldInput(kind: FieldKind, text: string): EditableValue | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (kind === "year") return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (kind === "yesNo") return trimmed === "yes";
  return trimmed;
}

export function EditableField({
  label,
  value,
  kind,
  schema,
  invalidMessage,
  canEdit,
  onSave,
  display,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!saving) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [saving]);

  const start = () => {
    setDraft(toText(value));
    setError(null);
    setFailure(null);
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = readFieldInput(kind, draft);
    if (next !== null && !schema.safeParse(next).success) {
      setError(invalidMessage);
      return;
    }
    setError(null);
    setSaving(true);
    // The local copy shows the new value at once; the form closes without waiting for the server.
    setEditing(false);
    try {
      await onSave(next);
    } catch (saveError) {
      setFailure(saveFailureMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const shown =
    value === undefined || value === "" ? <Unknown /> : display === undefined ? toText(value) : display(value);

  return (
    <Detail term={label}>
      {editing ? (
        <form onSubmit={submit} className="grid gap-2" noValidate>
          <FormField label={`New value of ${label.toLowerCase()}`} error={error}>
            {(control) =>
              kind === "longText" ? (
                <Textarea {...control} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
              ) : kind === "yesNo" ? (
                <Select {...control} value={draft} onChange={(event) => setDraft(event.target.value)}>
                  <option value="">Not recorded</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              ) : (
                <Input
                  {...control}
                  inputMode={kind === "year" ? "numeric" : undefined}
                  type={kind === "url" ? "url" : "text"}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )
            }
          </FormField>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary">
              Save
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">{shown}</div>
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${label.toLowerCase()}`}
              disabled={saving}
              onClick={start}
              className="shrink-0"
            >
              <Pencil aria-hidden="true" strokeWidth={1.8} />
              Edit
            </Button>
          ) : null}
        </div>
      )}
      {saving ? (
        <p role="status" className="mt-1 text-xs text-fg-secondary" data-testid="not-saved-yet">
          {slow ? "Not saved yet. It will be saved when the connection returns." : "Not saved yet"}
        </p>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="mt-1 text-xs text-fg-accent">
          {failure}
        </p>
      )}
    </Detail>
  );
}
