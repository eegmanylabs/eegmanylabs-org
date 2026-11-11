// How a failed call to a function is described to the rest of the application. This file
// imports nothing from Firebase, so it can be tested by itself.
import { type CallableErrorReason, isPublicErrorDetails, publicErrorReason } from "@eegml/shared";

/** The reasons a call can fail, as the interface needs to tell them apart. */
export type CallableErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "resource-exhausted"
  | "unauthenticated"
  | "unavailable"
  | "internal";

/** What the person is told when the server sent no message that was written for them. */
export const GENERAL_MESSAGES: Readonly<Record<CallableErrorCode, string>> = {
  "invalid-argument": "The portal sent a request its server did not understand. Reload the page and try again.",
  "failed-precondition": "This cannot be done at the moment. Reload the page and try again.",
  "permission-denied": "Your account is not allowed to do this.",
  "not-found": "What you asked for could not be found.",
  "already-exists": "This already exists.",
  "resource-exhausted": "The portal is receiving too many requests. Try again in a moment.",
  unauthenticated: "Your session has ended. Sign in again to continue.",
  unavailable: "The portal could not reach its server. Check your connection and try again.",
  internal: "Something went wrong on our side. Try again in a moment.",
};

/** What the person is told when the server did not answer in time: the change may have been made or not. */
export const NO_ANSWER_MESSAGE =
  "The server did not answer in time. Nothing may have changed, or the change may have been made. Check the record and its activity before trying again.";

const isCode = (value: string): value is CallableErrorCode => Object.hasOwn(GENERAL_MESSAGES, value);

export class CallableError extends Error {
  override readonly name = "CallableError";

  constructor(
    readonly code: CallableErrorCode,
    /** Safe to show to the person using the portal. */
    message: string = GENERAL_MESSAGES[code],
    /** Why the server refused, where it said so, so that the interface can offer the next step. */
    readonly reason: CallableErrorReason | null = null,
  ) {
    super(message);
  }
}

/**
 * Turns whatever the Functions SDK rejected with into a `CallableError`.
 *
 * The server's message is used only when the error carries the mark that the portal's own
 * functions put on errors they raise on purpose (`PUBLIC_ERROR_DETAILS` in @eegml/shared). The
 * platform produces the same codes by itself, for a function that is not deployed, an access
 * policy or a rate limit, with texts such as "Forbidden" that were never written for a member.
 */
export function toCallableError(error: unknown): CallableError {
  const { code: rawCode, details } = (error ?? {}) as { code?: unknown; details?: unknown };
  const named = typeof rawCode === "string" ? rawCode.replace(/^functions\//, "") : "";
  if (named === "deadline-exceeded") return new CallableError("unavailable", NO_ANSWER_MESSAGE);
  const code: CallableErrorCode = isCode(named) ? named : "internal";
  if (isPublicErrorDetails(details) && error instanceof Error) {
    // The SDK appends the HTTP status, for example " [400]", to the server's message.
    const message = error.message.replace(/\s*\[\d{3}\]$/, "").trim();
    if (message !== "") return new CallableError(code, message, publicErrorReason(details));
  }
  return new CallableError(code);
}
