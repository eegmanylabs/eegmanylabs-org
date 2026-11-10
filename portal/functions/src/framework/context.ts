import type { Firestore } from "firebase-admin/firestore";

/** The source of the current time. Handlers ask the clock, never `new Date()`, so tests can set it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Structured logging. Entries must never contain special-category values. */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** What every handler receives besides its validated input. */
export interface CallableContext {
  /** The caller's account identifier, or null when the function allows signed-out callers. */
  readonly uid: string | null;
  /** The caller's email address, present only when the sign-in provider has verified it. */
  readonly verifiedEmail: string | null;
  /**
   * The name in the caller's sign-in token, normalised with `normaliseDisplayName`. Any account
   * can set it for itself through the Authentication API, so it is self-asserted text: never
   * use it to identify the caller or to decide anything.
   */
  readonly selfAssertedName: string | null;
  /** Firestore through the Admin SDK. It bypasses security rules: authorise before using it. */
  readonly db: Firestore;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The context of a function that requires a signed-in caller. */
export interface AuthenticatedContext extends CallableContext {
  readonly uid: string;
}
