import { z } from "@eegml/shared";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import logo from "@/assets/logo.png";
import { type LinkState, useAuth } from "@/auth/AuthProvider";
import { safeReturnPath } from "@/auth/return-path";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { googleSignInAvailable, SignInError, type SignInFailure } from "@/data";

const emailSchema = z.email();
const EMAIL_FORMAT_MESSAGE = "Enter a full email address, for example name@example.org.";
const UNREACHABLE_MESSAGE = "The portal could not reach the sign-in service. Check your connection and try again.";
const DISABLED_MESSAGE = "Contact a programme administrator.";

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-form content-center gap-6 px-4 py-10">
      <img src={logo} alt="EEGManyLabs" width={1600} height={355} className="h-9 w-auto" />
      <h1 className="text-display text-fg">{title}</h1>
      {children}
    </main>
  );
}

/**
 * Outcomes of asking for a link that depend on the address. They are shown exactly like
 * success, so the form says nothing about who has an account.
 */
const SAME_AS_SENT: readonly SignInFailure[] = ["address-refused", "account-disabled"];

interface RequestFailure {
  readonly title: string;
  readonly description: string;
}

/** Failures that have nothing to do with the address: no link went out, and the person is told. */
function requestFailure(reason: SignInFailure): RequestFailure {
  if (reason === "network") return { title: "The link could not be requested.", description: UNREACHABLE_MESSAGE };
  return {
    title: "The link could not be sent.",
    description: "The sign-in service did not accept the request. Try again later.",
  };
}

