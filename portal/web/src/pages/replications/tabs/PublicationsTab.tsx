import { CitationBadge } from "@/components/registry/citation-badge";
import { Unknown } from "@/components/registry/unknown";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { RecordOf } from "@/data";
import { MANUSCRIPT_KIND_LABELS, MANUSCRIPT_STATUS_LABELS } from "@/registry/labels";

type Manuscript = RecordOf<"manuscripts">;

/** The year of a manuscript: when it was published, or else when it was accepted. Null where neither is known. */
export function manuscriptYear(manuscript: Pick<Manuscript, "publishedAt" | "acceptedAt">): number | null {
  const instant = manuscript.publishedAt ?? manuscript.acceptedAt;
  return instant === undefined ? null : instant.toDate().getUTCFullYear();
}

export function PublicationsTab({ manuscripts }: { manuscripts: readonly Manuscript[] }) {
  const sorted = [...manuscripts]
    .filter((manuscript) => manuscript.archivedAt === null)
    .sort((a, b) => (manuscriptYear(b) ?? 0) - (manuscriptYear(a) ?? 0) || a.title.localeCompare(b.title));
  return (
    <Table caption="Publications of the replication">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Title</TableHeaderCell>
          <TableHeaderCell>Kind</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Journal</TableHeaderCell>
          <TableHeaderCell>Year</TableHeaderCell>
          <TableHeaderCell>DOI</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((manuscript) => (
          <TableRow key={manuscript.id} className="align-top">
            <TableCell className="min-w-56">
              <span className="grid gap-1">
                {manuscript.title}
                {manuscript.citationStatus === undefined ? null : (
                  <span>
                    <CitationBadge status={manuscript.citationStatus} />
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell>{MANUSCRIPT_KIND_LABELS[manuscript.kind]}</TableCell>
            <TableCell>{MANUSCRIPT_STATUS_LABELS[manuscript.status]}</TableCell>
            <TableCell>{manuscript.journal ?? <Unknown />}</TableCell>
            <TableCell className="tabular-nums">{manuscriptYear(manuscript) ?? <Unknown />}</TableCell>
            <TableCell>
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
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
