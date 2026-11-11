// The onboarding checklist of a participation, with its progress. The items were copied from the
// configured template when the participation was created. Whoever the security rules let update
// an item changes its status here: the leads and the coordinators of the participation, the core
// team, administrators and the members of its laboratory, and the item of readiness approval only
// the replication's side. The rules refuse everyone else, whatever this list offers.
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { type ChecklistChange, type RecordOf, updateChecklistItem } from "@/data";
import { CHECKLIST_STATUS_LABELS } from "@/registry/labels";

type Item = RecordOf<"participationChecklist">;
type Status = Item["status"];

const STATUSES = Object.keys(CHECKLIST_STATUS_LABELS) as Status[];

/** The item that only the replication's side may change. */
export const READINESS_ITEM = "readinessApproval";

/** How far the checklist has come: the items done or not applicable, of all items. */
export function checklistProgress(items: readonly Pick<Item, "status">[]): { settled: number; total: number } {
  return {
    settled: items.filter((item) => item.status === "done" || item.status === "notApplicable").length,
    total: items.length,
  };
}

export interface ChecklistRights {
  /** Whether the account manages the participation: its leads, coordinators, the core team and administrators. */
  readonly manages: boolean;
  /** Whether the account speaks for the replication: its leads, the core team and administrators. */
  readonly forReplication: boolean;
  /** Whether the account is a member of the participation's laboratory. */
  readonly labMember: boolean;
}

function mayChange(item: Item, rights: ChecklistRights, uid: string): boolean {
  if (item.templateItemKey === READINESS_ITEM) return rights.forReplication;
  if (rights.manages) return true;
  // A member of the laboratory reopens only an item that the member completed.
  return rights.labMember && (item.status !== "done" || item.completedBy === uid);
}

function ItemRow({ item, rights, uid, label }: { item: Item; rights: ChecklistRights; uid: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const editable = mayChange(item, rights, uid);
  const change = async (status: Status) => {
    setBusy(true);
    const next: ChecklistChange = { status };
    try {
      await updateChecklistItem(uid, item.participationId, item.templateItemKey, next);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      toast.show({
        title: "The item was not changed.",
        description:
          code === "permission-denied"
            ? "Your account may not change this item. The leads of the replication approve readiness."
            : "Check your connection and try again.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        {item.label}
        {item.templateItemKey === READINESS_ITEM ? (
          <span className="block text-xs text-fg-muted">Decided by the leads of the replication or the programme.</span>
        ) : null}
      </span>
      {editable ? (
        <Select
          aria-label={`Status of ${item.label.toLowerCase()} for ${label}`}
          value={item.status}
          disabled={busy}
          onChange={(event) => change(event.target.value as Status)}
          className="w-44"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {CHECKLIST_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      ) : (
        <Badge tone={item.status === "done" ? "neutral" : item.status === "blocked" ? "accent" : "outline"}>
          {CHECKLIST_STATUS_LABELS[item.status]}
        </Badge>
      )}
    </li>
  );
}

export function ChecklistSection({
  items,
  rights,
  uid,
  label,
}: {
  items: readonly Item[];
  rights: ChecklistRights;
  uid: string;
  /** What the checklist belongs to, for the names of its controls. */
  label: string;
}) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const { settled, total } = checklistProgress(items);
  return (
    <div className="grid gap-2" data-testid="checklist">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="progressbar"
          aria-label={`Onboarding of ${label}`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={settled}
          className="h-2 w-40 overflow-hidden rounded-pill border border-border bg-surface-muted"
        >
          <div className="h-full bg-accent" style={{ width: `${total === 0 ? 0 : (settled / total) * 100}%` }} />
        </div>
        <span className="text-fg-secondary" data-testid="checklist-progress">
          {settled} of {total} items done or not applicable
        </span>
      </div>
      {total === 0 ? (
        <p className="text-fg-muted">This participation has no checklist.</p>
      ) : (
        <ul aria-label={`Onboarding checklist of ${label}`}>
          {sorted.map((item) => (
            <ItemRow key={item.id} item={item} rights={rights} uid={uid} label={label} />
          ))}
        </ul>
      )}
    </div>
  );
}
