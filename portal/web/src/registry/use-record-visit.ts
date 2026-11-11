// Remembers that the signed-in account opened a record, for the recent items of the sidebar and
// the command palette. A failure is not worth interrupting the person for: the visit is simply
// not remembered.
import type { EntityType } from "@eegml/shared";
import { useEffect } from "react";
import { recordRecentVisit } from "@/data";

/** Records a visit once the record is known to exist. Pass null while it is not. */
export function useRecordVisit(uid: string | null, entityType: EntityType, entityId: string | null): void {
  useEffect(() => {
    if (uid === null || entityId === null) return;
    recordRecentVisit(uid, entityType, entityId).catch(() => undefined);
  }, [uid, entityType, entityId]);
}
