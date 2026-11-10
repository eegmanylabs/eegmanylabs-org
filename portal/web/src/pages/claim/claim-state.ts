// Which outcome of the claim the page shows, from what the server has said and what the
// account's own documents say now. Pure, so that it is tested by itself.
import type { ClaimProfileOutput } from "@eegml/shared";

/** The state of the call to claimProfile. */
export type ClaimCall =
  | { readonly status: "waiting" }
  | { readonly status: "done"; readonly result: ClaimProfileOutput }
  | { readonly status: "failed"; readonly message: string };

export interface ClaimFacts {
  /** The person the access document links the account to, or null. */
  readonly personId: string | null;
  /** The status of `accountClaims/{uid}`, or null when the account has no claim. */
  readonly claimStatus: "pendingReview" | "approved" | "rejected" | "withdrawn" | null;
  readonly call: ClaimCall;
}

/**
 * | View       | Shown when                                                                 |
 * |------------|----------------------------------------------------------------------------|
 * | `linked`   | The account is linked to a person                                          |
 * | `review`   | The claim, or a request for access, waits for an administrator             |
 * | `rejected` | An administrator has decided against the claim. A new request may be made |
 * | `noMatch`  | No person carries the address and nothing has been asked yet               |
 * | `checking` | The server has not answered yet                                            |
 * | `failed`   | The server could not answer                                                |
 *
 * The account's own documents come first, because they change while the page is open: an
 * administrator's decision shows up without a reload.
 */
export type ClaimView = "linked" | "review" | "rejected" | "noMatch" | "checking" | "failed";

export function claimView(facts: ClaimFacts): ClaimView {
  if (facts.personId !== null) return "linked";
  if (facts.claimStatus === "pendingReview") return "review";
  if (facts.claimStatus === "rejected") return "rejected";
  const { call } = facts;
  if (call.status === "waiting") return "checking";
  if (call.status === "failed") return "failed";
  switch (call.result.status) {
    case "linked":
      // The access document follows in the same transaction. Until this page sees it, it waits.
      return "checking";
    case "pendingReview":
      return "review";
    case "rejected":
      return "rejected";
    case "noMatch":
      return "noMatch";
  }
}
