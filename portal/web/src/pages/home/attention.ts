// What needs a coordinator's attention in the laboratories they coordinate. Pure, so that it is
// tested by itself.
import { laboratoryPath } from "@/registry/paths";

export interface AttentionItem {
  readonly id: string;
  readonly laboratoryId: string;
  /** What the item says, given the name of the laboratory. */
  readonly text: (laboratoryName: string) => string;
  readonly to: string;
}

/** The participations that are still being set up, where open checklist items matter. */
const SETTING_UP = new Set(["invited", "interested", "confirmed", "onboarding"]);

export function attentionItems(input: {
  readonly laboratoryIds: readonly string[];
  readonly participations: readonly {
    readonly id: string;
    readonly laboratoryId: string;
    readonly replicationId: string;
    readonly status: string;
    readonly archivedAt: unknown;
  }[];
  readonly currentEquipment: readonly { readonly laboratoryId: string; readonly archivedAt: unknown }[];
  readonly checklistItems: readonly {
    readonly participationId: string;
    readonly status: string;
    readonly archivedAt: unknown;
  }[];
  readonly pendingRequests: readonly { readonly laboratoryId: string }[];
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const laboratoryId of input.laboratoryIds) {
    const requests = input.pendingRequests.filter((request) => request.laboratoryId === laboratoryId).length;
    if (requests > 0) {
      items.push({
        id: `requests:${laboratoryId}`,
        laboratoryId,
        text: (name) =>
          `${requests} ${requests === 1 ? "request" : "requests"} to represent ${name} ${requests === 1 ? "waits" : "wait"} for your decision`,
        to: "/admin/lab-claims",
      });
    }
    if (
      !input.currentEquipment.some(
        (configuration) => configuration.laboratoryId === laboratoryId && configuration.archivedAt == null,
      )
    ) {
      items.push({
        id: `equipment:${laboratoryId}`,
        laboratoryId,
        text: (name) => `${name} has no equipment recorded, so its compatibility is unknown`,
        to: `${laboratoryPath(laboratoryId)}?tab=equipment`,
      });
    }
    for (const participation of input.participations) {
      if (participation.laboratoryId !== laboratoryId || participation.archivedAt != null) continue;
      if (participation.status === "invited") {
        items.push({
          id: `invited:${participation.id}`,
          laboratoryId,
          text: (name) => `${name} is invited to ${participation.replicationId} and has not answered`,
          to: `${laboratoryPath(laboratoryId)}?tab=participations`,
        });
      }
      if (!SETTING_UP.has(participation.status)) continue;
      const open = input.checklistItems.filter(
        (item) =>
          item.participationId === participation.id &&
          item.archivedAt == null &&
          item.status !== "done" &&
          item.status !== "notApplicable",
      ).length;
      if (open > 0) {
        items.push({
          id: `checklist:${participation.id}`,
          laboratoryId,
          text: (name) =>
            `${open} onboarding ${open === 1 ? "item" : "items"} of ${name} in ${participation.replicationId} ${open === 1 ? "is" : "are"} open`,
          to: `${laboratoryPath(laboratoryId)}?tab=participations`,
        });
      }
    }
  }
  return items;
}
