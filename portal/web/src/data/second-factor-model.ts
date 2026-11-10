// The second factor as the rest of the application sees it: enrolled factors, the enrolment of
// a time-based one-time password, and the failures that can happen on the way. This file holds
// no Firebase call, so its logic is tested by itself. second-factor.ts implements the port with
// the Firebase SDK.
import type { MultiFactorInfo } from "firebase/auth";

/** A factor that an account has enrolled. */
export interface EnrolledFactor {
  /** The identifier of the enrolment, which removing it and answering a challenge name. */
  readonly uid: string;
  /** The name the member gave the factor, such as the name of the device. */
  readonly displayName: string | null;
  /** `totp` for an authenticator app, `phone` for a text message. */
  readonly factorId: string;
  /** When the factor was enrolled, as ISO 8601 text, or null when it is not known. */
  readonly enrolledAt: string | null;
}

/** The kinds of factor the portal can enrol and answer. Programme roles call for an authenticator app (D-015). */
export const SUPPORTED_FACTOR_IDS: readonly string[] = ["totp"];

export function factorOf(
  info: Pick<MultiFactorInfo, "uid" | "displayName" | "factorId" | "enrollmentTime">,
): EnrolledFactor {
  const enrolledAt = Date.parse(info.enrollmentTime);
  return {
    uid: info.uid,
    displayName: info.displayName ?? null,
    factorId: info.factorId,
    enrolledAt: Number.isFinite(enrolledAt) ? new Date(enrolledAt).toISOString() : null,
  };
}

/**
 * | Reason                  | Meaning                                                                    |
 * |-------------------------|----------------------------------------------------------------------------|
 * | `invalid-code`          | The code does not match. Codes change every 30 seconds                     |
 * | `expired`               | The enrolment or the sign-in took too long and has to start again          |
 * | `requires-recent-login` | The change needs a sign-in from the last few minutes                       |
 * | `unavailable`           | The project does not offer authenticator apps, or the service refused      |
 * | `network`               | The authentication service could not be reached                            |
 * | `unknown`               | Anything else                                                              |
 */
export type SecondFactorFailure =
  | "invalid-code"
  | "expired"
  | "requires-recent-login"
  | "unavailable"
  | "network"
  | "unknown";

export class SecondFactorError extends Error {
  override readonly name = "SecondFactorError";

  constructor(readonly reason: SecondFactorFailure) {
    super(`Second factor: ${reason}`);
  }
}

const FAILURES: Readonly<Record<string, SecondFactorFailure>> = {
  "auth/invalid-verification-code": "invalid-code",
  "auth/missing-code": "invalid-code",
  "auth/totp-challenge-timeout": "expired",
  "auth/code-expired": "expired",
  "auth/invalid-verification-id": "expired",
  "auth/multi-factor-info-not-found": "expired",
  "auth/requires-recent-login": "requires-recent-login",
  "auth/user-token-expired": "requires-recent-login",
  "auth/operation-not-allowed": "unavailable",
  "auth/unsupported-first-factor": "unavailable",
  "auth/admin-restricted-operation": "unavailable",
  "auth/maximum-second-factor-count-exceeded": "unavailable",
  "auth/too-many-requests": "unavailable",
  "auth/internal-error": "unavailable",
  "auth/network-request-failed": "network",
};

/** What a failure of the Firebase SDK means for the second factor. */
export function secondFactorFailureOf(error: unknown): SecondFactorFailure {
  if (error instanceof SecondFactorError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  return (typeof code === "string" ? FAILURES[code] : undefined) ?? "unknown";
}

/** What the member is told after a failure, and what they can do next. */
export const SECOND_FACTOR_MESSAGES: Readonly<Record<SecondFactorFailure, string>> = {
  "invalid-code": "That code did not match. Enter the code your authenticator app shows now.",
  expired: "This took too long and has to start again.",
  "requires-recent-login": "For your security this needs a recent sign-in. Sign out, sign in again and try once more.",
  unavailable: "The sign-in service did not accept this. Try again later, or contact a programme administrator.",
  network: "The portal could not reach the sign-in service. Check your connection and try again.",
  unknown: "Something went wrong with the second factor. Try again.",
};

/** A time-based one-time password that has been started and waits for its first code. */
export interface TotpEnrolment {
  /** The shared secret, in Base32, for typing into an authenticator app. */
  readonly secretKey: string;
  /** The `otpauth://` address that the QR code carries. */
  readonly otpauthUrl: string;
  /** How many digits a code has. */
  readonly codeLength: number;
  /** Confirms the enrolment with a code from the app. Rejects with a `SecondFactorError`. */
  complete(code: string, displayName: string): Promise<void>;
}

/** The second factor of the signed-in account. Rejections are `SecondFactorError` values. */
export interface SecondFactorApi {
  /** The factors the signed-in account has enrolled. */
  listFactors(): readonly EnrolledFactor[];
  /** Starts the enrolment of an authenticator app. `accountName` labels the entry in the app. */
  startTotpEnrolment(accountName: string): Promise<TotpEnrolment>;
  removeFactor(factorUid: string): Promise<void>;
}

/** The name the portal gives itself in authenticator apps. */
export const TOTP_ISSUER = "EEGManyLabs portal";

/**
 * Whether a code has the form an authenticator app shows: digits only, as many as the factor
 * uses. Spaces, which some apps put in the middle, are ignored.
 */
export function normaliseCode(code: string, length = 6): string | null {
  const digits = code.replace(/\s+/g, "");
  return new RegExp(`^\\d{${length}}$`).test(digits) ? digits : null;
}
