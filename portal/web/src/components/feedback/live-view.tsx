import type { ReactNode } from "react";
import type { Live } from "@/data";
import { ErrorState } from "./error-state";
import { LoadingState } from "./loading-state";

export interface LiveViewProps<T> {
  live: Live<T>;
  /** What is loading, for example "Loading your account". */
  loadingLabel: string;
  /** Replaces the default loading state, for example with skeletons of the final layout. */
  loading?: ReactNode;
  /** Title of the error state. The description is chosen from the kind of failure. */
  errorTitle: string;
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
 * Renders a live value with the portal's standard loading and error states, so every data view
 * handles the three cases the same way. Nothing is rendered while there is nothing to watch.
 */
export function LiveView<T>({ live, loadingLabel, loading, errorTitle, children }: LiveViewProps<T>) {
  switch (live.status) {
    case "idle":
      return null;
    case "loading":
      return loading ?? <LoadingState label={loadingLabel} />;
    case "error":
      return <ErrorState title={errorTitle} description={describeFailure(live.error.code)} />;
    case "ready":
      return children(live.data);
  }
}