/** Step 1: ask for a sign-in link. */
function RequestLinkForm({
  next,
  onSent,
  takeFocus,
}: {
  next: string;
  onSent: (email: string) => void;
  /** True when the form replaces something that had focus, so that focus is not left on nothing. */
  takeFocus: boolean;
}) {
  const { sendLink } = useAuth();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RequestFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const focusAtStart = useRef(takeFocus);
  useEffect(() => {
    if (focusAtStart.current) field.current?.focus();
  }, []);

  const rejectAddress = () => {
    setFieldError(EMAIL_FORMAT_MESSAGE);
    // Focus goes to the field, so that its description, the message, is read out.
    field.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = emailSchema.safeParse(email.trim());
    if (!address.success) {
      rejectAddress();
      return;
    }
    setFieldError(null);
    setFailure(null);
    setBusy(true);
    try {
      await sendLink(address.data, next);
      onSent(address.data);
    } catch (error) {
      const reason = error instanceof SignInError ? error.reason : "unknown";
      if (SAME_AS_SENT.includes(reason)) onSent(address.data);
      else if (reason === "invalid-email") rejectAddress();
      else setFailure(requestFailure(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      {failure ? <ErrorState title={failure.title} description={failure.description} /> : null}
      <FormField label="Email address" error={fieldError}>
        {(control) => (
          <Input
            {...control}
            ref={field}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              // The message described the value that was there. It goes as soon as that changes.
              setFieldError(null);
            }}
          />
        )}
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Email me a sign-in link
      </Button>
    </form>
  );
}

/** Step 2: the same confirmation for every address. It repeats what was typed, and only that. */
function LinkSent({ email, onReset }: { email: string; onReset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The form that had focus is gone. Focus moves here so that a keyboard does not start
  // again from the top of the page, and so that the confirmation is read out.
  useEffect(() => heading.current?.focus(), []);
  return (
    <div role="status" className="grid gap-3 rounded-card border border-border bg-surface p-5">
      <h2 ref={heading} tabIndex={-1} className="rounded-control text-lg font-medium text-fg-strong">
        Check your email
      </h2>
      <p className="text-fg-secondary">
        If the address you entered can receive email, a sign-in link is on its way. Open the link on this device to
        finish signing in. The link works once.
      </p>
      <p className="text-fg-secondary">
        You entered{" "}
        <strong data-testid="entered-address" className="font-medium break-all text-fg">
          {email}
        </strong>
        .
      </p>
      <div>
        <Button onClick={onReset}>Use a different address</Button>
      </div>
    </div>
  );
}

/** The link was opened in a browser that did not ask for it, so the address is needed again. */
function ConfirmEmailForm() {
  const { confirmLinkEmail, abandonLink } = useAuth();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const reject = (message: string) => {
    setFieldError(message);
    field.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = emailSchema.safeParse(email.trim());
    if (!address.success) {
      reject(EMAIL_FORMAT_MESSAGE);
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await confirmLinkEmail(address.data);
    } catch (error) {
      if (error instanceof SignInError && error.reason === "email-mismatch") {
        reject("That is not the address this link was sent to. Check it and try again.");
      }
      // Any other failure changes the link state, and the page says what happened.
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <p className="text-fg-secondary">
        This sign-in link was opened in a browser that did not ask for it. Enter the address the link was sent to and we
        will finish signing you in.
      </p>
      <FormField label="Email address" error={fieldError}>
        {(control) => (
          <Input
            {...control}
            ref={field}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldError(null);
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Finish signing in
        </Button>
        <Button onClick={abandonLink}>Ask for a new link</Button>
      </div>
    </form>
  );
}

/** What went wrong with the link this page was opened from, and what can be done about it. */
function LinkFailure({ link }: { link: Extract<LinkState, { status: "failed" }> }) {
  const { retryLink } = useAuth();
  const retry = link.retryable ? <Button onClick={retryLink}>Try again</Button> : undefined;
  switch (link.reason) {
    case "link-invalid":
      return (
        <ErrorState
          title="That sign-in link no longer works."
          description="A link expires after a while and works once. Ask for a new one below."
        />
      );
    case "account-disabled":
      return <ErrorState title="This account has been disabled." description={DISABLED_MESSAGE} />;
    case "network":
      return (
        <ErrorState
          title="The portal could not reach the sign-in service."
          description={
            link.retryable
              ? "Your link has not been used. Check your connection and try again."
              : "Check your connection and open the link from your email again."
          }
          action={retry}
        />
      );
    default:
      return (
        <ErrorState
          title="Signing in did not finish."
          description={
            link.retryable
              ? "Try again. If it keeps failing, ask for a new link below."
              : "Open the link from your email again, or ask for a new link below."
          }
          action={retry}
        />
      );
  }
}

const GOOGLE_FAILURES: Partial<Record<SignInFailure, string>> = {
  "popup-blocked": "Your browser blocked the Google window. Allow pop-up windows for this site and try again.",
  network: UNREACHABLE_MESSAGE,
  "account-disabled": `This account has been disabled. ${DISABLED_MESSAGE}`,
};

/** Rendered only in builds that contain Google sign-in. */
function GoogleSignIn() {
  const { signInWithGoogle } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);

  const start = async () => {
    setFailure(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      const reason = error instanceof SignInError ? error.reason : "unknown";
      // Closing the window is a decision, not a fault.
      if (reason !== "cancelled") setFailure(GOOGLE_FAILURES[reason] ?? "Google sign-in did not finish. Try again.");
    }
  };

  return (
    <div className="grid gap-3 border-t border-border pt-5">
      {failure ? <ErrorState title="You are not signed in." description={failure} /> : null}
      <Button onClick={start}>Continue with Google</Button>
    </div>
  );
}

export function LoginPage() {
  const { session, link, forgetLinkRequest } = useAuth();
  const [parameters] = useSearchParams();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cameBack, setCameBack] = useState(false);
  const next = safeReturnPath(parameters.get("next"));

  if (session.status === "loading" || link.status === "completing") {
    return <LoadingState label="Signing you in" size="page" />;
  }
  if (session.status === "signed-in") return <Navigate to={next} replace />;

  if (link.status === "needs-email") {
    return (
      <Frame title="Confirm your email address">
        <ConfirmEmailForm />
      </Frame>
    );
  }

  return (
    <Frame title="Sign in to the members' portal">
      {sentTo !== null ? (
        <LinkSent
          email={sentTo}
          onReset={() => {
            // The address that was typed is not kept once the person turns away from it.
            forgetLinkRequest();
            setSentTo(null);
            setCameBack(true);
          }}
        />
      ) : (
        <>
          {link.status === "failed" ? <LinkFailure link={link} /> : null}
          <p className="text-fg-secondary">
            Enter your email address and we will send you a link that signs you in. There is no password to remember.
          </p>
          <RequestLinkForm next={next} onSent={setSentTo} takeFocus={cameBack} />
        </>
      )}
      {googleSignInAvailable && sentTo === null ? <GoogleSignIn /> : null}
    </Frame>
  );
}
