// Authentication operations. The rest of the application sees accounts as `SessionUser` values
// and failures as `SignInError` values, never as Firebase types.
import {
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { config } from "@/app/config";
import { auth } from "./firebase";
import { closeLiveData } from "./live";

export interface SessionUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  /**
   * When this session began, in seconds since the epoch, or null when Firebase does not say.
   * It is the time the sign-in token states as `auth_time`, which the security rules and the
   * functions compare with `sessionsValidAfter` of the access document.
   */
  readonly signedInAt: number | null;
}

/**
 * | Reason                | Meaning                                                              |
 * |-----------------------|----------------------------------------------------------------------|
 * | `link-invalid`        | The sign-in link has expired or has already been used                |
 * | `email-mismatch`      | The address entered is not the one the link was sent to              |
 * | `invalid-email`       | The service does not accept the value as an email address            |
 * | `address-refused`     | No link was sent because of the address: its account is unknown or disabled. Only when asking for a link |
 * | `network`             | The authentication service could not be reached                      |
 * | `service-unavailable` | The service refused the request for a reason that has nothing to do with the address |
 * | `account-disabled`    | The account has been disabled                                        |
 * | `cancelled`           | The person closed the pop-up window                                  |
 * | `popup-blocked`       | The browser stopped the pop-up window from opening                   |
 * | `unknown`             | Anything else                                                        |
 */
export type SignInFailure =
  | "link-invalid"
  | "email-mismatch"
  | "invalid-email"
  | "address-refused"
  | "network"
  | "service-unavailable"
  | "account-disabled"
  | "cancelled"
  | "popup-blocked"
  | "unknown";

export class SignInError extends Error {
  override readonly name = "SignInError";

  constructor(readonly reason: SignInFailure) {
    super(`Sign-in failed: ${reason}`);
  }
}

type FailureMap = Readonly<Record<string, SignInFailure>>;

/** Failures that mean the same whatever was being attempted. */
const FAILURES: FailureMap = {
  "auth/network-request-failed": "network",
  "auth/user-disabled": "account-disabled",
  "auth/popup-closed-by-user": "cancelled",
  "auth/cancelled-popup-request": "cancelled",
  "auth/popup-blocked": "popup-blocked",
  // The service refuses for a reason of its own: a quota, a rate limit or its configuration.
  "auth/too-many-requests": "service-unavailable",
  "auth/quota-exceeded": "service-unavailable",
  "auth/operation-not-allowed": "service-unavailable",
  "auth/unauthorized-domain": "service-unavailable",
  "auth/unauthorized-continue-uri": "service-unavailable",
  "auth/invalid-continue-uri": "service-unavailable",
  "auth/missing-continue-uri": "service-unavailable",
  "auth/internal-error": "service-unavailable",
};

/** What the same codes mean while asking for a link. */
const WHILE_ASKING: FailureMap = {
  ...FAILURES,
  "auth/invalid-email": "invalid-email",
  "auth/missing-email": "invalid-email",
  // These two depend on the address, so the caller must not tell them apart from success.
  "auth/user-disabled": "address-refused",
  "auth/user-not-found": "address-refused",
};

/** What the same codes mean while completing a link. */
const WHILE_COMPLETING: FailureMap = {
  ...FAILURES,
  "auth/invalid-action-code": "link-invalid",
  "auth/expired-action-code": "link-invalid",
  // Firebase reports a link that was sent to another address as an invalid email address.
  "auth/invalid-email": "email-mismatch",
};

function toSignInError(error: unknown, failures: FailureMap): SignInError {
  const code = (error as { code?: unknown }).code;
  const reason = (typeof code === "string" ? failures[code] : undefined) ?? "unknown";
  if (reason === "service-unavailable" || reason === "unknown") {
    // Whoever looks into a deployment that sends no links needs the code. It names no address.
    console.error("The authentication service refused a request.", typeof code === "string" ? code : error);
  }
  return new SignInError(reason);
}

function toSessionUser(user: User): SessionUser {
  const signedInAt = user.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : Number.NaN;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    signedInAt: Number.isFinite(signedInAt) ? Math.floor(signedInAt / 1000) : null,
  };
}

/** Calls the listener now and whenever the signed-in account changes. Returns the unsubscriber. */
export function observeSession(listener: (user: SessionUser | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => listener(user ? toSessionUser(user) : null));
}

/**
 * Asks Firebase to email a single-use sign-in link. `returnUrl` is where the link brings the
 * person back to, and must be the address of this application without a query or a fragment.
 *
 * A rejection with the reason `address-refused` or `account-disabled` depends on the address.
 * The caller shows the same confirmation for it as for success, so that the form says nothing
 * about who has an account. Every other reason means that no link was sent to anyone.
 */
export async function requestSignInLink(email: string, returnUrl: string): Promise<void> {
  try {
    await sendSignInLinkToEmail(auth, email, { url: returnUrl, handleCodeInApp: true });
  } catch (error) {
    throw toSignInError(error, WHILE_ASKING);
  }
}

/** Whether an address is a sign-in link that this application should complete. */
export function isSignInLink(href: string): boolean {
  return isSignInWithEmailLink(auth, href);
}

/** Completes a sign-in link for the address it was sent to. */
export async function completeSignInLink(email: string, href: string): Promise<SessionUser> {
  try {
    return toSessionUser((await signInWithEmailLink(auth, email, href)).user);
  } catch (error) {
    throw toSignInError(error, WHILE_COMPLETING);
  }
}

/** Whether this build contains Google sign-in. */
export const googleSignInAvailable = config.googleSignIn;

/** Signs in with Google through a pop-up window. Only works when the build contains it. */
export async function signInWithGoogle(): Promise<SessionUser> {
  if (!config.googleSignIn) throw new SignInError("unknown");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return toSessionUser((await signInWithPopup(auth, provider)).user);
  } catch (error) {
    throw toSignInError(error, FAILURES);
  }
}

/**
 * Signs the account out. Whoever observes the session (see `observeSession`) then throws away
 * the account's local data with `discardLocalData` and loads the page afresh, in this tab and
 * in every other tab of the portal.
 */
export async function signOut(): Promise<void> {
  // Listeners first: once the account is gone the server would only refuse them.
  closeLiveData();
  await firebaseSignOut(auth);
}
