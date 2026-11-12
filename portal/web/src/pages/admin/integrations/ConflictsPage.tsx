// The resolution screen of the integrations: every open conflict with the value both sides last
// agreed on, the value the portal holds and the value of the sheet or document, side by side.
// An authorised person keeps one of them or enters a merged value. The function reads both sides
// again first: if either moved on, nothing is written and the conflict shows the new values.
import { resolveSyncConflictContract, type SyncResolution } from "@eegml/shared";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { callFunction, type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { AdminPage } from "@/pages/admin/AdminPage";
import { ReasonDialog } from "@/pages/admin/ReasonDialog";
import { combineLive } from "@/registry/combine";
import { valueText } from "./integration-format";

type Conflict = RecordOf<"syncConflicts">;

const CONFLICTS: LiveQuery<"syncConflicts"> = { collection: "syncConflicts", within: [], limit: 1_000 };
const MAPPINGS: LiveQuery<"syncMappings"> = { collection: "syncMappings", within: [], limit: 200 };

function sideNames(conflict: Conflict): { readonly external: string; readonly keep: string } {
  return conflict.origin === "sheet"
    ? { external: "In the sheet", keep: "Keep the sheet value" }
    : conflict.field === undefined
      ? { external: "In the document", keep: "Keep the text of the document" }
      : { external: "In the document", keep: "Take the document's text into the record" };
}

function Value({ label, value, emphasis }: { label: string; value: string | null | undefined; emphasis: boolean }) {
  return (
    <div className="grid content-start gap-1 rounded-control border border-border p-3">
      <span className="text-xs text-fg-muted">{label}</span>
      <span
        className={
          emphasis
            ? "font-medium break-words whitespace-pre-wrap text-fg-strong"
            : "break-words whitespace-pre-wrap text-fg-secondary"
        }
      >
        {value === undefined ? (
          <Unknown>Never agreed: the cell was linked with two different values</Unknown>
        ) : (
          valueText(value)
        )}
      </span>
    </div>
  );
}

function ConflictCard({ conflict, mappingName }: { conflict: Conflict; mappingName: string }) {
  const toast = useToast();
  const [choice, setChoice] = useState<SyncResolution | null>(null);
  const [merged, setMerged] = useState(conflict.appValue ?? "");
  const names = sideNames(conflict);
  const mergeable = conflict.origin === "sheet" || conflict.field !== undefined;
  return (
    <article
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="conflict"
      aria-label={conflict.label}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-medium text-fg-strong">{conflict.label}</h2>
        <Badge tone="outline">{conflict.origin === "sheet" ? mappingName : "Generated document"}</Badge>
      </header>
      <div className="grid gap-2 md:grid-cols-3">
        <Value label="When both sides last agreed" value={conflict.baseValue} emphasis={false} />
        <Value label="In the portal" value={conflict.appValue} emphasis />
        <Value label={names.external} value={conflict.sheetValue} emphasis />
      </div>
      <p className="text-xs text-fg-muted">
        Found {formatDateTime(conflict.detectedAt.toDate())}, last seen {formatDateTime(conflict.lastSeenAt.toDate())}.
        {conflict.externalModifiedBy === undefined
          ? null
          : ` The file was last changed by ${conflict.externalModifiedBy}, which attributes the change only approximately.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setChoice("keepApp")}>
          {conflict.origin === "sheet" ? "Keep the portal value" : "Generate the section again"}
        </Button>
        <Button size="sm" onClick={() => setChoice("keepSheet")}>
          {names.keep}
        </Button>
        {mergeable ? (
          <Button size="sm" onClick={() => setChoice("merged")}>
            Enter a merged value
          </Button>
        ) : null}
      </div>
      {choice === null ? null : (
        <ReasonDialog
          open
          onOpenChange={(open) => (open ? null : setChoice(null))}
          title={
            choice === "merged"
              ? "Keep a merged value?"
              : choice === "keepApp"
                ? "Keep the portal's side?"
                : `${names.keep}?`
          }
          description="Both sides are read again first. If either changed after the conflict was found, nothing is written and the conflict shows the new values. The decision is recorded with your name."
          label="Note"
          optional
          confirmLabel="Resolve the conflict"
          canConfirm={choice !== "merged" || merged.trim() !== ""}
          onConfirm={async (note) => {
            const answer = await callFunction(resolveSyncConflictContract, {
              conflictId: conflict.id,
              resolution: choice,
              ...(choice === "merged" ? { mergedValue: merged.trim() } : {}),
              ...(note === "" ? {} : { note }),
            });
            toast.show(
              answer.status === "resolved"
                ? { title: "The conflict is resolved." }
                : {
                    title: "A side changed meanwhile, so nothing was written.",
                    description: "The conflict now shows the new values.",
                  },
            );
          }}
        >
          {choice === "merged" ? (
            <FormField label="Value to keep" hint="As a person would type it in the sheet.">
              {(control) => (
                <Textarea {...control} rows={2} value={merged} onChange={(event) => setMerged(event.target.value)} />
              )}
            </FormField>
          ) : null}
        </ReasonDialog>
      )}
    </article>
  );
}

function Resolved({ conflicts }: { conflicts: readonly Conflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <section aria-labelledby="resolved-heading" className="grid gap-2">
      <h2 id="resolved-heading" className="text-lg text-fg-strong">
        Resolved lately
      </h2>
      <ul className="grid gap-1 text-sm">
        {conflicts.map((conflict) => (
          <li key={conflict.id} data-testid="resolved-conflict">
            {conflict.label}: {valueText(conflict.resolvedValue ?? null)}
            <span className="text-fg-muted">
              {" "}
              {conflict.resolvedAt === null ? "" : `on ${formatDateTime(conflict.resolvedAt.toDate())}`}
              {conflict.resolvedBy === "system:sync" ? ", both sides came to agree" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Screen() {
  const conflicts = useLiveQuery(CONFLICTS);
  const mappings = useLiveQuery(MAPPINGS);
  const live = useMemo(() => combineLive([conflicts, mappings] as const, (c, m) => ({ c, m })), [conflicts, mappings]);
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the conflicts"
      errorTitle="The conflicts could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ c, m }) => {
        const names = new Map(m.map((mapping) => [mapping.id, mapping.name]));
        const open = c
          .filter((conflict) => conflict.status === "open")
          .sort((a, b) => a.detectedAt.toMillis() - b.detectedAt.toMillis());
        const resolved = c
          .filter((conflict) => conflict.status === "resolved" && conflict.resolvedAt !== null)
          .sort((a, b) => (b.resolvedAt?.toMillis() ?? 0) - (a.resolvedAt?.toMillis() ?? 0))
          .slice(0, 20);
        return (
          <div className="grid gap-6">
            {open.length === 0 ? (
              <EmptyState
                title="No conflict is open"
                description="A conflict is raised when the portal and a sheet or a generated document both change one value before the next run."
              />
            ) : (
              <div className="grid gap-3">
                {open.map((conflict) => (
                  <ConflictCard
                    key={conflict.id}
                    conflict={conflict}
                    mappingName={names.get(conflict.mappingId ?? "") ?? "Sheet"}
                  />
                ))}
              </div>
            )}
            <Resolved conflicts={resolved} />
          </div>
        );
      }}
    </LiveView>
  );
}

/** The resolution screen, for holders of `integrations.manage`. */
export function ConflictsPage() {
  return (
    <AdminPage
      entryId="admin-integrations"
      title="Conflicts"
      description="Values that the portal and a sheet or a generated document both changed. Neither side is written until a person decides here."
    >
      <Screen />
    </AdminPage>
  );
}
