import { useEffect, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { reconnectLiveData, useLiveDataDisconnected } from "@/data";

/** How long the database may stay out of reach before the banner says so. Every start is briefly offline. */
export const DISCONNECTED_AFTER_MS = 4_000;

/**
 * Says, across the whole shell, that the portal's database cannot be reached and that what the
 * page shows may be out of date, with a way to try again. Views keep their loading state, and
 * never an empty state, until the database has answered once (see subscription-cache.ts).
 */
export function ConnectionBanner() {
  const disconnected = useLiveDataDisconnected();
  const [shown, setShown] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!disconnected) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), DISCONNECTED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [disconnected]);
  if (!shown) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await reconnectLiveData();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <ErrorState
      className="mb-4"
      title="Cannot reach the portal's database."
      description="What you see may be out of date, and changes may not be saved. The portal keeps trying to connect."
      action={
        <Button size="sm" disabled={retrying} onClick={() => void retry()}>
          Retry now
        </Button>
      }
    />
  );
}
