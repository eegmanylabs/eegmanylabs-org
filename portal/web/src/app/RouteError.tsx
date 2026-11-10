import { isRouteErrorResponse, useRouteError } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of a page that failed to render. The fault is written to the console for
 * whoever investigates. The person sees what they can do next, not the fault itself.
 */
export function RouteError() {
  const error = useRouteError();
  console.error(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="mx-auto max-w-reading p-6">
      <ErrorState
        title={notFound ? "This page does not exist." : "This page could not be shown."}
        description={
          notFound
            ? "Check the address, or go back to Home."
            : "Something went wrong while showing it. Reloading usually helps."
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload the page</Button>
            <Button asChild variant="ghost">
              <a href="#/">Go to Home</a>
            </Button>
          </div>
        }
      />
    </div>
  );
}
