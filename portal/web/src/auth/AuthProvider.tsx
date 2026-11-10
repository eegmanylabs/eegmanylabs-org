import { accountStanding, type Capability, capabilitiesOf } from "@eegml/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { leaveNotice, restartApplication, takeNotice } from "@/app/restart";
import { useToast } from "@/components/ui/toast";
import {
  type AccessRecord,
  CallableError,
  type CallableErrorCode,
  completeSignInLink,
  discardLocalData,
  type Live,
  observeSession,
  requestSignInLink,
  type SessionUser,
  SignInError,
  type SignInFailure,
  signInWithGoogle,
  signOut,
  startSession,
  useAccessRecord,
} from "@/data";
import { clearPendingSignIn, readPendingSignIn, rememberPendingSignIn, signInReturnUrl } from "./pending-sign-in";
import { safeReturnPath } from "./return-path";

export type SessionState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly user: SessionUser };

/** Progress of a sign-in link that this page was opened from. */
export type LinkState =
  | { readonly status: "none" }
  /** The link is being completed with the address this browser remembered. */
  | { readonly status: "completing" }
  /** The link was opened on a device that did not ask for it, so the address is needed again. */
  | { readonly status: "needs-email" }
  | {
      readonly status: "failed";
      readonly reason: SignInFailure;
      /** True while the link may still work, so that `retryLink` can try it again. */
      readonly retryable: boolean;
    };

/** Progress of the `sessionStart` call that tells the server the portal has started with this account. */
export type RegistrationState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "done" }
  | {
      readonly status: "failed";
      readonly code: CallableErrorCode;
      /** Safe to show: written for the person by the server, or a general text. */
      readonly message: string;
    };

