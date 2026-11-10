import type { ReactNode } from "react";
import { ErrorState } from "./error-state";

/** Where a person whose account is suspended can ask about it: the contact page of the public site. */
export const PROGRAMME_CONTACT_URL = "https://eegmanylabs.org/contact/";

/**
 * The one way the portal says that an account is suspended, on the open page and on the
 * sign-in page alike, with the route to ask about it. Authentication reports a suspended
 * account as disabled, and the portal says "suspended" for both.
 */
export function SuspendedState({ action }: { action?: ReactNode }) {
  return (
    <ErrorState
      title="This account has been suspended."
      description="You cannot use the portal with it until a programme administrator lifts the suspension. To ask why, write to the programme through the contact page of eegmanylabs.org."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={PROGRAMME_CONTACT_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-control underline underline-offset-2 hover:text-fg-accent"
          >
            Contact the programme (opens in a new tab)
          </a>
          {action}
        </div>
      }
    />
  );
}
