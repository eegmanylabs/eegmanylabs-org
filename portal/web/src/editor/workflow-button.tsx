// A workflow button in a page (R3.37): a button that an editor configures to add a row to a
// database, create a task in a list, or create a page inside a page, from a template or empty.
// Pressing it runs the same callable function as doing so anywhere else, which decides whether
// the person who pressed it may, so the button grants nothing. The configuration travels with the
// page in the block's props.
import {
  createPageContract,
  createTaskContract,
  saveRecordsContract,
  WORKFLOW_ACTIONS,
  type WorkflowAction,
  workflowTitle,
} from "@eegml/shared";
import { MousePointerClick, Settings2 } from "lucide-react";
import { createContext, type FormEvent, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CallableError, callFunction, useLiveQuery } from "@/data";
import { pagePath } from "@/registry/paths";
import type { Viewer } from "@/registry/viewer";
import { useProvidedViewHost } from "@/views/host";

/** The page that the editor shows, which a button that creates pages creates them inside by default. */
export const EditorPageContext = createContext<string | null>(null);

export interface WorkflowButtonProps {
  readonly label: string;
  readonly action: WorkflowAction;
  readonly target: string;
  readonly templateId: string;
  readonly title: string;
}

const ACTION_LABELS: Readonly<Record<WorkflowAction, string>> = {
  addRow: "Add a row to a database",
  newTask: "Create a task in a list",
  newPage: "Create a page inside this page",
};

const TARGET_LABELS: Readonly<Record<WorkflowAction, string>> = {
  addRow: "Database",
  newTask: "Task list",
  newPage: "Start from",
};

