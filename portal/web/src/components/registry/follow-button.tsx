// Follows a page or a record for the signed-in account, or stops following it (requirement
// R16.1). A follower is told in the portal when the record changes, when a progress update is
// posted to it, and by email where their preferences ask for it. The rules let an account write
// its own subscriptions and nobody else's.
import { type EntityType, entityRefId } from "@eegml/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { setFollowing, useLiveDocument } from "@/data";

export function FollowButton({
  uid,
  entityType,
  entityId,
  label = "Follow updates",
}: {
  readonly uid: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  /** The text of the button while the record is not followed. */
  readonly label?: string;
}) {
  const subscription = useLiveDocument("userSubscriptions", [uid, entityRefId(entityType, entityId)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (subscription.status !== "ready") return null;
  const following = subscription.data !== null && subscription.data.level === "all";
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        aria-pressed={following}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          setFollowing(uid, entityType, entityId, !following)
            .catch(() => setError("The change was not saved."))
            .finally(() => setBusy(false));
        }}
      >
        {following ? "Stop following" : label}
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-xs text-fg-accent">
          {error}
        </span>
      )}
    </div>
  );
}
