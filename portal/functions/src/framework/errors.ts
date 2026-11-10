// Errors a handler may raise on purpose. Their message is written for the person using the
// portal and is sent to the browser as it stands, marked as public. Every other error,
// including one that a library raises with a client-facing code, is treated as a fault: it is
// logged in full on the server and the browser receives a fixed, general message.
import { type CallableErrorReason, publicErrorDetails } from "@eegml/shared";
import { type FunctionsErrorCode, HttpsError } from "firebase-functions/https";

/**
 * | Code                  | Use when                                                        |
 * |-----------------------|-----------------------------------------------------------------|
 * | `invalid-argument`    | The request is well formed but a value in it cannot be accepted |
 * | `failed-precondition` | The caller's account or the data is not in the required state   |
 * | `permission-denied`   | The caller is signed in but may not do this                     |
 * | `not-found`           | The thing asked for does not exist, or the caller may not know that it exists |
 * | `already-exists`      | The thing to be created is already there                        |
 * | `resource-exhausted`  | A limit has been reached                                        |
 */
export type AppErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "resource-exhausted";

export class AppError extends Error {
  override readonly name = "AppError";

  constructor(
    readonly code: AppErrorCode,
    /** Shown to the caller. Must not contain identifiers, addresses or stored values. */
    readonly publicMessage: string,
    /** What the interface can act on, where the registry of reasons in the shared package has a row for it. */
    readonly reason: CallableErrorReason | null = null,
  ) {
    super(publicMessage);
  }
}

/** The error sent to a browser for a failure the portal raised on purpose. */
export function publicError(
  code: FunctionsErrorCode,
  message: string,
  reason: CallableErrorReason | null = null,
): HttpsError {
  return new HttpsError(code, message, publicErrorDetails(reason));
}

/** What a caller is told when something fails that they could not have caused. */
export const INTERNAL_ERROR_MESSAGE = "Something went wrong on our side. Try again in a moment.";
export const INVALID_REQUEST_MESSAGE = "The request was not understood.";
export const SIGN_IN_REQUIRED_MESSAGE = "Sign in to continue.";
export const ACCOUNT_SUSPENDED_MESSAGE = "This account has been suspended. Contact a programme administrator.";
export const SESSION_ENDED_MESSAGE = "This session has been ended. Sign in again to continue.";
export const EMAIL_NOT_VERIFIED_MESSAGE = "A verified email address is needed to use the portal.";
export const SECOND_FACTOR_REQUIRED_MESSAGE =
  "This action needs your second factor. Sign out, sign in again and complete the second step.";
export const NOT_ALLOWED_MESSAGE = "Your account is not allowed to do this.";
