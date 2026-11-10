// What the browser remembers between asking for a sign-in link and opening it.
import { z } from "@eegml/shared";
import { isSignInLink } from "@/data";
import { readStored, writeStored } from "@/utils/storage";

const STORAGE_KEY = "portal.signIn.pending";

const pendingSchema = z.object({ email: z.string().min(1), next: z.string().nullable() });

export interface PendingSignIn {
  /** The address the link was sent to. Firebase needs it again to complete the link. */
  readonly email: string;
  /** Where the visitor was heading when they were asked to sign in. */
  readonly next: string | null;
}

export function rememberPendingSignIn(pending: PendingSignIn): void {
  writeStored(STORAGE_KEY, JSON.stringify(pending));
}

export function readPendingSignIn(): PendingSignIn | null {
  const stored = readStored(STORAGE_KEY);
  if (stored === null) return null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearPendingSignIn(): void {
  writeStored(STORAGE_KEY, null);
}

/**
 * Called once when the application starts. When the page was opened from a sign-in link, it
 * returns the link and removes the single-use code from the address bar and from history.
 */
export function captureSignInLink(
  location: Location = window.location,
  history: History = window.history,
): string | null {
  const href = location.href;
  if (!isSignInLink(href)) return null;
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
  return href;
}

/** The address a sign-in link should bring the visitor back to: this application, nothing more. */
export function signInReturnUrl(location: Location = window.location): string {
  return `${location.origin}${location.pathname}`;
}
