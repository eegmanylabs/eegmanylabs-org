// Turns a line of a page into an action item: a task in a list the person manages, with an
// assignee and a due date, linked to the page. The line then shows the task live.
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { addTask, instantOfDay, messageOf } from "@/pages/tasks/task-writes";
import { managesList, useTaskData } from "@/registry/task-data";
import type { Viewer } from "@/registry/viewer";
import type { MentionCandidate } from "./members";

export interface ActionItemDialogProps {
  readonly viewer: Viewer;
  readonly pageId: string;
  readonly line: { readonly blockId: string; readonly text: string } | null;
  readonly members: readonly MentionCandidate[];
  readonly onClose: () => void;
  readonly onCreated: (blockId: string, taskId: string, title: string) => void;
}

export function ActionItemDialog({ viewer, pageId, line, members, onClose, onCreated }: ActionItemDialogProps) {
  const data = useTaskData(line === null ? null : viewer);
  const lists =
    data.status === "ready"
      ? data.data.lists.filter(
          (list) => list.archivedAt === null && list.kind !== "template" && managesList(viewer, list),
        )
      : [];
  const [title, setTitle] = useState(line?.text ?? "");
  const [listId, setListId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosenList = listId === "" ? (lists[0]?.id ?? "") : listId;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (line === null) return;
    const trimmed = title.trim();
    if (trimmed === "" || chosenList === "") {
      setFailure("Give the action item a title and choose its list.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const dueAt = due === "" ? null : instantOfDay(due);
      const taskId = await addTask(chosenList, null, {
        title: trimmed.slice(0, 300),
        links: [{ entityType: "page", entityId: pageId }],
        ...(assignee === "" ? {} : { assigneeUids: [assignee] }),
        ...(dueAt === null ? {} : { dueAt }),
      });
      onCreated(line.blockId, taskId, trimmed.slice(0, 300));
    } catch (error) {
      setFailure(messageOf(error, "The action item was not created."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={line !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title="Make an action item"
        description="The line becomes a task in a list that you manage, linked to this page, and the page shows the task."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="The action item was not created." description={failure} />}
          <FormField label="Task">
            {(control) => (
              <Input {...control} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
            )}
          </FormField>
          {data.status === "ready" && lists.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              You manage no task list yet. Create a personal list or one of your scope on the Tasks page first.
            </p>
          ) : (
            <FormField label="List">
              {(control) => (
                <Select {...control} value={chosenList} onChange={(event) => setListId(event.target.value)}>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Assignee">
            {(control) => (
              <Select {...control} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                <option value="">Nobody yet</option>
                {members.map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Due">
            {(control) => (
              <Input {...control} type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            )}
          </FormField>
          <div>
            <Button type="submit" variant="primary" disabled={busy || lists.length === 0}>
              {busy ? "Creating the action item…" : "Create the action item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
