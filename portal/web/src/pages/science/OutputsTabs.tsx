// The Registered Reports and the other outputs of a replication (requirements R12.4, R12.9 and
// R12.10). The reports tab follows each Stage 1 report to its Stage 2 report through drafts,
// review rounds, decisions, revisions and milestones; the outputs tab lists every output, its
// life and its authorship list.
import { useState } from "react";
import { Unknown } from "@/components/registry/unknown";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { type RecordOf, useLiveQueries, useLiveQuery } from "@/data";
import { MANUSCRIPT_KIND_LABELS, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";
import { authorshipEntriesOfList } from "@/registry/scientific-queries";
import { AuthorshipEditor } from "./AuthorshipEditor";
import { OutputCard, type OutputContext } from "./OutputCard";
import { ManuscriptDialog } from "./OutputDialogs";

type Manuscript = RecordOf<"manuscripts">;

const REPORT_KINDS = ["stage1Rr", "stage2Rr"] as const satisfies readonly Manuscript["kind"][];
const OTHER_KINDS = [
  "preprint",
  "article",
  "dataPaper",
  "software",
  "dataset",
  "other",
] as const satisfies readonly Manuscript["kind"][];

/** The year of an output: when it was published, or else when it was accepted. Null where neither is known. */
function manuscriptYear(manuscript: Pick<Manuscript, "publishedAt" | "acceptedAt">): number | null {
  const instant = manuscript.publishedAt ?? manuscript.acceptedAt;
  return instant === undefined ? null : instant.toDate().getUTCFullYear();
}

/** The events of each manuscript, by manuscript, which every member reads. */
function useEvents(manuscripts: readonly Manuscript[]): ReadonlyMap<string, readonly RecordOf<"manuscriptEvents">[]> {
  const queries = useLiveQueries(
    manuscripts.map((manuscript) => ({
      collection: "manuscriptEvents" as const,
      within: [manuscript.id] as [string],
      limit: 200,
    })),
  );
  const events = new Map<string, readonly RecordOf<"manuscriptEvents">[]>();
  if (queries.status === "ready") {
    manuscripts.forEach((manuscript, index) => {
      events.set(manuscript.id, queries.data[index] ?? []);
    });
  }
  return events;
}

export function ReportsTab({ context }: { context: OutputContext }) {
  const [creating, setCreating] = useState(false);
  const reports = context.manuscripts
    .filter(
      (manuscript) =>
        manuscript.archivedAt === null && (manuscript.kind === "stage1Rr" || manuscript.kind === "stage2Rr"),
    )
    // Each Stage 2 report follows its Stage 1 report.
    .sort((a, b) => {
      const anchor = (item: Manuscript) => (item.kind === "stage2Rr" ? (item.stage1ManuscriptId ?? item.id) : item.id);
      return anchor(a).localeCompare(anchor(b)) || a.kind.localeCompare(b.kind);
    });
  const events = useEvents(reports);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          Stage 1 and Stage 2 Registered Reports with their drafts, OSF pages, review rounds, decisions and milestones.
        </p>
        {context.manages ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New Registered Report
          </Button>
        ) : null}
      </div>
      <ReportsAttention reports={reports} links={context.links} />
      {reports.length === 0 ? (
        <EmptyState
          title="No Registered Report yet"
          description="A Stage 1 report is recorded once the replication starts writing it."
        />
      ) : (
        reports.map((manuscript) => (
          <OutputCard
            key={manuscript.id}
            manuscript={manuscript}
            events={events.get(manuscript.id) ?? []}
            context={context}
          />
        ))
      )}
      {creating ? (
        <ManuscriptDialog
          studyKey={context.studyKey}
          manuscript={null}
          kinds={REPORT_KINDS}
          manuscripts={context.manuscripts}
          hypotheses={context.hypotheses}
          datasets={context.datasets}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * What needs the leads' attention among the OSF pages of the reports: a registration withdrawn on
 * OSF, which stays public and would otherwise look healthy, and a page that OSF no longer has.
 */
function ReportsAttention({
  reports,
  links,
}: {
  reports: readonly Manuscript[];
  links: readonly RecordOf<"documentLinks">[];
}) {
  const titles = new Map(reports.map((report) => [report.id, report.title]));
  const flagged = links.filter(
    (link) =>
      link.archivedAt === null &&
      link.entityType === "manuscript" &&
      titles.has(link.entityId) &&
      link.kind === "osf" &&
      (link.withdrawnAt !== undefined || link.accessStatus === "unreachable"),
  );
  if (flagged.length === 0) return null;
  return (
    <section
      aria-label="Needs attention"
      className="grid gap-1 rounded-tile border border-border-strong bg-surface px-4 py-3 text-sm"
      data-testid="reports-attention"
    >
      <h2 className="font-medium text-fg-strong">Needs attention</h2>
      <ul className="grid gap-1">
        {flagged.map((link) => (
          <li key={link.id}>
            {link.title ?? link.url}, of {titles.get(link.entityId)}:{" "}
            {link.withdrawnAt !== undefined ? "withdrawn on OSF." : "OSF no longer has this page."}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OutputsTab({
  context,
  lists,
  contributors,
  persons,
}: {
  context: OutputContext;
  /** The authorship lists the reader reads, by manuscript. */
  lists: ReadonlyMap<string, RecordOf<"authorshipLists">>;
  contributors: readonly RecordOf<"contributors">[];
  persons: readonly RecordOf<"persons">[];
}) {
  const [creating, setCreating] = useState(false);
  const outputs = context.manuscripts
    .filter((manuscript) => manuscript.archivedAt === null)
    .sort((a, b) => (manuscriptYear(b) ?? 0) - (manuscriptYear(a) ?? 0) || a.title.localeCompare(b.title));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = outputs.find((manuscript) => manuscript.id === openId) ?? null;
  const events = useEvents(open === null ? [] : [open]);
  // The entries of an open list, which its readers read within scope. A reader outside it sees
  // that the list exists and answers their own entry from Home.
  const entries = useLiveQuery(
    open === null || !lists.has(open.id) || (context.readScope !== "all" && context.readScope.length === 0)
      ? null
      : authorshipEntriesOfList(open.id, context.studyKey, context.readScope),
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-secondary">
          Manuscripts, preprints, articles, software and datasets, with their authorship.
        </p>
        {context.manages ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New output
          </Button>
        ) : null}
      </div>
      {outputs.length === 0 ? (
        <EmptyState
          title="No outputs yet"
          description="Reports, preprints, articles, software and data of the replication appear here."
        />
      ) : (
        <Table caption="Outputs of the replication">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Kind</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Journal or server</TableHeaderCell>
              <TableHeaderCell>Year</TableHeaderCell>
              <TableHeaderCell>Authorship</TableHeaderCell>
              <TableHeaderCell>Open</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {outputs.map((manuscript) => {
              const list = lists.get(manuscript.id);
              return (
                <TableRow key={manuscript.id} aria-current={manuscript.id === openId ? "true" : undefined}>
                  <TableCell className="min-w-56">{manuscript.title}</TableCell>
                  <TableCell>{MANUSCRIPT_KIND_LABELS[manuscript.kind]}</TableCell>
                  <TableCell>{MANUSCRIPT_STATUS_LABELS[manuscript.status]}</TableCell>
                  <TableCell>{manuscript.journal ?? <Unknown />}</TableCell>
                  <TableCell className="tabular-nums">{manuscriptYear(manuscript) ?? <Unknown />}</TableCell>
                  <TableCell>
                    {list === undefined
                      ? "Not prepared"
                      : list.status === "final"
                        ? "Final"
                        : list.status === "inReview"
                          ? "In review"
                          : "Draft"}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" onClick={() => setOpenId(manuscript.id === openId ? null : manuscript.id)}>
                      {manuscript.id === openId ? "Close" : "Open"}
                      <span className="sr-only"> {manuscript.title}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {open === null ? null : (
        <div className="grid gap-4">
          <OutputCard manuscript={open} events={events.get(open.id) ?? []} context={context} />
          <AuthorshipEditor
            key={`${open.id}-${lists.get(open.id)?.revision ?? 0}`}
            manuscript={open}
            list={lists.get(open.id) ?? null}
            entries={entries.status === "ready" ? entries.data : []}
            contributors={contributors}
            persons={persons}
            canPrepare={context.manages}
          />
        </div>
      )}
      {creating ? (
        <ManuscriptDialog
          studyKey={context.studyKey}
          manuscript={null}
          kinds={[...OTHER_KINDS, ...REPORT_KINDS]}
          manuscripts={context.manuscripts}
          hypotheses={context.hypotheses}
          datasets={context.datasets}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
