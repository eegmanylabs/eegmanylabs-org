import { describe, expect, it } from "vitest";
import { type ClaimFacts, claimView } from "./claim-state";

const facts = (overrides: Partial<ClaimFacts>): ClaimFacts => ({
  personId: null,
  claimStatus: null,
  call: { status: "waiting" },
  ...overrides,
});

describe("claimView", () => {
  it("shows the profile as soon as the account is linked, whatever else is known", () => {
    expect(claimView(facts({ personId: "person-1" }))).toBe("linked");
    expect(claimView(facts({ personId: "person-1", call: { status: "done", result: { status: "noMatch" } } }))).toBe(
      "linked",
    );
  });

  it("waits for the access document after the server has linked the account", () => {
    expect(claimView(facts({ call: { status: "done", result: { status: "linked", personId: "person-1" } } }))).toBe(
      "checking",
    );
  });

  it("follows the stored claim, so that a reviewer's decision shows up while the page is open", () => {
    const noMatch = { status: "done", result: { status: "noMatch" } } as const;
    expect(claimView(facts({ claimStatus: "pendingReview", call: noMatch }))).toBe("review");
    expect(claimView(facts({ claimStatus: "rejected", call: { status: "waiting" } }))).toBe("rejected");
  });

  it("asks for access when nothing matched and nothing has been asked", () => {
    expect(claimView(facts({ call: { status: "done", result: { status: "noMatch" } } }))).toBe("noMatch");
    expect(
      claimView(facts({ call: { status: "done", result: { status: "pendingReview", statementGiven: false } } })),
    ).toBe("review");
    expect(claimView(facts({ call: { status: "done", result: { status: "rejected" } } }))).toBe("rejected");
  });

  it("says when the server is still checking or could not answer", () => {
    expect(claimView(facts({}))).toBe("checking");
    expect(claimView(facts({ call: { status: "failed", message: "Unavailable." } }))).toBe("failed");
  });
});