export interface AuthContextValue {
  readonly session: SessionState;
  readonly link: LinkState;
  /** The account's access document, live. It is the document the security rules read. */
  readonly access: Live<AccessRecord | null>;
  readonly registration: RegistrationState;
  /** What the interface may show. Rules and functions make the real decisions. */
  readonly capabilities: ReadonlySet<Capability>;
  /** Emails a sign-in link. `next` is where to go once the link has been opened. */
  sendLink(email: string, next: string | null): Promise<void>;
  /** Forgets the address a link was asked for, for someone who wants to use another one. */
  forgetLinkRequest(): void;
  /** Finishes a link that was opened on another device, with the address it was sent to. */
  confirmLinkEmail(email: string): Promise<void>;
  /** Tries the link again after a failure that left it usable. */
  retryLink(): void;
  /** Gives up on the link this page was opened from, so that a new one can be asked for. */
  abandonLink(): void;
  signInWithGoogle(): Promise<void>;
  /** Signs out. The application then starts afresh at the sign-in page. */
  signOut(): Promise<void>;
  retryRegistration(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IDLE: RegistrationState = { status: "idle" };

// One sessionStart call for each start of the application with an account, however often
// React runs the effect that asks for it.
const registrations = new Map<string, Promise<unknown>>();

function registerOnce(uid: string): Promise<unknown> {
  let registration = registrations.get(uid);
  if (!registration) {
    registration = startSession();
    registrations.set(uid, registration);
    registration.catch(() => registrations.delete(uid));
  }
  return registration;
}

const failureOf = (error: unknown): SignInFailure => (error instanceof SignInError ? error.reason : "unknown");

/** A link that failed for one of these reasons cannot work again. After any other failure it may. */
const LINK_IS_SPENT: readonly SignInFailure[] = ["link-invalid", "account-disabled"];

export interface AuthProviderProps {
  /** The sign-in link this page was opened from, captured before the router started. */
  signInLink: string | null;
  children: ReactNode;
}

export function AuthProvider({ signInLink, children }: AuthProviderProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [link, setLink] = useState<LinkState>({ status: "none" });
  const [registration, setRegistration] = useState<RegistrationState>(IDLE);
  const [registrationAttempt, setRegistrationAttempt] = useState(0);

  // The account this page is showing, and whether the page is on its way out.
  const shownUid = useRef<string | null>(null);
  const leaving = useRef(false);

  useEffect(
    () =>
      observeSession((user) => {
        if (leaving.current) return;
        const previous = shownUid.current;
        if (previous !== null && user?.uid !== previous) {
          // The account this page was showing has signed out, here or in another tab, or
          // another account has taken its place. Nothing of it may stay: not in memory, not in
          // the local copy of the data, and not as a Firestore client that keeps running
          // without an account. The page throws all of it away and starts afresh.
          leaving.current = true;
          registrations.delete(previous);
          setSession({ status: "loading" });
          void discardLocalData()
            .catch(() => undefined)
            .then(() => restartApplication(user === null ? "/login" : null));
          return;
        }
        shownUid.current = user?.uid ?? null;
        setSession(user ? { status: "signed-in", user } : { status: "signed-out" });
      }),
    [],
  );

  // What was left to say before the application started again. `takeNotice` hands it out once,
  // so the second run of this effect in StrictMode finds nothing.
  useEffect(() => {
    if (takeNotice() === "signed-out") toast.show({ title: "You have signed out." });
  }, [toast]);

  // The address and destination of the latest attempt to complete the link, kept for `retryLink`.
  const attempt = useRef<{ email: string; next: string | null } | null>(null);
  const completing = useRef(false);

  const completeLink = useCallback(
    async (email: string, href: string, next: string | null) => {
      attempt.current = { email, next };
      completing.current = true;
      try {
        await completeSignInLink(email, href);
        clearPendingSignIn();
        attempt.current = null;
        setLink({ status: "none" });
        navigate(safeReturnPath(next), { replace: true });
      } catch (error) {
        const reason = failureOf(error);
        if (reason === "email-mismatch") {
          // A wrong address can be corrected, and the link is still good.
          setLink({ status: "needs-email" });
        } else {
          if (LINK_IS_SPENT.includes(reason)) {
            clearPendingSignIn();
            attempt.current = null;
          }
          setLink({ status: "failed", reason, retryable: attempt.current !== null });
        }
        throw error;
      } finally {
        completing.current = false;
      }
    },
    [navigate],
  );

  // Complete the sign-in link at start. The ref survives the double run of effects in StrictMode.
  const linkHandled = useRef(false);
  useEffect(() => {
    if (signInLink === null || linkHandled.current) return;
    linkHandled.current = true;
    const pending = readPendingSignIn();
    if (pending === null) {
      setLink({ status: "needs-email" });
      return;
    }
    setLink({ status: "completing" });
    completeLink(pending.email, signInLink, pending.next).catch(() => {
      // The link state already says what happened.
    });
  }, [signInLink, completeLink]);

  // A link that was opened while an account is already signed in is not needed. Say so at once
  // and forget it, so that its state cannot surface later, for example after a sign-out.
  const sessionStatus = session.status;
  const linkStatus = link.status;
  useEffect(() => {
    if (sessionStatus !== "signed-in" || completing.current) return;
    if (linkStatus !== "needs-email" && linkStatus !== "failed") return;
    attempt.current = null;
    setLink({ status: "none" });
    toast.show({ title: "You are already signed in.", description: "The sign-in link you opened was not used." });
  }, [sessionStatus, linkStatus, toast]);

  const uid = session.status === "signed-in" ? session.user.uid : null;
  const access = useAccessRecord(uid);

  // An account can be stopped while this page is open: suspended, or all its sessions ended.
  // The security rules then refuse the account everything, its own access document included.
  // The page sees that in one of two ways. Either the server ends the listener on the access
  // document with a refusal, which is what the emulator does. Or the server goes on delivering
  // to the listener that was already open, and the document itself says that the account is
  // stopped. Only a value from the server counts for that: a copy from the local cache says
  // nothing about now. Either way the page asks the server to start the session once more,
  // and the server's refusal says why (see `registration`).
  const signedInAt = session.status === "signed-in" ? session.user.signedInAt : null;
  const stopped =
    uid !== null &&
    ((access.status === "error" && access.error.code === "permission-denied") ||
      (access.status === "ready" &&
        !access.fromCache &&
        access.data !== null &&
        // Without the time of sign-in the page cannot tell whether its session has been ended.
        (access.data.suspended || signedInAt !== null) &&
        accountStanding(access.data, { authTimeSeconds: signedInAt }) !== "active"));
  useEffect(() => {
    if (!stopped || uid === null) return;
    registrations.delete(uid);
    setRegistrationAttempt((count) => count + 1);
  }, [stopped, uid]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: registrationAttempt is the retry trigger
  useEffect(() => {
    if (uid === null) {
      setRegistration(IDLE);
      return;
    }
    let current = true;
    setRegistration({ status: "pending" });
    registerOnce(uid).then(
      () => current && setRegistration({ status: "done" }),
      (error: unknown) => {
        const failure = error instanceof CallableError ? error : new CallableError("internal");
        if (current) setRegistration({ status: "failed", code: failure.code, message: failure.message });
      },
    );
    return () => {
      current = false;
    };
  }, [uid, registrationAttempt]);

  // The server refuses this account a session. Whatever the browser holds of the portal's data
  // was read while the account was allowed to, and goes now: the live values in memory, the
  // Firestore client and its local copy of the documents. The page then shows the refusal and
  // nothing else, and anything further starts with a fresh page (see `restartApplication`).
  const refused =
    registration.status === "failed" &&
    (registration.code === "permission-denied" || registration.code === "unauthenticated");
  useEffect(() => {
    if (refused) void discardLocalData().catch(() => undefined);
  }, [refused]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      link,
      access,
      registration,
      capabilities: capabilitiesOf({
        signedIn: session.status === "signed-in",
        access: access.status === "ready" ? access.data : null,
      }),
      async sendLink(email, next) {
        await requestSignInLink(email, signInReturnUrl());
        rememberPendingSignIn({ email, next });
        attempt.current = null;
        setLink({ status: "none" });
      },
      forgetLinkRequest() {
        clearPendingSignIn();
      },
      async confirmLinkEmail(email) {
        if (signInLink === null) throw new SignInError("link-invalid");
        await completeLink(email, signInLink, readPendingSignIn()?.next ?? null);
      },
      retryLink() {
        const latest = attempt.current;
        if (signInLink === null || latest === null) return;
        setLink({ status: "completing" });
        completeLink(latest.email, signInLink, latest.next).catch(() => {
          // The link state already says what happened.
        });
      },
      abandonLink() {
        attempt.current = null;
        clearPendingSignIn();
        setLink({ status: "none" });
      },
      async signInWithGoogle() {
        await signInWithGoogle();
      },
      async signOut() {
        clearPendingSignIn();
        leaveNotice("signed-out");
        try {
          // The observer above sees the account go, discards its data and restarts the
          // application at the sign-in page.
          await signOut();
        } catch (error) {
          leaveNotice(null);
          throw error;
        }
      },
      retryRegistration() {
        if (uid !== null) registrations.delete(uid);
        setRegistrationAttempt((count) => count + 1);
      },
    }),
    [session, link, access, registration, signInLink, completeLink, uid],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>.");
  return value;
}

/** The signed-in account. Only for components that render inside `RequireAuth`. */
export function useSignedInUser(): SessionUser {
  const { session } = useAuth();
  if (session.status !== "signed-in") throw new Error("useSignedInUser must be used inside <RequireAuth>.");
  return session.user;
}
