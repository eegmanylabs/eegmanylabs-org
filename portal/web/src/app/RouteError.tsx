import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

/**
 * Whether a page failed because its code could not be downloaded: a dynamic import that the
 * browser could not fetch, which happens when a page that was never opened is opened offline.
 */
export function isPageDownloadFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return (
    typeof message === "string" &&
    /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      message,
    )
  );
}

/**
 * Shown in place of a page that failed to render. The fault is written to the console for
 * whoever investigates. The person sees what they can do next, not the fault itself. A page
 * whose code could not be downloaded loads itself again as soon as the connection returns.
 */
export function RouteError() {
  const error = useRouteError();
  console.error(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const download = !notFound && isPageDownloadFailure(error);
  useEffect(() => {
    if (!download) return;
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, [download]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="mx-auto max-w-reading p-6">
      <ErrorState
        title={
          notFound
            ? "This page does not exist."
            : download
              ? offline
                ? "This page could not be downloaded because you are offline."
                : "This page could not be downloaded."
              : "This page could not be shown."
        }
        description={
          notFound
            ? "Check the address, or go back to Home."
            : download
              ? "It opens by itself once the connection returns. You can also try again now."
              : "Something went wrong while showing it. Reloading usually helps."
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>{download ? "Try again" : "Reload the page"}</Button>
            <Button asChild variant="ghost">
              <a href="#/">Go to Home</a>
            </Button>
          </div>
        }
      />
    </div>
  );
}
