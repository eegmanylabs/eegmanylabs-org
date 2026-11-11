import type { DataOrigin } from "@eegml/shared";
import { Badge } from "@/components/ui/badge";
import { DATA_ORIGIN_LABELS } from "@/registry/labels";

/**
 * Says where a value comes from, using the `dataOrigin` of its record. Imported historical,
 * demonstration and projected values are always labelled. A live value is labelled where
 * `showLive` asks for it, as in the header of a record, where the reader sets the frame for
 * everything below.
 */
export function OriginBadge({ origin, showLive = false }: { origin: DataOrigin; showLive?: boolean }) {
  if (origin === "live" && !showLive) return null;
  return (
    <Badge tone="outline" data-origin={origin}>
      {DATA_ORIGIN_LABELS[origin]}
    </Badge>
  );
}
