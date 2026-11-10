// Identifier derivation. Every function here is pure and deterministic: the same input always
// gives the same identifier, which is what makes imports and retried operations idempotent.

/**
 * The canonical form of an email address used for matching and storage: surrounding white space
 * removed and lower case. The local part is left otherwise untouched.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
