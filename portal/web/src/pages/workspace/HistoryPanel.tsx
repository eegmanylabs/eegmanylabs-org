// The saved versions of a page (D-010): saved automatically after a quiet spell of editing, by
// name on request, and when an earlier one is restored. A version is shown as it was, read only,
// and restoring it writes a new change that every collaborator receives, so nothing is rewound.
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { cn } from "@/utils/cn";
import type { Members } from "./members";
import { versionsOfPage } from "./queries";

const KIND_LABELS = { auto: "Saved automatically", manual: "Named version", restore: "Restored" } as const;

/** The heading of a version: its name, or who saved it, or how it was saved. */
function headingOf(version: RecordOf<"pageVersions">, by: string | null): string {
  if (version.label !== undefined) return version.label;
  if (version.kind === "manual") return by === null ? "Saved by hand" : `Saved by ${by}`;
  return KIND_LABELS[version.kind];
}

export interface HistoryPanelProps {
  readonly pageId: string;
  readonly members: Members;
  readonly canSave: boolean;
  readonly previewing: string | null;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onPreview: (version: RecordOf<"pageVersions">) => void;
}

export function HistoryPanel({ pageId, members, canSave, previewing, busy, onSave, onPreview }: HistoryPanelProps) {
  const versions = useLiveQuery(versionsOfPage(pageId));
  return (
    <section aria-labelledby="history-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-heading" className="text-lg text-fg">
          Version history
        </h2>
        {canSave ? (
          <Button size="sm" variant="outline" onClick={onSave} disabled={busy}>
            Save a version
          </Button>
        ) : null}
      </div>
      <LiveView
        live={versions}
        loadingLabel="Loading the versions"
        errorTitle="The versions could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="No versions yet"
              description="A version is saved after a quiet spell of editing, and whenever an editor saves one by name."
            />
          ) : (
            <ol className="grid gap-2" aria-label="Versions, newest first">
              {list.map((version) => {
                const by = members.nameOf(version.createdBy);
                const current = version.id === previewing;
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      aria-current={current ? "true" : undefined}
                      onClick={() => onPreview(version)}
                      data-testid="version"
                      className={cn(
                        "grid w-full cursor-pointer gap-0.5 rounded-tile border bg-surface px-3 py-2 text-left hover:border-border-strong",
                        current ? "border-accent" : "border-border",
                      )}
                    >
                      <span className="font-medium text-fg">{headingOf(version, by)}</span>
                      <span className="text-xs text-fg-secondary">
                        <time dateTime={version.createdAt.toDate().toISOString()}>
                          {formatDateTime(version.createdAt.toDate())}
                        </time>
                        {by === null ? null : ` · ${by}`}
                      </span>
                      {version.label === undefined ? null : (
                        <span>
                          <Badge tone="outline">{KIND_LABELS[version.kind]}</Badge>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )
        }
      </LiveView>
    </section>
  );
}
