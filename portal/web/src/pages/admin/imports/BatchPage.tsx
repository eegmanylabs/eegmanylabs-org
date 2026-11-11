import { entryOfDocumentPath, rollbackImportBatchContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { AdminPage } from "@/pages/admin/AdminPage";
import { BATCH_STATUS_LABELS } from "@/registry/labels";
import { useViewer } from "@/registry/viewer";
import { ActorName, collectionOfPath, countEntries, durationText, statLabel } from "./import-format";

type Change = RecordOf<"importBatchChanges">;
type Plan = Awaited<ReturnType<typeof callFunction<typeof rollbackImportBatchContract>>>;

const PAGE = 25;
const STANDARD = new Set(["schemaVersion", "createdAt", "updatedAt", "createdBy", "updatedBy", "writeContext"]);

/** Whether the values of a document are withheld on this page: restricted and special-category documents. */
export function withheldPath(path: string): boolean {
  const matched = entryOfDocumentPath(path);
  return matched === null || matched.entry.dataClass === "restricted" || matched.entry.dataClass === "special";
}

/** A stored value as short text: an instant as its date and time, anything else as JSON. */
function valueText(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
    return formatDateTime((value.toDate as () => Date)());
  }
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** The fields a change wrote, with their values before and after, standard fields left out. */
export function changedFields(
  change: Pick<Change, "before" | "after">,
): { field: string; before: unknown; after: unknown }[] {
  const before = change.before ?? {};
  const after = change.after ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !STANDARD.has(field) && JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .sort()
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

const RELATION_LABELS = { created: "Created", updated: "Updated", matched: "Matched, unchanged" } as const;
const ACTION_LABELS = {
  restore: "Restored",
  remove: "Removed",
  withdraw: "Withdrawn",
  keep: "Left as decided",
} as const;

function RollbackDialog({ batchId }: { batchId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (confirm: boolean) => {
    setBusy(true);
    setFailure(null);
    try {
      // A rollback rewrites every document of a batch, which takes longer than most calls.
      const answer = await callFunction(rollbackImportBatchContract, { batchId, confirm }, { timeoutMs: 120_000 });
      if (confirm && answer.status === "rolledBack") {
        setOpen(false);
        toast.show({
          title: "The batch has been rolled back.",
          description: `${answer.counts.restored} documents restored, ${answer.counts.removed} removed, ${answer.counts.itemsWithdrawn} items withdrawn.`,
        });
      } else {
        setPlan(answer);
      }
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The rollback could not be prepared. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPlan(null);
          void ask(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Roll back this batch</Button>
      </DialogTrigger>
      <DialogContent
        title="Roll back this batch?"
        description="Nothing changes until you confirm. Source records are kept, and items of the review queue that a reviewer has decided stay decided."
      >
        <div className="mt-5 grid gap-4" data-testid="rollback-plan">
          {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
          {plan === null && failure === null ? (
            <p className="text-fg-secondary">Working out what would change</p>
          ) : null}
          {plan?.status === "nothingToReverse" ? <p>There is nothing to roll back. {plan.reason}</p> : null}
          {plan?.status === "refused" ? (
            <>
              <p>
                The batch cannot be rolled back, because these documents have changed since it wrote them. Decide about
                each of them first.
              </p>
              <ul className="grid gap-1 break-all text-fg-secondary">
                {plan.changedDocuments.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </>
          ) : null}
          {plan?.status === "planned" ? (
            <>
              <p>
                {plan.counts.restored} documents would be restored, {plan.counts.removed} removed and{" "}
                {plan.counts.itemsWithdrawn} items of the review queue withdrawn. {plan.counts.itemsLeft} decided items
                would stay as they are.
              </p>
              <ul className="grid max-h-60 gap-1 overflow-y-auto break-all text-fg-secondary">
                {plan.documents.map((document) => (
                  <li key={document.path}>
                    {ACTION_LABELS[document.action]}: {document.path}
                  </li>
                ))}
              </ul>
              {plan.truncated ? (
                <p className="text-xs text-fg-muted">More documents would change than are listed.</p>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {plan?.status === "planned" ? (
              <Button variant="primary" disabled={busy} onClick={() => ask(true)}>
                Roll back the batch
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeList({ changes }: { changes: readonly Change[] }) {
  const [offset, setOffset] = useState(0);
  const sorted = useMemo(() => [...changes].sort((a, b) => a.id.localeCompare(b.id)), [changes]);
  if (changes.length === 0) return <p className="text-fg-secondary">The batch wrote nothing.</p>;
  return (
    <div className="grid gap-3">
      <div className="relative overflow-x-auto">
        <Table caption="Changes of the batch">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Document</TableHeaderCell>
              <TableHeaderCell>What happened</TableHeaderCell>
              <TableHeaderCell>Fields</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.slice(offset, offset + PAGE).map((change) => {
              const withheld = withheldPath(change.documentPath);
              const fields = changedFields(change);
              return (
                <TableRow key={change.id} className="align-top" data-testid="batch-change">
                  <TableCell className="break-all">{change.documentPath}</TableCell>
                  <TableCell>
                    {RELATION_LABELS[change.relation]}
                    <span className="block text-xs text-fg-muted">
                      {change.sourceRecordIds.length} source{" "}
                      {change.sourceRecordIds.length === 1 ? "record" : "records"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {fields.length === 0 ? (
                      <Unknown>No field changed</Unknown>
                    ) : (
                      <ul className="grid gap-0.5">
                        {fields.map((field) => (
                          <li key={field.field}>
                            <span className="font-medium">{statLabel(field.field)}</span>
                            {withheld ? (
                              <span className="text-fg-muted"> changed; the values are restricted and withheld</span>
                            ) : (
                              <span className="text-fg-secondary">
                                : from {valueText(field.before)} to {valueText(field.after)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination offset={offset} pageSize={PAGE} total={sorted.length} label="changes" onChange={setOffset} />
    </div>
  );
}

function BatchRecord({ batchId }: { batchId: string }) {
  const viewer = useViewer();
  const batch = useLiveDocument("importBatches", [batchId]);
  const changes = useLiveQuery({ collection: "importBatchChanges", within: [batchId], limit: 1_000 });
  const log = useLiveQuery({ collection: "importBatchLog", within: [batchId], limit: 1_000 });
  const rollsBack = viewer?.can("imports.rollback", "programme") === true;
  return (
    <LiveView
      live={batch}
      loadingLabel="Loading the batch"
      errorTitle="The batch could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <EmptyState title="This batch does not exist" description="No import batch has this identifier." />
        ) : (
          <div className="grid gap-5">
            <section
              className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
              aria-label="Statistics"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-md font-medium text-fg-strong">
                  {record.mode === "apply" ? "Apply" : "Preview"} of source {record.sourceKey}
                </h2>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={record.status === "failed" ? "accent" : "neutral"}>
                    {BATCH_STATUS_LABELS[record.status]}
                  </Badge>
                  {rollsBack && record.mode === "apply" && record.status === "applied" ? (
                    <RollbackDialog batchId={batchId} />
                  ) : null}
                </span>
              </div>
              <Details>
                <Detail term="Batch">
                  <span className="break-all">{record.id}</span>
                </Detail>
                <Detail term="Started">{formatDateTime(record.startedAt.toDate())}</Detail>
                <Detail term="Duration">
                  {durationText(record.startedAt.toDate(), record.finishedAt?.toDate() ?? null) ?? (
                    <Unknown>Running</Unknown>
                  )}
                </Detail>
                <Detail term="Started by">
                  <ActorName actor={record.startedBy} />
                </Detail>
                <Detail term="Export of">{record.observedOn ?? <Unknown>No date stated</Unknown>}</Detail>
                <Detail term="Counts">
                  {countEntries(record.stats).length === 0 ? (
                    <Unknown>None recorded</Unknown>
                  ) : (
                    countEntries(record.stats)
                      .map(([key, count]) => `${statLabel(key)}: ${count}`)
                      .join(", ")
                  )}
                </Detail>
                <Detail term="Changes by collection">
                  {changes.status === "ready" ? (
                    countEntries(
                      changes.data.reduce<Record<string, number>>((counts, change) => {
                        const collection = collectionOfPath(change.documentPath);
                        counts[collection] = (counts[collection] ?? 0) + 1;
                        return counts;
                      }, {}),
                    )
                      .map(([collection, count]) => `${collection}: ${count}`)
                      .join(", ") || <Unknown>None</Unknown>
                  ) : (
                    <Unknown>Loading</Unknown>
                  )}
                </Detail>
              </Details>
              {rollsBack ? null : (
                <p className="text-xs text-fg-muted">Rolling a batch back is for holders of the rollback capability.</p>
              )}
            </section>
            <section className="grid gap-2" aria-label="Log">
              <h2 className="text-md font-medium text-fg-strong">Log</h2>
              <LiveView
                live={log}
                loadingLabel="Loading the log"
                errorTitle="The log could not be loaded."
                onRetry={retryFailedLiveData}
              >
                {(entries) =>
                  entries.length === 0 ? (
                    <p className="text-fg-secondary">The batch logged nothing.</p>
                  ) : (
                    <ol className="grid gap-1" data-testid="batch-log">
                      {[...entries]
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((entry) => (
                          <li key={entry.id} className="flex flex-wrap gap-2">
                            <Badge tone={entry.level === "error" ? "accent" : "outline"}>{entry.level}</Badge>
                            <span className="min-w-0 flex-1">{entry.message}</span>
                          </li>
                        ))}
                    </ol>
                  )
                }
              </LiveView>
            </section>
            <section className="grid gap-2" aria-label="Changes">
              <h2 className="text-md font-medium text-fg-strong">Changes</h2>
              <p className="text-xs text-fg-muted">
                The values of restricted and special-category documents are withheld on this page.
              </p>
              <LiveView
                live={changes}
                loadingLabel="Loading the changes"
                errorTitle="The changes could not be loaded."
                onRetry={retryFailedLiveData}
              >
                {(list) => <ChangeList changes={list} />}
              </LiveView>
            </section>
          </div>
        )
      }
    </LiveView>
  );
}

/** One import batch: its statistics, its log and its changes, and its rollback for those who may. */
export function BatchPage() {
  const { batchId = "" } = useParams();
  return (
    <AdminPage entryId="admin-imports" description="What one run of an importer read, wrote and logged.">
      <BatchRecord batchId={batchId} />
    </AdminPage>
  );
}
