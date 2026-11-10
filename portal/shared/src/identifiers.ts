// The canonical forms of values that people type. Identifier derivation is in ids.ts. Every function
// here is pure and deterministic: the same input always gives the same result, which is what
// makes imports and retried operations idempotent.

/**
 * The canonical form of an email address used for matching and storage: surrounding white space
 * removed and lower case. The local part is left otherwise untouched.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The longest display name the portal stores, in UTF-16 code units. */
export const DISPLAY_NAME_MAX_LENGTH = 200;

// Control characters, and the characters that reorder text and can make a name read as another.
const UNSAFE_IN_NAMES = /[\p{Cc}‪-‮⁦-⁩]/gu;

/**
 * The stored form of a name that an account gives itself: control characters and
 * text-direction overrides removed, runs of white space collapsed to one space, cut to
 * `DISPLAY_NAME_MAX_LENGTH`, and null when nothing is left or the value is not text.
 *
 * The result is safe to store and to show. It is still whatever the account chose to call
 * itself, so it identifies nobody.
 */
export function normaliseDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(UNSAFE_IN_NAMES, " ").replace(/\s+/gu, " ").trim();
  let cut = "";
  // By code point, so the cut never splits a character in two.
  for (const character of cleaned) {
    if (cut.length + character.length > DISPLAY_NAME_MAX_LENGTH) break;
    cut += character;
  }
  cut = cut.trimEnd();
  return cut === "" ? null : cut;
}

/**
 * Whether a bare ORCID iD, such as `0000-0002-1825-0097`, carries the check digit that
 * ISO 7064 MOD 11-2 gives its first fifteen digits. A mistyped iD almost never does.
 */
export function hasValidOrcidCheckDigit(orcid: string): boolean {
  const digits = orcid.replaceAll("-", "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  return (check === 10 ? "X" : String(check)) === digits[15];
}
