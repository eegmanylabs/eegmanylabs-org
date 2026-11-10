// What the browser remembers between asking for a sign-in link and opening it.
import { z } from "@eegml/shared";
import { isSignInLink } from "@/data";
import { readStored, writeStored } from "@/utils/storage";

const STORAGE_KEY = "portal.signIn.pending";

/**
 * How long the address is remembered: as long as a link can be expected to work. Firebase lets
 * a sign-in link expire after some hours. After this time the address is forgotten, and a link
 * that still works asks for the address again.
 */
export const PENDING_LIFETIME_MS = 6 * 60 * 60 * 1000;

const pendingSchema = z.object({
  email: z.string().min(1),
  next: z.string().nullable(),
  requestedAt: z.number(),
});

export interface PendingSignIn {
  /** The address the link was sent to. Firebase needs it again to complete the link. */
  readonly email: string;
  /** Where the visitor was heading when they were asked to sign in. */
  readonly next: string | null;
}

export function rememberPendingSignIn(pending: PendingSignIn, now: number = Date.now()): void {
  const { email, next } = pending;
  writeStored(STORAGE_KEY, JSON.stringify({ email, next, requestedAt: now }));
}

/**
 * The remembered request, or null. An entry that is older than a link lasts, that carries a
 * time in the future or that cannot be read is removed, so an address typed on a shared
 * computer does not stay there.
 */
export function readPendingSignIn(now: number = Date.now()): PendingSignIn | null {
  const stored = readStored(STORAGE_KEY);
  if (stored === null) return null;
  let entry: z.output<typeof pendingSchema> | null = null;
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(stored));
    if (parsed.success) entry = parsed.data;
  } catch {
    // Not JSON: treated like any other entry that cannot be read.
  }
  const age = entry === null ? Number.NaN : now - entry.requestedAt;
  if (entry === null || !(age >= 0 && age <= PENDING_LIFETIME_MS)) {
    clearPendingSignIn();
    return null;
  }
  return { email: entry.email, next: entry.next };
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

/**
 * The address a sign-in link should bring the visitor back to: the start address of this
 * application and nothing more. It is taken from the address the document was loaded from,
 * without the file name, the query and the fragment.
 */
export function signInReturnUrl(documentAddress: string = document.baseURI): string {
  const start = new URL("./", documentAddress);
  return `${start.origin}${start.pathname}`;
}
