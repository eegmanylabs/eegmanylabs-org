import { describe, expect, it, vi } from "vitest";
import { reportStatusLabel } from "./ProfilePanel";

vi.mock("@/data", () => ({}));

describe("the status of a member's report", () => {
  const report = { field: "familyName", proposedValue: "Corrected" } as const;

  it("says corrected only when the record holds the proposed value", () => {
    expect(reportStatusLabel({ ...report, status: "accepted" }, { familyName: "Corrected" })).toBe("Corrected");
    expect(reportStatusLabel({ ...report, status: "accepted" }, { familyName: "Mistaken" })).toBe(
      "Accepted, not yet corrected",
    );
    expect(reportStatusLabel({ ...report, status: "accepted" }, null)).toBe("Accepted, not yet corrected");
  });

  it("names the other outcomes plainly", () => {
    expect(reportStatusLabel({ ...report, status: "open" }, null)).toBe("Open");
    expect(reportStatusLabel({ ...report, status: "rejected" }, null)).toBe("Not accepted");
    expect(reportStatusLabel({ ...report, status: "withdrawn" }, null)).toBe("Withdrawn");
  });
});
