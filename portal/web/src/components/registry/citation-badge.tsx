import { Badge } from "@/components/ui/badge";
import { CITATION_STATUS_LABELS } from "@/registry/labels";

type CitationStatus = keyof typeof CITATION_STATUS_LABELS;

/**
 * The result of the check of a citation, as its stored status says. Only a verified citation is
 * shown as verified. A mismatch or a citation that was not found is marked for attention.
 */
export function CitationBadge({ status }: { status: CitationStatus }) {
  return (
    <Badge
      tone={status === "mismatch" || status === "notFound" ? "accent" : status === "verified" ? "neutral" : "outline"}
    >
      {CITATION_STATUS_LABELS[status]}
    </Badge>
  );
}
