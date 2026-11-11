import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Live } from "@/data";
import { ErrorState } from "./error-state";
import { LoadingState } from "./loading-state";

/** How long a view may load before it says that this is taking long. */
export const SLOW_AFTER_MS = 8_000;

export interface LiveViewProps<T> {
  live: Live<T>;
  /** What is loading, for example "Loading your account". */
  loadingLabel: string;
  /** Replaces the default loading state, for example with skeletons of the final layout. */
  loading?: ReactNode;
  /** Title of the error state. The description is chosen from the kind of failure. */
  errorTitle: string;
  /** Asks for the value again. With it, the error state offers a "Try again" button. */
  onRetry?: () => void;
  /**
   * Replaces the error state when the server refused the read, for example a page that the
   * account no longer has access to, with a way out.
   */
  denied?: ReactNode;
  children: (data: T) => ReactNode;
}

function describeFailure(code: string): string {
  if (code === "permission-denied") return "Your account is not allowed to see this.";
  if (code === "unavailable") return "The portal could not reach its server. Check your connection.";
  if (code === "data/invalid-shape") {
    return "This record is in a form this version of the portal does not understand. Reload the page to get the latest version.";
  }
  return "Reload the page to try again.";
}

/**
 * The loading state. A custom one, such as a skeleton, is decoration for assistive technology,
 * so the label is always there as a status. After a while the view says that it is still
 * waiting, because a connection that never answers would otherwise look like one that is slow.
 */
function Loading({ label, custom }: { label: string; custom: ReactNode | undefined }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      {custom === undefined ? (
        <LoadingState label={label} />
      ) : (
        <>
          <span role="status" className="sr-only">
            {label}
          </span>
          {custom}
        </>
      )}
      {slow ? (
        <p role="status" className="mt-2 text-fg-muted">
          This is taking longer than usual. Check your connection.
        </p>
      ) : null}
    </>
  );
}

/**
 * Renders a live value with the portal's standard loading and error states, so every data view
 * handles the three cases the same way. Nothing is rendered while there is nothing to watch.
 */
export function LiveView<T>({ live, loadingLabel, loading, errorTitle, onRetry, denied, children }: LiveViewProps<T>) {
  switch (live.status) {
    case "idle":
      return null;
    case "loading":
      return <Loading label={loadingLabel} custom={loading} />;
    case "error":
      if (denied !== undefined && live.error.code === "permission-denied") return denied;
      return (
        <ErrorState
          title={errorTitle}
          description={describeFailure(live.error.code)}
          action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
        />
      );
    case "ready":
      return children(live.data);
  }
}
