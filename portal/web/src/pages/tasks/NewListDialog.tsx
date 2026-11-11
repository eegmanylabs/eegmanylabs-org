// A new task list: a personal list of the viewer's own, or a project or template list of a scope
// the viewer manages, empty or made from a template whose tasks it copies.
import { createTaskListContract, PROGRAMME_KEY } from "@eegml/shared";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callFunction } from "@/data";
import type { TaskListRecord } from "@/registry/task-data";
import type { Viewer } from "@/registry/viewer";
import { messageOf } from "./task-writes";

/** A scope in which the viewer may create a list, as `scopeType:scopeId`. */
export interface ListScope {
  readonly value: string;
  readonly label: string;
}

/** The scopes in which the viewer manages task lists: their own, and those their roles cover. */
export function scopesOf(
  viewer: Viewer,
  names: { readonly replications: readonly string[]; readonly laboratories: ReadonlyMap<string, string> },
): ListScope[] {
  const scopes: ListScope[] = [{ value: `user:${viewer.uid}`, label: "Only me: a personal list" }];
  if (viewer.can("tasks.manage", "programme"))
    scopes.push({ value: `programme:${PROGRAMME_KEY}`, label: "The programme" });
  for (const studyKey of names.replications) {
    if (viewer.can("tasks.manage", { replicationId: studyKey })) {
      scopes.push({ value: `replication:${studyKey}`, label: `Replication ${studyKey}` });
    }
  }
  for (const [laboratoryId, name] of names.laboratories) {
    if (viewer.can("tasks.manage", { laboratoryId }))
      scopes.push({ value: `laboratory:${laboratoryId}`, label: `Laboratory ${name}` });
  }
  for (const groupKey of viewer.access.groupKeys) {
    if (viewer.can("tasks.manage", { groupKey }))
      scopes.push({ value: `group:${groupKey}`, label: `Group ${groupKey}` });
  }
  return scopes;
}

export function NewListDialog({
  scopes,
  templates,
  onCreated,
}: {
  readonly scopes: readonly ListScope[];
  readonly templates: readonly TaskListRecord[];
  readonly onCreated: (listId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState(scopes[0]?.value ?? "");
  const [template, setTemplate] = useState("");
  const [asTemplate, setAsTemplate] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const personal = scope.startsWith("user:");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    setNameError(trimmed === "" ? "Give the list a name." : null);
    if (trimmed === "") return;
    const [scopeType, ...rest] = scope.split(":");
    setBusy(true);
    setFailure(null);
    try {
      const { listId } = await callFunction(createTaskListContract, {
        name: trimmed,
        kind: personal ? "personal" : asTemplate ? "template" : "project",
        scopeType: scopeType as "user",
        scopeId: rest.join(":"),
        ...(template === "" ? {} : { templateListId: template }),
      });
      setOpen(false);
      setName("");
      setTemplate("");
      setAsTemplate(false);
      onCreated(listId);
    } catch (error) {
      setFailure(messageOf(error, "The list was not created. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary">
          <Plus aria-hidden="true" strokeWidth={1.8} />
          New list
        </Button>
      </DialogTrigger>
      <DialogContent title="New task list" description="A list belongs to you alone, or to a scope that you manage.">
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The list was not created." description={failure} />}
          <FormField label="Name" error={nameError}>
            {(control) => (
              <Input {...control} value={name} maxLength={300} onChange={(event) => setName(event.target.value)} />
            )}
          </FormField>
          <FormField label="Belongs to">
            {(control) => (
              <Select {...control} value={scope} onChange={(event) => setScope(event.target.value)}>
                {scopes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {personal ? null : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent-strong"
                checked={asTemplate}
                onChange={(event) => setAsTemplate(event.target.checked)}
              />
              A template, from which other lists are made
            </label>
          )}
          <FormField
            label="Start from a template"
            hint="Its tasks are copied with their subtasks, order, dependencies and checklists."
          >
            {(control) => (
              <Select {...control} value={template} onChange={(event) => setTemplate(event.target.value)}>
                <option value="">An empty list</option>
                {templates.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating the list…" : "Create the list"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
