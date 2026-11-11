// Synthetic records only.
import { describe, expect, it } from "vitest";
import { attentionItems } from "./attention";

describe("what needs a coordinator's attention", () => {
  it("lists requests, missing equipment, unanswered invitations and open onboarding items of their laboratories", () => {
    const items = attentionItems({
      laboratoryIds: ["lab-a"],
      participations: [
        { id: "S1__lab-a", laboratoryId: "lab-a", replicationId: "S1", status: "invited", archivedAt: null },
        { id: "S2__lab-a", laboratoryId: "lab-a", replicationId: "S2", status: "collecting", archivedAt: null },
        { id: "S1__lab-b", laboratoryId: "lab-b", replicationId: "S1", status: "invited", archivedAt: null },
      ],
      currentEquipment: [{ laboratoryId: "lab-b", archivedAt: null }],
      checklistItems: [
        { participationId: "S1__lab-a", status: "notStarted", archivedAt: null },
        { participationId: "S1__lab-a", status: "done", archivedAt: null },
        { participationId: "S2__lab-a", status: "notStarted", archivedAt: null },
      ],
      pendingRequests: [{ laboratoryId: "lab-a" }, { laboratoryId: "lab-a" }],
    });
    expect(items.map((item) => item.text("Alpha Lab"))).toEqual([
      "2 requests to represent Alpha Lab wait for your decision",
      "Alpha Lab has no equipment recorded, so its compatibility is unknown",
      "Alpha Lab is invited to S1 and has not answered",
      "1 onboarding item of Alpha Lab in S1 is open",
    ]);
  });

  it("finds nothing where nothing waits", () => {
    expect(
      attentionItems({
        laboratoryIds: ["lab-a"],
        participations: [],
        currentEquipment: [{ laboratoryId: "lab-a", archivedAt: null }],
        checklistItems: [],
        pendingRequests: [],
      }),
    ).toEqual([]);
  });
});
