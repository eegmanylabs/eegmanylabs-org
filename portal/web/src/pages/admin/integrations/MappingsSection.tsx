// The sheet mappings of the integrations page: each mapped tab with its configuration, its mode,
// its state and its last run, and the actions on it. A new or changed mapping starts as a dry run;
// live writes are approved by a programme administrator alone, which the function enforces.
import {
  allowedDirections,
  controlSyncMappingContract,
  requestSyncRunContract,
  SYNC_TARGET_KEYS,
  SYNC_TARGETS,
  type SyncDirection,
  type SyncTargetKey,
  saveSyncMappingContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type LiveQuery, type RecordOf, useLiveQuery } from "@/data";
import { orEmpty } from "@/registry/combine";
import { ReasonDialog } from "../ReasonDialog";
import {
  DIRECTION_LABELS,
  labelOf,
  MAPPING_STATUS_LABELS,
  MODE_LABELS,
  RUN_STATUS_LABELS,
  statLines,
} from "./integration-format";

type Mapping = RecordOf<"syncMappings">;
type Run = RecordOf<"syncRuns">;

const SOURCES: LiveQuery<"sources"> = {
  collection: "sources",
  within: [],
  where: [["kind", "==", "googleSheet"]],
  limit: 200,
};

interface ColumnDraft {
  readonly included: boolean;
  readonly column: string;
  readonly direction: SyncDirection;
}

function draftOf(collectionKey: SyncTargetKey, mapping: Mapping | null): Record<string, ColumnDraft> {
  const fields: Readonly<Record<string, { readonly label: string }>> = SYNC_TARGETS[collectionKey].fields;
  return Object.fromEntries(
    Object.entries(fields).map(([field, definition]) => {
      const mapped = mapping?.columnMap.find((column) => column.field === field);
      return [
        field,
        mapped === undefined
          ? { included: false, column: definition.label, direction: "appAuthoritative" as SyncDirection }
          : { included: true, column: mapped.column, direction: mapped.direction },
      ];
    }),
  );
}

