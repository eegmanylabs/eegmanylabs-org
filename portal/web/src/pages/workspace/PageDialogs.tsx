// The dialogs of the workspace: a new page, a move, an icon and the keyboard shortcuts of the
// editor. Creating and moving a page go through callable functions, which resolve its audience.
import { createPageContract, movePageContract, orderBetween } from "@eegml/shared";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { useNavigate } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, updatePageFields } from "@/data";
import { KEYBOARD_SHORTCUTS } from "@/editor/shortcuts";
import { pagePath } from "@/registry/paths";
import { cn } from "@/utils/cn";

/** The icons a page may take. Each is one character, which every platform shows. */
export const PAGE_ICONS = [
  "📄",
  "🗒️",
  "📋",
  "📌",
  "📎",
  "📊",
  "📈",
  "🧪",
  "🧠",
  "🔬",
  "⚡",
  "🧾",
  "🗂️",
  "📅",
  "✅",
  "❓",
  "💡",
  "⚠️",
  "🎯",
  "🛠️",
  "🌍",
  "👥",
  "📝",
  "🔖",
  "📚",
  "🗳️",
  "🏷️",
  "🔒",
  "⭐",
  "🔔",
] as const;

const failureOf = (error: unknown, fallback: string) => (error instanceof CallableError ? error.message : fallback);

/** A new page: at the top of the workspace or beneath a page, empty or from a template. */
export function NewPageDialog({
  open,
  onOpenChange,
  parent,
  templates,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The page the new one goes beneath, or null for the top of the workspace. */
  readonly parent: { readonly id: string; readonly title: string } | null;
  readonly templates: readonly RecordOf<"pages">[];
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") {
      setError("Give the page a title.");
      return;
    }
    setError(null);
    setBusy(true);
    setFailure(null);
    try {
      const { pageId } = await callFunction(createPageContract, {
        parentPageId: parent?.id ?? null,
        title: title.trim(),
        ...(template === "" ? {} : { templatePageId: template }),
      });
      onOpenChange(false);
      navigate(pagePath(pageId));
    } catch (callError) {
      setFailure(failureOf(callError, "The page could not be created. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setTitle("");
          setTemplate("");
          setError(null);
          setFailure(null);
        }
      }}
    >
      <DialogContent
        title={parent === null ? "New page" : "New page inside"}
        description={
          parent === null
            ? "A page at the top of the workspace, which every member reads and edits."
            : `A page inside “${parent.title}”, which follows who may read and edit it.`
        }
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The page was not created." description={failure} />}
          <FormField label="Title" error={error}>
            {(control) => (
              <Input {...control} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
            )}
          </FormField>
          {templates.length === 0 ? null : (
            <FormField label="Start from" hint="A template copies its content into the new page.">
              {(control) => (
                <Select {...control} value={template} onChange={(event) => setTemplate(event.target.value)}>
                  <option value="">An empty page</option>
                  {templates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Create the page
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A move of a page beneath another, or to the top of the workspace, after the siblings that are there. */
export function MovePageDialog({
  open,
  onOpenChange,
  page,
  candidates,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly page: RecordOf<"pages">;
  /** Every page of the workspace the reader may read. Those beneath the page itself are left out here. */
  readonly candidates: readonly RecordOf<"pages">[];
}) {
  const toast = useToast();
  const [target, setTarget] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = candidates.filter(
    (candidate) =>
      candidate.id !== page.id &&
      candidate.archivedAt === null &&
      !candidate.ancestorPageIds.includes(page.id) &&
      candidate.id !== page.parentPageId,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parentPageId = target === "" ? null : target;
    const lastSibling = candidates
      .filter((candidate) => candidate.parentPageId === parentPageId && candidate.id !== page.id)
      .map((candidate) => candidate.order)
      .sort()
      .at(-1);
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(movePageContract, {
        pageId: page.id,
        parentPageId,
        order: orderBetween(lastSibling ?? null, null),
      });
      onOpenChange(false);
      toast.show({ title: "The page has been moved." });
    } catch (callError) {
      setFailure(failureOf(callError, "The page could not be moved. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setTarget("");
          setFailure(null);
        }
      }}
    >
      <DialogContent
        title="Move the page"
        description="The page moves with every page inside it. Pages that follow their parent take the readers and editors of their new place."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The page was not moved." description={failure} />}
          <FormField label="Move to">
            {(control) => (
              <Select {...control} value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">The top of the workspace</option>
                {allowed
                  .slice()
                  .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }))
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      Inside {candidate.title}
                    </option>
                  ))}
              </Select>
            )}
          </FormField>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              Move the page
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The icon of a page, chosen from a grid that the arrow keys move through. */
export function IconDialog({
  open,
  onOpenChange,
  page,
  uid,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly page: RecordOf<"pages">;
  readonly uid: string;
}) {
  const toast = useToast();
  const choose = async (icon: string | null) => {
    try {
      await updatePageFields(uid, page.id, { icon });
      onOpenChange(false);
    } catch {
      toast.show({ tone: "error", title: "The icon was not changed.", description: "Try again." });
    }
  };
  const columns = 6;
  const move = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    const step = steps[event.key];
    if (step === undefined || !(event.target instanceof HTMLButtonElement)) return;
    const buttons = [...event.currentTarget.querySelectorAll("button")];
    const next = buttons[buttons.indexOf(event.target) + step];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Choose an icon" description="The icon shows beside the title in the workspace.">
        <fieldset onKeyDown={move} className="mt-5 grid grid-cols-6 gap-1">
          <legend className="sr-only">Icons</legend>
          {PAGE_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={`Use ${icon}`}
              aria-pressed={page.icon === icon}
              onClick={() => void choose(icon)}
              className={cn(
                "flex size-11 cursor-pointer items-center justify-center rounded-control border text-xl",
                page.icon === icon ? "border-accent" : "border-transparent hover:border-border",
              )}
            >
              {icon}
            </button>
          ))}
        </fieldset>
        {page.icon === undefined ? null : (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => void choose(null)}>
              Remove the icon
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The shortcuts that the editor offers, including those that reach its toolbar and its blocks from the keyboard. */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="On a Mac, Command stands for Control.">
        <dl className="mt-5 grid gap-2">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="grid grid-cols-[minmax(0,12rem)_1fr] gap-3">
              <dt>
                <kbd className="rounded-control border border-border px-1.5 text-xs">{shortcut.keys}</kbd>
              </dt>
              <dd className="text-fg-secondary">{shortcut.does}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** Saves a version of a page, with a name that the person may give it. */
export function SaveVersionDialog({
  open,
  onOpenChange,
  busy,
  onSave,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly busy: boolean;
  /** Saves the version with its name, or without one. Resolves whether it was saved. */
  readonly onSave: (label: string | undefined) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (await onSave(trimmed === "" ? undefined : trimmed)) {
      setLabel("");
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Save a version" description="The version keeps the page as it is now.">
        <form className="mt-4 grid gap-4" onSubmit={(event) => void submit(event)}>
          <FormField label="Name of the version" hint="Optional. For example, Before the data freeze.">
            {(control) => (
              <Input {...control} value={label} maxLength={300} onChange={(event) => setLabel(event.target.value)} />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              Save the version
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
