// One output of a replication with its life: its status, its events in order, the documents
// linked to it (drafts and OSF pages, which are checked against OSF through the portal's
// adapter), and the milestones planned for it. The reports tab and the outputs tab both show it.
import { checkOsfLinkContract } from "@eegml/shared";
import { useState } from "react";
import { CitationBadge } from "@/components/registry/citation-badge";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { linkAccessLabel, MANUSCRIPT_KIND_LABELS, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";
import type { ReadScope } from "@/registry/scientific-queries";
import { EventDialog, LinkDialog, ManuscriptDialog, MilestoneDialog } from "./OutputDialogs";
import { DECISION_OUTCOME_LABELS, EVENT_KIND_LABELS, MILESTONE_NAMES, readableInstant } from "./science-format";

type Manuscript = RecordOf<"manuscripts">;

export interface OutputContext {
  readonly studyKey: string;
  /** What limits the reader's reads within scope. */
  readonly readScope: ReadScope;
  readonly uid: string;
  /** Whether the reader manages the outputs of the replication, which the functions decide again. */
  readonly manages: boolean;
  readonly manuscripts: readonly Manuscript[];
  readonly hypotheses: readonly RecordOf<"replicationHypotheses">[];
  readonly datasets: readonly RecordOf<"datasets">[];
  readonly links: readonly RecordOf<"documentLinks">[];
  /** The task lists of the replication the reader may add a milestone to. */
  readonly lists: readonly RecordOf<"taskLists">[];
  /** The milestone tasks the reader reads, by identifier. */
  readonly milestones: ReadonlyMap<string, RecordOf<"tasks">>;
}

export function OutputCard({
  manuscript,
  events,
  context,
}: {
  manuscript: Manuscript;
  events: readonly RecordOf<"manuscriptEvents">[];
  context: OutputContext;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<"edit" | "event" | "milestone" | "link" | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const links = context.links.filter(
    (link) => link.entityType === "manuscript" && link.entityId === manuscript.id && link.archivedAt === null,
  );
  const stage1 = context.manuscripts.find((item) => item.id === manuscript.stage1ManuscriptId);
  const stage2 = context.manuscripts.filter((item) => item.stage1ManuscriptId === manuscript.id);
  const ordered = [...events].sort((a, b) => a.occurredAt.toMillis() - b.occurredAt.toMillis());
  const planned = Object.entries(manuscript.milestoneTaskIds ?? {});

  const check = async (linkId: string) => {
    setChecking(linkId);
    try {
      const answer = await callFunction(checkOsfLinkContract, { linkId });
      toast.show({ title: answer.message });
    } catch (error) {
      toast.show({
        title: "The OSF page could not be checked.",
        description: error instanceof CallableError ? error.message : "Try again in a minute.",
      });
    } finally {
      setChecking(null);
    }
  };

  return (
    <article
      aria-labelledby={`output-${manuscript.id}`}
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="output"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <h2 id={`output-${manuscript.id}`} className="text-md font-medium text-fg-strong">
            {manuscript.title}
          </h2>
          <span className="flex flex-wrap gap-2">
            <Badge tone="outline">{MANUSCRIPT_KIND_LABELS[manuscript.kind]}</Badge>
            <Badge tone="solid">{MANUSCRIPT_STATUS_LABELS[manuscript.status]}</Badge>
            {manuscript.citationStatus === undefined ? null : <CitationBadge status={manuscript.citationStatus} />}
          </span>
        </div>
        {context.manages ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => setDialog("event")}>
              Record an event
            </Button>
            <Button size="sm" onClick={() => setDialog("link")}>
              Link a document
            </Button>
            {manuscript.replicationId === undefined ? null : (
              <Button size="sm" onClick={() => setDialog("milestone")}>
                Plan a milestone
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDialog("edit")}>
              Change the output
            </Button>
          </span>
        ) : null}
      </div>
      <Details>
        {manuscript.kind === "stage2Rr" ? (
          <Detail term="Stage 1 report">{stage1?.title ?? <Unknown>Not named</Unknown>}</Detail>
        ) : null}
        {manuscript.kind === "stage1Rr" ? (
          <Detail term="Stage 2 report">
            {stage2.length === 0 ? <Unknown>Not started</Unknown> : stage2.map((item) => item.title).join(", ")}
          </Detail>
        ) : null}
        <Detail term="Journal or server">{manuscript.journal ?? <Unknown />}</Detail>
        <Detail term="DOI">
          {manuscript.doi === undefined ? (
            <Unknown>No DOI</Unknown>
          ) : (
            <a
              href={`https://doi.org/${manuscript.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-fg-accent underline"
            >
              {manuscript.doi}
            </a>
          )}
        </Detail>
        {manuscript.repositoryUrl === undefined ? null : (
          <Detail term="Repository">
            <a
              href={manuscript.repositoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-fg-accent underline"
            >
              {manuscript.repositoryUrl}
            </a>
            {manuscript.outputVersion === undefined ? "" : `, version ${manuscript.outputVersion}`}
          </Detail>
        )}
        <Detail term="Submitted">
          {manuscript.submittedAt === undefined ? <Unknown /> : readableInstant(manuscript.submittedAt)}
        </Detail>
        <Detail term="Accepted">
          {manuscript.acceptedAt === undefined ? <Unknown /> : readableInstant(manuscript.acceptedAt)}
        </Detail>
        <Detail term="Published">
          {manuscript.publishedAt === undefined ? <Unknown /> : readableInstant(manuscript.publishedAt)}
        </Detail>
      </Details>

      <section aria-label={`Events of ${manuscript.title}`} className="grid gap-1">
        <h3 className="text-sm font-medium text-fg-strong">Submissions, reviews and decisions</h3>
        {ordered.length === 0 ? (
          <p className="text-sm text-fg-muted">No event recorded yet.</p>
        ) : (
          <ol className="grid gap-1 text-sm" data-testid="output-events">
            {ordered.map((event) => (
              <li key={event.id}>
                <span className="text-fg-muted">{readableInstant(event.occurredAt)}: </span>
                {EVENT_KIND_LABELS[event.kind]}
                {event.round === undefined ? "" : `, round ${event.round}`}
                {event.outcome === undefined ? "" : `: ${DECISION_OUTCOME_LABELS[event.outcome].toLowerCase()}`}
                {event.dueAt === undefined ? "" : `, due on ${readableInstant(event.dueAt)}`}
                {event.summary === undefined ? "" : `. ${event.summary}`}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label={`Documents of ${manuscript.title}`} className="grid gap-1">
        <h3 className="text-sm font-medium text-fg-strong">Drafts and OSF pages</h3>
        {links.length === 0 ? (
          <p className="text-sm text-fg-muted">No document linked yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-fg-accent underline"
                >
                  {link.title ?? link.url}
                </a>
                {link.withdrawnAt === undefined ? null : (
                  <Badge tone="accent">Withdrawn on OSF {readableInstant(link.withdrawnAt)}</Badge>
                )}
                <Badge tone="outline">{linkAccessLabel(link)}</Badge>
                {link.lastCheckedAt === null ? null : (
                  <span className="text-xs text-fg-muted">checked {readableInstant(link.lastCheckedAt)}</span>
                )}
                {link.kind === "osf" && context.manages ? (
                  <Button size="sm" variant="ghost" disabled={checking === link.id} onClick={() => void check(link.id)}>
                    {checking === link.id ? (
                      "Checking"
                    ) : (
                      <>
                        Check on OSF<span className="sr-only"> {link.title ?? "the page"}</span>
                      </>
                    )}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {planned.length === 0 ? null : (
        <section aria-label={`Milestones of ${manuscript.title}`} className="grid gap-1">
          <h3 className="text-sm font-medium text-fg-strong">Milestones</h3>
          <ul className="grid gap-1 text-sm">
            {planned.map(([milestone, taskId]) => {
              const task = context.milestones.get(taskId);
              return (
                <li key={milestone}>
                  {MILESTONE_NAMES[milestone as keyof typeof MILESTONE_NAMES]}
                  {task === undefined
                    ? ""
                    : task.completedAt !== null
                      ? `: reached on ${readableInstant(task.completedAt)}`
                      : task.dueAt === undefined
                        ? ": planned"
                        : `: planned for ${readableInstant(task.dueAt)}`}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {dialog === "edit" ? (
        <ManuscriptDialog
          studyKey={context.studyKey}
          manuscript={manuscript}
          kinds={[
            manuscript.kind,
            ...(manuscript.kind === "stage1Rr" || manuscript.kind === "stage2Rr"
              ? []
              : (["preprint", "article", "dataPaper", "software", "dataset", "other"] as const)),
          ]}
          manuscripts={context.manuscripts}
          hypotheses={context.hypotheses}
          datasets={context.datasets}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "event" ? (
        <EventDialog manuscript={manuscript} links={links} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "milestone" ? (
        <MilestoneDialog manuscript={manuscript} lists={context.lists} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "link" ? (
        <LinkDialog manuscript={manuscript} uid={context.uid} onClose={() => setDialog(null)} />
      ) : null}
    </article>
  );
}
