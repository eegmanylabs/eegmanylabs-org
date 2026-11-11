import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import type { RecordOf } from "@/data";
import { DOCUMENT_ACCESS_LABELS, DOCUMENT_KIND_LABELS } from "@/registry/labels";

/** The documents linked to the replication that the caller may see. */
export function DocumentsTab({ links }: { links: readonly RecordOf<"documentLinks">[] }) {
  const sorted = [...links]
    .filter((link) => link.archivedAt === null)
    .sort((a, b) => (a.title ?? a.url).localeCompare(b.title ?? b.url));
  return (
    <Table caption="Linked documents">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Document</TableHeaderCell>
          <TableHeaderCell>Kind</TableHeaderCell>
          <TableHeaderCell>Access</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((link) => (
          <TableRow key={link.id} className="align-top">
            <TableCell>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 break-all text-fg-accent underline"
              >
                {link.title ?? link.url}
                <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </TableCell>
            <TableCell>{DOCUMENT_KIND_LABELS[link.kind]}</TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                {DOCUMENT_ACCESS_LABELS[link.accessStatus]}
                {link.restricted ? <Badge tone="outline">Team only</Badge> : null}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
