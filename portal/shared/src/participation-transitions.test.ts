import { describe, expect, it } from "vitest";
import { PARTICIPATION_TRANSITIONS, participationTransition, transitionsFor } from "./participation-transitions";
import { participationStatusSchema } from "./schemas/participation";

const LABORATORY = new Set(["laboratory"] as const);
const REPLICATION = new Set(["replication"] as const);

describe("the moves of a participation", () => {
  it("leaves the laboratory only its answer to an invitation, the start of onboarding and a withdrawal", () => {
    const laboratoryMoves = PARTICIPATION_TRANSITIONS.filter((entry) => entry.decidedBy.includes("laboratory")).map(
      (entry) => `${entry.from}>${entry.to}`,
    );
    expect(laboratoryMoves.filter((move) => !move.endsWith(">withdrawn")).sort()).toEqual(
      ["confirmed>onboarding", "invited>confirmed", "invited>declined"].sort(),
    );
  });

  it("keeps ready, collection and its completion with the replication", () => {
    for (const entry of PARTICIPATION_TRANSITIONS) {
      if (["ready", "collecting", "collectionComplete"].includes(entry.to)) {
        expect(entry.decidedBy).toEqual(["replication"]);
      }
    }
    expect(transitionsFor("onboarding", LABORATORY).map((entry) => entry.to)).toEqual(["withdrawn"]);
    expect(transitionsFor("invited", LABORATORY).map((entry) => entry.to)).toEqual([
      "confirmed",
      "declined",
      "withdrawn",
    ]);
  });

  it("has no jump over readiness, and asks for approved readiness before collection", () => {
    expect(participationTransition("onboarding", "collecting")).toBeNull();
    expect(participationTransition("invited", "collectionComplete")).toBeNull();
    expect(participationTransition("interested", "onboarding")).toBeNull();
    expect(participationTransition("ready", "collecting")?.requiresApprovedReadiness).toBe(true);
    expect(PARTICIPATION_TRANSITIONS.filter((entry) => entry.requiresApprovedReadiness)).toHaveLength(1);
  });

  it("names only statuses that exist, each move once, and never a move to the same status", () => {
    const statuses = new Set(participationStatusSchema.options);
    const keys = PARTICIPATION_TRANSITIONS.map((entry) => `${entry.from}>${entry.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of PARTICIPATION_TRANSITIONS) {
      expect(statuses.has(entry.from) && statuses.has(entry.to)).toBe(true);
      expect(entry.from).not.toBe(entry.to);
    }
    expect(transitionsFor("collectionComplete", REPLICATION).map((entry) => entry.to)).toEqual(["collecting"]);
  });
});
