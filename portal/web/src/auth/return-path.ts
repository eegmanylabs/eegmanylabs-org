// Where to send someone after they have signed in.

export const DEFAULT_RETURN_PATH = "/";

/**
 * Accepts only a path inside the application. Anything else, including an address on another
 * site, falls back to Home, so a crafted sign-in address cannot send a member elsewhere.
 */
export function safeReturnPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_RETURN_PATH;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return DEFAULT_RETURN_PATH;
  if (candidate === "/login" || candidate.startsWith("/login?")) return DEFAULT_RETURN_PATH;
  return candidate;
}

/** The sign-in address that brings the visitor back to `path` afterwards. */
export function signInPathFor(path: string): string {
  const next = safeReturnPath(path);
  return next === DEFAULT_RETURN_PATH ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