/** The dialog that creates a mapping or changes one. */
function MappingDialog({
  open,
  onOpenChange,
  mapping,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapping: Mapping | null;
}) {
  const toast = useToast();
  const sources = orEmpty(useLiveQuery(open ? SOURCES : null));
  const [name, setName] = useState(mapping?.name ?? "");
  const [sourceKey, setSourceKey] = useState(mapping?.sourceKey ?? "");
  const [tabKey, setTabKey] = useState(mapping?.tabKey ?? "");
  const [collectionKey, setCollectionKey] = useState<SyncTargetKey>(
    mapping !== null && (SYNC_TARGET_KEYS as readonly string[]).includes(mapping.collectionKey)
      ? (mapping.collectionKey as SyncTargetKey)
      : "core:laboratories",
  );
  const [keyColumn, setKeyColumn] = useState(mapping?.keyColumn ?? "");
  const [columns, setColumns] = useState(() => draftOf(collectionKey, mapping));
  const [sheetOnly, setSheetOnly] = useState<"propose" | "ignore">(mapping?.sheetOnlyRows ?? "propose");
  const [appOnly, setAppOnly] = useState<"append" | "ignore">(mapping?.appOnlyRecords ?? "append");
  const [ceiling, setCeiling] = useState(String(mapping?.cellCeiling ?? 200));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tabsQuery: LiveQuery<"sourceTabs"> | null =
    sourceKey === "" ? null : { collection: "sourceTabs", within: [sourceKey], limit: 100 };
  const tabs = orEmpty(useLiveQuery(tabsQuery));
  const fields: Readonly<Record<string, { readonly label: string; readonly writableFromSheet: boolean }>> =
    SYNC_TARGETS[collectionKey].fields;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = Object.entries(columns)
      .filter(([, draft]) => draft.included)
      .map(([field, draft]) => ({ field, column: draft.column.trim(), direction: draft.direction }));
    const cellCeiling = Number(ceiling);
    if (name.trim() === "" || sourceKey === "" || tabKey === "" || keyColumn.trim() === "" || chosen.length === 0) {
      setFailure("Name the mapping, choose its source, tab and key column, and map at least one field.");
      return;
    }
    if (!Number.isInteger(cellCeiling) || cellCeiling < 1 || cellCeiling > 5_000) {
      setFailure("The ceiling is a whole number of cells from 1 to 5,000.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(saveSyncMappingContract, {
        ...(mapping === null ? {} : { mappingId: mapping.id }),
        name: name.trim(),
        sourceKey,
        tabKey,
        collectionKey,
        keyColumn: keyColumn.trim(),
        columns: chosen,
        sheetOnlyRows: sheetOnly,
        appOnlyRecords: appOnly,
        cellCeiling,
      });
      toast.show({
        title:
          mapping === null ? "The mapping is saved as a dry run." : "The mapping is saved, and is a dry run again.",
      });
      onOpenChange(false);
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The mapping could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={mapping === null ? "New mapping" : `Change ${mapping.name}`}
        description="A mapping ties one tab of a registered Google Sheet to one collection of the portal, field by field. It is saved as a dry run, and a programme administrator approves live writes."
        className="max-w-3xl"
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure ? <ErrorState title="Nothing was saved." description={failure} /> : null}
          <FormField label="Name">
            {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Spreadsheet">
              {(control) => (
                <Select
                  {...control}
                  value={sourceKey}
                  disabled={mapping !== null}
                  onChange={(event) => {
                    setSourceKey(event.target.value);
                    setTabKey("");
                  }}
                >
                  <option value="">Choose a registered spreadsheet</option>
                  {(sources.status === "ready" ? sources.data : []).map((source) => (
                    <option key={source.key} value={source.key}>
                      {source.title}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Tab">
              {(control) => (
                <Select
                  {...control}
                  value={tabKey}
                  disabled={mapping !== null}
                  onChange={(event) => setTabKey(event.target.value)}
                >
                  <option value="">Choose a tab</option>
                  {(tabs.status === "ready" ? tabs.data : []).map((tab) => (
                    <option key={tab.tabKey} value={tab.tabKey}>
                      {tab.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Portal collection">
              {(control) => (
                <Select
                  {...control}
                  value={collectionKey}
                  disabled={mapping !== null}
                  onChange={(event) => {
                    const next = event.target.value as SyncTargetKey;
                    setCollectionKey(next);
                    setColumns(draftOf(next, null));
                  }}
                >
                  {SYNC_TARGET_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {SYNC_TARGETS[key].label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Key column" hint={`Its header. ${SYNC_TARGETS[collectionKey].keyDescription}.`}>
              {(control) => (
                <Input {...control} value={keyColumn} onChange={(event) => setKeyColumn(event.target.value)} />
              )}
            </FormField>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-fg-strong">Fields</legend>
            {Object.entries(fields).map(([field, definition]) => {
              const draft = columns[field];
              if (draft === undefined) return null;
              const set = (change: Partial<ColumnDraft>) =>
                setColumns({ ...columns, [field]: { ...draft, ...change } });
              return (
                <div key={field} className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_1fr]">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.included}
                      onChange={(event) => set({ included: event.target.checked })}
                    />
                    {definition.label}
                  </label>
                  <FormField label={`Column of ${definition.label}`}>
                    {(control) => (
                      <Input
                        {...control}
                        disabled={!draft.included}
                        value={draft.column}
                        onChange={(event) => set({ column: event.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField label={`Who owns ${definition.label}`}>
                    {(control) => (
                      <Select
                        {...control}
                        disabled={!draft.included}
                        value={draft.direction}
                        onChange={(event) => set({ direction: event.target.value as SyncDirection })}
                      >
                        {allowedDirections(definition).map((direction) => (
                          <option key={direction} value={direction}>
                            {DIRECTION_LABELS[direction]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                </div>
              );
            })}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="A row the portal does not know">
              {(control) => (
                <Select
                  {...control}
                  value={sheetOnly}
                  onChange={(event) => setSheetOnly(event.target.value as "propose" | "ignore")}
                >
                  <option value="propose">Raise it for review</option>
                  <option value="ignore">Leave it alone</option>
                </Select>
              )}
            </FormField>
            <FormField label="A record without a row">
              {(control) => (
                <Select
                  {...control}
                  value={appOnly}
                  onChange={(event) => setAppOnly(event.target.value as "append" | "ignore")}
                >
                  <option value="append">Append a row</option>
                  <option value="ignore">Leave the sheet alone</option>
                </Select>
              )}
            </FormField>
            <FormField label="Most cells written in one run">
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  value={ceiling}
                  onChange={(event) => setCeiling(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Working on it…" : "Save the mapping"}
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

type Control = "pause" | "resume" | "approveLive" | "withdrawLive";

const CONTROL_TEXT: Readonly<Record<Control, { title: string; description: string; confirm: string }>> = {
  pause: {
    title: "Pause this mapping?",
    description: "No run of it starts until it is resumed. Nothing in the sheet or the portal changes.",
    confirm: "Pause the mapping",
  },
  resume: {
    title: "Resume this mapping?",
    description: "Its runs start again. Resume once the cause of a pause or a problem has been dealt with.",
    confirm: "Resume the mapping",
  },
  approveLive: {
    title: "Approve live writes to this sheet?",
    description:
      "Its runs will write to the spreadsheet and to the portal, as its fields say. The approval is recorded with your name and the time.",
    confirm: "Approve live writes",
  },
  withdrawLive: {
    title: "Return this mapping to a dry run?",
    description: "Its runs compute their plan and write nothing, until live writes are approved again.",
    confirm: "Return to a dry run",
  },
};

const CONTROL_DONE: Readonly<Record<Control, string>> = {
  pause: "The mapping is paused.",
  resume: "The mapping runs again.",
  approveLive: "Live writes are approved for this mapping.",
  withdrawLive: "The mapping is a dry run again.",
};

/** How many changes the plan of a dry run holds, in words. */
function plannedChanges(run: Run | undefined): string {
  const count = (run?.plan ?? []).length + (run?.planOmitted ?? 0);
  return run === undefined ? "plan not kept" : `${count} ${count === 1 ? "change" : "changes"} planned`;
}

export function MappingsSection({
  mappings,
  runs,
  administrator,
  sheetsPaused,
  onShowRun,
}: {
  mappings: readonly Mapping[];
  runs: readonly Run[];
  /** Whether the reader is a programme administrator, who alone approves live writes. */
  administrator: boolean;
  /** Whether the Google Sheets connection is paused, which stops every run of every mapping. */
  sheetsPaused: boolean;
  /** Opens the details of a run, with the control that asked, which focus returns to. */
  onShowRun: (run: Run, opener: HTMLElement) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Mapping | null | "new">(null);
  const [control, setControl] = useState<{ mapping: Mapping; action: Control } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const runOf = new Map(runs.map((run) => [run.id, run]));
  const run = async (mapping: Mapping) => {
    setRunning(mapping.id);
    try {
      const result = await callFunction(requestSyncRunContract, { mappingId: mapping.id });
      toast.show({
        title: result.alreadyQueued
          ? "A run of this mapping waits already."
          : `A ${mapping.mode === "live" ? "live run" : "dry run"} is queued.`,
      });
    } catch (error) {
      toast.show({
        title: "The run could not be queued.",
        description: error instanceof CallableError ? error.message : "",
      });
    } finally {
      setRunning(null);
    }
  };
  return (
    <section aria-labelledby="mappings-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="mappings-heading" className="text-lg text-fg-strong">
          Sheet mappings
        </h2>
        <Button size="sm" onClick={() => setEditing("new")}>
          New mapping
        </Button>
      </div>
      {sheetsPaused && mappings.length > 0 ? (
        <p className="text-sm text-fg-secondary">
          Google Sheets is paused, so no mapping runs. Resume it on the overview to run them again.
        </p>
      ) : null}
      {mappings.length === 0 ? (
        <EmptyState
          title="No sheet is mapped"
          description="A mapping ties a tab of a registered Google Sheet to a collection of the portal."
        />
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption="Sheet mappings">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Mapping</TableHeaderCell>
                <TableHeaderCell>Fields</TableHeaderCell>
                <TableHeaderCell>Mode</TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
                <TableHeaderCell>Last run</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...mappings]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((mapping) => {
                  const last = mapping.lastRunId === null ? undefined : runOf.get(mapping.lastRunId);
                  return (
                    <TableRow key={mapping.id} className="align-top" data-testid="mapping-row">
                      <TableCell>
                        <span className="font-medium text-fg-strong">{mapping.name}</span>
                        <span className="block text-xs text-fg-muted">
                          {labelOf(
                            Object.fromEntries(SYNC_TARGET_KEYS.map((key) => [key, SYNC_TARGETS[key].label])),
                            mapping.collectionKey,
                          )}
                          , key column {mapping.keyColumn}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ul className="text-sm">
                          {mapping.columnMap.map((column) => (
                            <li key={column.field}>
                              {column.column}:{" "}
                              <span className="text-fg-secondary">
                                {DIRECTION_LABELS[column.direction].toLowerCase()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell>
                        <Badge tone={mapping.mode === "live" ? "solid" : "outline"}>{MODE_LABELS[mapping.mode]}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge tone={mapping.status === "active" && !sheetsPaused ? "neutral" : "accent"}>
                          {sheetsPaused ? "Paused with Google Sheets" : MAPPING_STATUS_LABELS[mapping.status]}
                        </Badge>
                        {mapping.statusReason === undefined ? null : (
                          <span className="mt-1 block text-xs text-fg-secondary">{mapping.statusReason}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {mapping.lastRunAt === null ? (
                          <Unknown>Never run</Unknown>
                        ) : (
                          <>
                            {mapping.lastRunDry === true
                              ? `Dry run at ${formatDateTime(mapping.lastRunAt.toDate())}: ${plannedChanges(last)}`
                              : formatDateTime(mapping.lastRunAt.toDate())}
                            {last === undefined ? null : (
                              <button
                                type="button"
                                className="block text-left text-fg-accent underline"
                                onClick={(event) => onShowRun(last, event.currentTarget)}
                              >
                                {mapping.lastRunDry === true ? "See the plan" : labelOf(RUN_STATUS_LABELS, last.status)}
                                <span className="sr-only"> for {mapping.name}</span>
                              </button>
                            )}
                            <span className="block text-xs text-fg-muted">
                              {statLines(mapping.lastStats ?? {}).join(", ")}
                            </span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            disabled={running === mapping.id || mapping.status === "paused" || sheetsPaused}
                            onClick={() => void run(mapping)}
                          >
                            Run now<span className="sr-only"> {mapping.name}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setControl({
                                mapping,
                                action:
                                  mapping.status === "paused" || mapping.status === "needsAttention"
                                    ? "resume"
                                    : "pause",
                              })
                            }
                          >
                            {mapping.status === "paused" || mapping.status === "needsAttention" ? "Resume" : "Pause"}
                            <span className="sr-only"> {mapping.name}</span>
                          </Button>
                          {mapping.mode === "dryRun" && administrator ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setControl({ mapping, action: "approveLive" })}
                            >
                              Approve live writes<span className="sr-only"> for {mapping.name}</span>
                            </Button>
                          ) : null}
                          {mapping.mode === "live" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setControl({ mapping, action: "withdrawLive" })}
                            >
                              Return to a dry run<span className="sr-only"> {mapping.name}</span>
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" onClick={() => setEditing(mapping)}>
                            Change<span className="sr-only"> {mapping.name}</span>
                          </Button>
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      )}
      {editing === null ? null : (
        <MappingDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(open) => (open ? null : setEditing(null))}
          mapping={editing === "new" ? null : editing}
        />
      )}
      {control === null ? null : (
        <ReasonDialog
          open
          onOpenChange={(open) => (open ? null : setControl(null))}
          title={CONTROL_TEXT[control.action].title}
          description={CONTROL_TEXT[control.action].description}
          label="Reason"
          optional
          confirmLabel={CONTROL_TEXT[control.action].confirm}
          onConfirm={async (reason) => {
            await callFunction(controlSyncMappingContract, {
              mappingId: control.mapping.id,
              action: control.action,
              ...(reason === "" ? {} : { reason }),
            });
            toast.show({ title: CONTROL_DONE[control.action] });
          }}
        />
      )}
    </section>
  );
}
