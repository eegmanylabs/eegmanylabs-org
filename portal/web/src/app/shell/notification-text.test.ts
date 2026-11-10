import { describe, expect, it } from "vitest";
import { NAVIGATION } from "@/app/navigation";
import { describeNotification } from "./notification-text";

const KINDS = [
  "accountClaimAwaitsReview",
  "accessRequestAwaitsReview",
  "rolesAwaitApproval",
  "labClaimAwaitsReview",
  "accountClaimApproved",
  "accountClaimRejected",
  "accountUnlinked",
  "labClaimApproved",
  "labClaimRejected",
  "roleGranted",
  "roleRevoked",
  "capabilityGranted",
  "capabilityRevoked",
  "correctionResolved",
];

describe("describeNotification", () => {
  it("leads only to routes that exist", () => {
    const routes = new Set([...NAVIGATION.map((entry) => entry.to), "/claim"]);
    for (const kind of KINDS) {
      const { to } = describeNotification({ kind });
      if (to !== null) expect(routes, kind).toContain(to);
    }
  });

  it("names roles and counts in words", () => {
    expect(describeNotification({ kind: "roleGranted", role: "replication_lead" }).title).toBe(
      "You now hold the role Replication lead",
    );
    expect(describeNotification({ kind: "rolesAwaitApproval", count: 2 }).title).toBe("2 roles wait for confirmation");
    expect(describeNotification({ kind: "rolesAwaitApproval", count: 1 }).title).toBe("A role waits for confirmation");
  });

  it("passes on the administrator's message about a correction, and says the outcome", () => {
    expect(
      describeNotification({ kind: "correctionResolved", outcome: "accepted", message: "Fixed in the record." }),
    ).toEqual({
      title: "Your report of a wrong detail was accepted. The record will be corrected where the detail comes from",
      detail: "Fixed in the record.",
      to: "/",
    });
    expect(describeNotification({ kind: "correctionResolved", outcome: "accepted", applied: true }).title).toBe(
      "Your report of a wrong detail was accepted and your record corrected",
    );
    expect(describeNotification({ kind: "correctionResolved", outcome: "rejected" }).title).toContain("not accepted");
  });

  it("says something general about a kind it does not know, and leads nowhere", () => {
    expect(describeNotification({ kind: "somethingNew" })).toEqual({
      title: "Something changed that concerns you",
      detail: null,
      to: null,
    });
  });
});
