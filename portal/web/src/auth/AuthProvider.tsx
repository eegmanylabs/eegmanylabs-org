import { type Capability, capabilitiesOf } from "@eegml/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "@/components/ui/toast";
import {
  type AccessRecord,
  completeSignInLink,
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
  | { readonly status: "failed"; readonly reason: SignInFailure };

/** Progress of the `sessionStart` call that registers the account with the server. */
export type RegistrationState = "idle" | "pending" | "done" | "failed";

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
  /** Finishes a link that was opened on another device, with the address it was sent to. */
  confirmLinkEmail(email: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  retryRegistration(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// One sessionStart call per sign-in, however often React runs the effect that asks for it.
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
  const [registration, setRegistration] = useState<RegistrationState>("idle");
  const [registrationAttempt, setRegistrationAttempt] = useState(0);

  useEffect(
    () => observeSession((user) => setSession(user ? { status: "signed-in", user } : { status: "signed-out" })),
    [],
  );

  const completeLink = useCallback(
    async (email: string, href: string, next: string | null) => {
      try {
        await completeSignInLink(email, href);
        clearPendingSignIn();
        setLink({ status: "none" });
        navigate(safeReturnPath(next), { replace: true });
      } catch (error) {
        const reason = failureOf(error);
        // A wrong address can be corrected. Anything else needs a new link.
        setLink(reason === "email-mismatch" ? { status: "needs-email" } : { status: "failed", reason });
        if (reason !== "email-mismatch") clearPendingSignIn();
        throw error;
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

  const uid = session.status === "signed-in" ? session.user.uid : null;
  const access = useAccessRecord(uid);

  // biome-ignore lint/correctness/useExhaustiveDependencies: registrationAttempt is the retry trigger
  useEffect(() => {
    if (uid === null) {
      setRegistration("idle");
      return;
    }
    let current = true;
    setRegistration("pending");
    registerOnce(uid).then(
      () => current && setRegistration("done"),
      () => current && setRegistration("failed"),
    );
    return () => {
      current = false;
    };
  }, [uid, registrationAttempt]);

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
        setLink({ status: "none" });
      },
      async confirmLinkEmail(email) {
        if (signInLink === null) throw new SignInError("link-invalid");
        await completeLink(email, signInLink, readPendingSignIn()?.next ?? null);
      },
      async signInWithGoogle() {
        await signInWithGoogle();
      },
      async signOut() {
        await signOut();
        registrations.clear();
        navigate("/login", { replace: true });
        toast.show({ title: "You have signed out." });
      },
      retryRegistration() {
        setRegistrationAttempt((attempt) => attempt + 1);
      },
    }),
    [session, link, access, registration, signInLink, completeLink, navigate, toast],
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
