import type { ReactNode } from "react";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import type { ReplicationRow } from "./replication-list";

export { replicationPath } from "@/registry/paths";

/** The leads of a row, or what stands in for them. */
export function LeadsText({ row }: { row: Pick<ReplicationRow, "leadNames" | "leadState"> }): ReactNode {
  if (row.leadState === "confirmed") return row.leadNames.join(", ");
  if (row.leadState === "needsReview") return <Badge tone="accent">Lead needs review</Badge>;
  return <Unknown>No confirmed lead</Unknown>;
}
