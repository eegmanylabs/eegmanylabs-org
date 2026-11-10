import { laboratoryScopeKey, PROGRAMME_SCOPE_KEY, replicationScopeKey } from "@eegml/shared";
import { describe, expect, it, vi } from "vitest";
import { labClaimLaboratories, pendingLabClaimsQuery } from "./queues";

vi.mock("@/data", () => ({}));

const access = (labsClaimsReview: string[] | undefined) => ({
  suspended: false,
  capabilities: labsClaimsReview === undefined ? {} : { labsClaimsReview },
});

describe("the laboratories whose requests an account decides", () => {
  it("are read from a coordinator's laboratory-scoped capability without throwing", () => {
    const coordinator = access([
      laboratoryScopeKey("lab-a"),
      replicationScopeKey("StudyA2001"),
      laboratoryScopeKey("lab-b"),
    ]);
    expect(labClaimLaboratories(coordinator)).toEqual(["lab-a", "lab-b"]);
    expect(pendingLabClaimsQuery(coordinator)?.where).toEqual([
      ["laboratoryId", "in", ["lab-a", "lab-b"]],
      ["status", "==", "pendingReview"],
    ]);
  });

  it("are none for an account without the capability, and every one for the programme", () => {
    expect(labClaimLaboratories(access(undefined))).toEqual([]);
    expect(pendingLabClaimsQuery(access(undefined))).toBeNull();
    expect(pendingLabClaimsQuery(access([PROGRAMME_SCOPE_KEY]))?.where).toEqual([["status", "==", "pendingReview"]]);
  });
});
