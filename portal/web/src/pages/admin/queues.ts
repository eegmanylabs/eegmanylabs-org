// The review queues of the administration console, read the same way on Home, where their
// sizes are shown, and on the pages that decide them.
import { can, listAccountClaimsContract, parseScopeKey } from "@eegml/shared";
import type { AccessRecord, LiveQuery } from "@/data";
import { useCallResult, useLiveQuery } from "@/data";

/** The most items a queue lists. */
export const QUEUE_LIMIT = 200;

/** The laboratories for which the account decides requests to represent them, as a coordinator. */
export function labClaimLaboratories(access: Pick<AccessRecord, "capabilities">): string[] {
  return (access.capabilities.labsClaimsReview ?? []).flatMap((scope) => {
    const unit = parseScopeKey(scope);
    return unit?.kind === "laboratory" ? [unit.id] : [];
  });
}

/**
 * The query of the requests to represent a laboratory that wait for a decision, oldest first:
 * every one for a holder of the capability for the programme, and those of the account's own
 * laboratories for a coordinator. Null for an account that decides none.
 */
export function pendingLabClaimsQuery(
  access: Pick<AccessRecord, "suspended" | "capabilities"> | null,
): LiveQuery<"labClaims"> | null {
  if (access === null) return null;
  if (can(access, "labs.claims.review", "programme")) {
    return {
      collection: "labClaims",
      within: [],
      where: [["status", "==", "pendingReview"]],
      orderBy: [["submittedAt", "asc"]],
      limit: QUEUE_LIMIT,
    };
  }
  const laboratories = labClaimLaboratories(access).slice(0, 30);
  if (laboratories.length === 0) return null;
  return {
    collection: "labClaims",
    within: [],
    where: [
      ["laboratoryId", "in", laboratories],
      ["status", "==", "pendingReview"],
    ],
    orderBy: [["submittedAt", "asc"]],
    limit: QUEUE_LIMIT,
  };
}

export const OPEN_CORRECTION_REQUESTS: LiveQuery<"correctionRequests"> = {
  collection: "correctionRequests",
  within: [],
  where: [["status", "==", "open"]],
  orderBy: [["createdAt", "asc"]],
  limit: QUEUE_LIMIT,
};

export const PENDING_ROLE_ASSIGNMENTS: LiveQuery<"roleAssignments"> = {
  collection: "roleAssignments",
  within: [],
  where: [["status", "==", "pendingApproval"]],
  limit: QUEUE_LIMIT,
};

export function usePendingLabClaims(access: Pick<AccessRecord, "suspended" | "capabilities"> | null) {
  return useLiveQuery(pendingLabClaimsQuery(access));
}

/** The account claims that wait for review, from the function that is the only way to list them. */
export function usePendingAccountClaims(enabled: boolean) {
  return useCallResult(listAccountClaimsContract, enabled ? { status: "pendingReview", limit: 100 } : null, "pending");
}
