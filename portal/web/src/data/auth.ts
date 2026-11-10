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
import { resetLiveData } from "./live";

export interface SessionUser {
  readonly uid: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

/**
 * | Reason             | Meaning                                                        |
 * |--------------------|----------------------------------------------------------------|
 * | `link-invalid`     | The sign-in link has expired or has already been used          |
 * | `email-mismatch`   | The address entered is not the one the link was sent to        |
 * | `network`          | The authentication service could not be reached                |
 * | `account-disabled` | The account has been disabled                                  |
 * | `cancelled`        | The person closed the pop-up window                            |
 * | `popup-blocked`    | The browser stopped the pop-up window from opening             |
 * | `unknown`          | Anything else                                                  |
 */
export type SignInFailure =
  | "link-invalid"
  | "email-mismatch"
  | "network"
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

const FAILURES: Record<string, SignInFailure> = {
  "auth/invalid-action-code": "link-invalid",
  "auth/expired-action-code": "link-invalid",
  "auth/invalid-email": "email-mismatch",
  "auth/network-request-failed": "network",
  "auth/user-disabled": "account-disabled",
  "auth/popup-closed-by-user": "cancelled",
  "auth/cancelled-popup-request": "cancelled",
  "auth/popup-blocked": "popup-blocked",
};

function toSignInError(error: unknown): SignInError {
  const code = (error as { code?: unknown }).code;
  return new SignInError((typeof code === "string" ? FAILURES[code] : undefined) ?? "unknown");
}

function toSessionUser(user: User): SessionUser {
  return { uid: user.uid, email: user.email, displayName: user.displayName };
}

/** Calls the listener now and whenever the signed-in account changes. Returns the unsubscriber. */
export function observeSession(listener: (user: SessionUser | null) => void): () => void {
  return onAuthStateChanged(auth, (user) => listener(user ? toSessionUser(user) : null));
}

/**
 * Asks Firebase to email a single-use sign-in link. `returnUrl` is where the link brings the
 * person back to, and must be the address of this application without a query or a fragment.
 */
export async function requestSignInLink(email: string, returnUrl: string): Promise<void> {
  try {
    await sendSignInLinkToEmail(auth, email, { url: returnUrl, handleCodeInApp: true });
  } catch (error) {
    throw toSignInError(error);
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
    throw toSignInError(error);
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
    throw toSignInError(error);
  }
}

export async function signOut(): Promise<void> {
  // Listeners first: once the account is gone they would only report permission errors.
  resetLiveData();
  await firebaseSignOut(auth);
}
