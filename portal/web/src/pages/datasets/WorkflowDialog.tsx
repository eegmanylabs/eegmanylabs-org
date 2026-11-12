// Defines the workflow of a replication's datasets through `saveDatasetWorkflow`, for its leads,
// programme administrators and the core team: the states, the first state, which state may follow
// which, and the state in which a dataset is ready for analysis. The function checks that the
// workflow is sound and that no dataset is left in a state that the workflow drops.
import {
  type DatasetWorkflow,
  type DatasetWorkflowState,
  keySchema,
  saveDatasetWorkflowContract,
  workflowProblems,
} from "@eegml/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callFunction } from "@/data";
import { FormDialog, useAction } from "./dataset-actions";

const CATEGORY_LABELS: Readonly<Record<DatasetWorkflowState["category"], string>> = {
  notStarted: "Not started",
  active: "In progress",
  paused: "Held",
  done: "Done",
  cancelled: "Stopped",
};

/** A key for a new state from its label, as the registry accepts it. */
export function stateKeyOf(label: string, taken: readonly string[]): string {
  const words = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const base =
    words
      .map((word, index) =>
        index === 0 ? word.toLowerCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`,
      )
      .join("") || "state";
  let key = base.slice(0, 90);
  for (let suffix = 2; taken.includes(key); suffix += 1) key = `${base.slice(0, 85)}${suffix}`;
  return key;
}

export function WorkflowDialog({
  replicationId,
  workflow,
  onClose,
}: {
  replicationId: string;
  workflow: DatasetWorkflow;
  onClose: () => void;
}) {
  const action = useAction();
  const [states, setStates] = useState<DatasetWorkflowState[]>([...workflow.states]);
  const [transitions, setTransitions] = useState<Record<string, string[]>>(
    Object.fromEntries(workflow.states.map((state) => [state.key, [...(workflow.transitions[state.key] ?? [])]])),
  );
  const [initialKey, setInitialKey] = useState(workflow.initialKey);
  const [label, setLabel] = useState("");
  const draft: DatasetWorkflow = { states, transitions, initialKey };
  const problems = workflowProblems(draft);
  const change = (key: string, patch: Partial<DatasetWorkflowState>) =>
    setStates(states.map((state) => (state.key === key ? { ...state, ...patch } : state)));
  const remove = (key: string) => {
    setStates(states.filter((state) => state.key !== key));
    setTransitions(
      Object.fromEntries(
        Object.entries(transitions)
          .filter(([from]) => from !== key)
          .map(([from, targets]) => [from, targets.filter((to) => to !== key)]),
      ),
    );
  };
  const toggle = (from: string, to: string, on: boolean) =>
    setTransitions({
      ...transitions,
      [from]: on ? [...(transitions[from] ?? []), to] : (transitions[from] ?? []).filter((key) => key !== to),
    });
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title={`Workflow of the datasets of ${replicationId}`}
      description="The states a dataset of this replication moves through, and which state may follow which. A state that a dataset is in cannot be removed."
      submitLabel="Save the workflow"
      failureTitle="The workflow was not saved."
      busy={action.busy}
      failure={action.failure ?? (problems.length === 0 ? null : problems.join(" "))}
      onSubmit={async () => {
        if (problems.length > 0) return;
        if (
          await action.run(
            () => callFunction(saveDatasetWorkflowContract, { replicationId, states, transitions, initialKey }),
            "The workflow has been saved.",
            "The workflow could not be saved. Try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="First state">
        {(control) => (
          <Select {...control} value={initialKey} onChange={(event) => setInitialKey(event.target.value)}>
            {states.map((state) => (
              <option key={state.key} value={state.key}>
                {state.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <ol className="grid gap-3">
        {states.map((state) => (
          <li key={state.key} className="grid gap-2 rounded-tile border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <FormField label="Name of the state">
                {(control) => (
                  <Input
                    {...control}
                    value={state.label}
                    maxLength={300}
                    onChange={(event) => change(state.key, { label: event.target.value })}
                  />
                )}
              </FormField>
              <FormField label="Kind">
                {(control) => (
                  <Select
                    {...control}
                    value={state.category}
                    onChange={(event) =>
                      change(state.key, { category: event.target.value as DatasetWorkflowState["category"] })
                    }
                  >
                    {(Object.keys(CATEGORY_LABELS) as DatasetWorkflowState["category"][]).map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={states.length <= 2}
                onClick={() => remove(state.key)}
              >
                Remove {state.label}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.analysisReady}
                onChange={(event) => change(state.key, { analysisReady: event.target.checked })}
              />
              A dataset in this state is ready for analysis
            </label>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <legend className="mb-1 text-xs text-fg-secondary">May move on to</legend>
              {states
                .filter((other) => other.key !== state.key)
                .map((other) => (
                  <label key={other.key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={(transitions[state.key] ?? []).includes(other.key)}
                      onChange={(event) => toggle(state.key, other.key, event.target.checked)}
                    />
                    {other.label}
                  </label>
                ))}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <FormField label="New state" className="min-w-48 flex-1">
          {(control) => (
            <Input {...control} value={label} maxLength={300} onChange={(event) => setLabel(event.target.value)} />
          )}
        </FormField>
        <Button
          type="button"
          disabled={label.trim() === "" || states.length >= 30}
          onClick={() => {
            const key = stateKeyOf(
              label,
              states.map((state) => state.key),
            );
            if (!keySchema.safeParse(key).success) return;
            setStates([...states, { key, label: label.trim(), category: "active", analysisReady: false }]);
            setTransitions({ ...transitions, [key]: [] });
            setLabel("");
          }}
        >
          Add the state
        </Button>
      </div>
    </FormDialog>
  );
}
