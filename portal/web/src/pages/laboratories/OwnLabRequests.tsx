// The member's own requests to represent or register a laboratory that wait for review, with a
// way to withdraw each. Shown on Home and above the list of laboratories, so that a request does
// not vanish once it is sent and the member does not send it twice.
import { withdrawLabClaimContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { formatDate } from "@/app/labels";
import { useSignedInUser } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, useLiveQuery } from "@/data";
import { ownLabClaims, useLaboratories } from "@/registry/queries";

type Claim = RecordOf<"labClaims">;

const ROLE_WORDS = { coordinator: "coordinator", representative: "authorised representative" } as const;

/** The pending requests of the signed-in account, newest first, or an empty list while they load. */
export function useOwnPendingLabClaims(): readonly Claim[] {
  const user = useSignedInUser();
  const claims = useLiveQuery(ownLabClaims(user.uid));
  return useMemo(
    () =>
      (claims.status === "ready" ? claims.data : [])
        .filter((claim) => claim.status === "pendingReview" && claim.archivedAt === null)
        .sort((a, b) => b.submittedAt.toMillis() - a.submittedAt.toMillis()),
    [claims],
  );
}

function Withdraw({ claim, name }: { claim: Claim; name: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      aria-label={`Withdraw your request for ${name}`}
      onClick={async () => {
        setBusy(true);
        try {
          await callFunction(withdrawLabClaimContract, { claimId: claim.id });
          toast.show({ title: "Your request has been withdrawn.", description: "You can send a new one at any time." });
        } catch (error) {
          toast.show({
            title: "Your request was not withdrawn.",
            description: error instanceof CallableError ? error.message : "Try again in a moment.",
            tone: "error",
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Withdrawing…" : "Withdraw"}
    </Button>
  );
}

/** The list of the member's requests that wait for review. Renders nothing while there are none. */
export function OwnLabRequests() {
  const pending = useOwnPendingLabClaims();
  const laboratories = useLaboratories();
  const names = useMemo(
    () =>
      new Map(
        (laboratories.status === "ready" ? laboratories.data : []).map((laboratory) => [
          laboratory.id,
          laboratory.name,
        ]),
      ),
    [laboratories],
  );
  if (pending.length === 0) return null;
  return (
    <section
      aria-labelledby="own-lab-requests-heading"
      className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="own-lab-requests"
    >
      <h2 id="own-lab-requests-heading" className="font-medium text-fg-strong">
        Waiting for review
      </h2>
      <ul className="grid gap-2">
        {pending.map((claim) => {
          const name = claim.proposal?.name ?? names.get(claim.laboratoryId) ?? "A laboratory";
          return (
            <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {claim.proposal === undefined ? "To represent" : "To register"} {name}, as{" "}
                {ROLE_WORDS[claim.requestedRole]}. Sent {formatDate(claim.submittedAt.toDate())}.
              </span>
              <Withdraw claim={claim} name={name} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