/** Today in the browser's time zone, as YYYY-MM-DD. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The choices of target for an action: databases, task lists or page templates the viewer reads. */
function useTargets(viewer: Viewer, action: WorkflowAction): readonly { readonly id: string; readonly name: string }[] {
  const scoped = viewer.staff
    ? []
    : ([["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]]] as const satisfies readonly unknown[]);
  const databases = useLiveQuery(
    action === "addRow" ? { collection: "databases", within: [], where: [...scoped], limit: 1_000 } : null,
  );
  const lists = useLiveQuery(
    action === "newTask" ? { collection: "taskLists", within: [], where: [...scoped], limit: 1_000 } : null,
  );
  const ownLists = useLiveQuery(
    action === "newTask" && !viewer.staff
      ? { collection: "taskLists", within: [], where: [["ownerUid", "==", viewer.uid]], limit: 1_000 }
      : null,
  );
  const templates = useLiveQuery(
    action === "newPage"
      ? { collection: "pages", within: [], where: [["kind", "==", "custom"], ...scoped], limit: 1_000 }
      : null,
  );
  if (action === "addRow") {
    return databases.status === "ready"
      ? databases.data.filter((entry) => entry.archivedAt === null).map(({ id, name }) => ({ id, name }))
      : [];
  }
  if (action === "newTask") {
    const all = [
      ...(lists.status === "ready" ? lists.data : []),
      ...(ownLists.status === "ready" ? ownLists.data : []),
    ];
    const seen = new Set<string>();
    return all.flatMap((list) => {
      if (seen.has(list.id) || list.archivedAt !== null || list.kind === "template") return [];
      seen.add(list.id);
      return [{ id: list.id, name: list.name }];
    });
  }
  return templates.status === "ready"
    ? templates.data
        .filter((page) => page.isTemplate && page.archivedAt === null)
        .map((page) => ({ id: page.id, name: page.title }))
    : [];
}

/** Where an editor sets what the button says and does. */
function Configure({
  viewer,
  initial,
  onSave,
  onCancel,
}: {
  readonly viewer: Viewer;
  readonly initial: WorkflowButtonProps;
  readonly onSave: (next: WorkflowButtonProps) => void;
  readonly onCancel: (() => void) | null;
}) {
  const [label, setLabel] = useState(initial.label);
  const [action, setAction] = useState<WorkflowAction>(initial.action);
  const [target, setTarget] = useState(initial.action === "newPage" ? initial.templateId : initial.target);
  const [title, setTitle] = useState(initial.title);
  const [error, setError] = useState<string | null>(null);
  const targets = useTargets(viewer, action);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === "") {
      setError("Give the button a label.");
      return;
    }
    if (action !== "newPage" && target === "") {
      setError(action === "addRow" ? "Choose the database." : "Choose the task list.");
      return;
    }
    onSave({
      label: label.trim(),
      action,
      target: action === "newPage" ? "" : target,
      templateId: action === "newPage" ? target : "",
      title: title.trim(),
    });
  };
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} aria-label="Workflow button">
      <FormField label="Label">
        {(control) => (
          <Input {...control} value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        )}
      </FormField>
      <FormField label="When pressed">
        {(control) => (
          <Select
            {...control}
            value={action}
            onChange={(event) => {
              setAction(event.target.value as WorkflowAction);
              setTarget("");
            }}
          >
            {WORKFLOW_ACTIONS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {ACTION_LABELS[candidate]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label={TARGET_LABELS[action]}>
        {(control) => (
          <Select {...control} value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{action === "newPage" ? "An empty page" : "Choose"}</option>
            {targets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Title of what it creates" hint="Write {date} where the day it is pressed goes.">
        {(control) => (
          <Input
            {...control}
            value={title}
            maxLength={200}
            placeholder="The label of the button"
            onChange={(event) => setTitle(event.target.value)}
          />
        )}
      </FormField>
      {error === null ? null : (
        <p role="alert" className="text-sm text-fg-accent sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" size="sm">
          Save the button
        </Button>
        {onCancel === null ? null : (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** What pressing a button did, with a link to what it created. */
interface Outcome {
  readonly text: string;
  readonly to: string | null;
}

export function WorkflowButtonBlock({
  props,
  editable,
  onChange,
}: {
  readonly props: WorkflowButtonProps;
  readonly editable: boolean;
  readonly onChange: (next: WorkflowButtonProps) => void;
}) {
  const host = useProvidedViewHost();
  const pageId = useContext(EditorPageContext);
  const configured = props.label !== "" && (props.action === "newPage" || props.target !== "");
  const [configuring, setConfiguring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  if (host === null) return <p className="text-sm text-fg-muted">Loading the button</p>;
  if (!configured || configuring) {
    return editable ? (
      <div className="w-full rounded-tile border border-border p-3" data-testid="workflow-button-setup">
        <Configure
          viewer={host.viewer}
          initial={props}
          onCancel={configured ? () => setConfiguring(false) : null}
          onSave={(next) => {
            onChange(next);
            setConfiguring(false);
          }}
        />
      </div>
    ) : (
      <p className="text-sm text-fg-muted">This button is not set up yet.</p>
    );
  }
  const press = async () => {
    setBusy(true);
    setOutcome(null);
    const title = workflowTitle(props, today());
    try {
      if (props.action === "addRow") {
        await callFunction(saveRecordsContract, {
          collectionKey: `db:${props.target}`,
          changes: [{ title, values: {} }],
        });
        setOutcome({ text: `Added “${title}”.`, to: `/databases/${encodeURIComponent(props.target)}` });
      } else if (props.action === "newTask") {
        const { taskId } = await callFunction(createTaskContract, {
          listId: props.target,
          parentId: null,
          fields: { title },
        });
        setOutcome({ text: `Created the task “${title}”.`, to: `/tasks?task=${encodeURIComponent(taskId)}` });
      } else {
        const { pageId: created } = await callFunction(createPageContract, {
          parentPageId: pageId,
          title,
          ...(props.templateId === "" ? {} : { templatePageId: props.templateId }),
        });
        setOutcome({ text: `Created the page “${title}”.`, to: pagePath(created) });
      }
    } catch (failure) {
      setOutcome({
        text: failure instanceof CallableError ? failure.message : "Nothing was created. Try again.",
        to: null,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-2" data-testid="workflow-button">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void press()}>
        <MousePointerClick aria-hidden="true" strokeWidth={1.8} />
        {props.label}
      </Button>
      {editable ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Change the button ${props.label}`}
          onClick={() => setConfiguring(true)}
        >
          <Settings2 aria-hidden="true" strokeWidth={1.8} />
        </Button>
      ) : null}
      {outcome === null ? null : (
        <span role="status" className="text-sm text-fg-secondary">
          {outcome.text}{" "}
          {outcome.to === null ? null : (
            <a href={`#${outcome.to}`} className="text-fg-accent underline">
              Open it
            </a>
          )}
        </span>
      )}
    </div>
  );
}
