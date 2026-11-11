import { CitationBadge } from "@/components/registry/citation-badge";
import { Detail, Details } from "@/components/registry/details";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveDocument } from "@/data";
import { formatCount } from "@/registry/labels";
import { LeadsText } from "./replication-display";
import { type ReplicationRow, stageText } from "./replication-list";

/** What the side panel of the list says about a replication. */
export function ReplicationPreview({ row }: { row: ReplicationRow }) {
  const record = useLiveDocument("replications", [row.studyKey]);
  const replication = record.status === "ready" ? record.data : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <OriginBadge origin={row.dataOrigin} showLive />
        {replication === null ? null : <CitationBadge status={replication.citationStatus} />}
      </div>
      {row.title === null ? null : <p className="text-fg-secondary">{row.title}</p>}
      <Details>
        <Detail term="Status">{row.statusLabel ?? <Unknown />}</Detail>
        <Detail term="Public stage">{stageText(row) ?? <Unknown />}</Detail>
        <Detail term="Leads">
          <LeadsText row={row} />
        </Detail>
        <Detail term="Original study">
          {replication === null ? <Skeleton className="h-4 w-48" /> : (replication.originalReference ?? <Unknown />)}
        </Detail>
        <Detail term="Theme">{row.theme ?? <Unknown />}</Detail>
        <Detail term="Laboratories">
          {row.laboratoryCount === 0 ? <Unknown>None linked yet</Unknown> : formatCount(row.laboratoryCount)}
        </Detail>
        <Detail term="Publications">
          {row.publicationCount === 0 ? <Unknown>None</Unknown> : formatCount(row.publicationCount)}
        </Detail>
      </Details>
      {replication?.plainLanguageDescription === undefined ? null : (
        <p className="text-fg-secondary">{replication.plainLanguageDescription}</p>
      )}
    </>
  );
}
