import { z } from "@eegml/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import logo from "@/assets/logo.png";
import { useAuth } from "@/auth/AuthProvider";
import { safeReturnPath } from "@/auth/return-path";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { googleSignInAvailable, SignInError, type SignInFailure } from "@/data";

const emailSchema = z.email();
const EMAIL_FORMAT_MESSAGE = "Enter a full email address, for example name@example.org.";

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-form content-center gap-6 px-4 py-10">
      <img src={logo} alt="EEGManyLabs" width={1600} height={355} className="h-9 w-auto" />
      <h1 className="font-serif text-display text-fg">{title}</h1>
      {children}
    </main>
  );
}

/** Step 1: ask for a sign-in link. */
function RequestLinkForm({ next, onSent }: { next: string; onSent: () => void }) {
  const { sendLink } = useAuth();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = emailSchema.safeParse(email.trim());
    if (!address.success) {
      setFieldError(EMAIL_FORMAT_MESSAGE);
      return;
    }
    setFieldError(null);
    setUnreachable(false);
    setBusy(true);
    try {
      await sendLink(address.data, next);
      onSent();
    } catch (error) {
      // Only a failure that has nothing to do with the address is reported. For everything
      // else the visitor sees the same confirmation, so the form reveals nothing about who
      // has an account.
      if (error instanceof SignInError && error.reason === "network") setUnreachable(true);
      else onSent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      {unreachable ? (
        <ErrorState
          title="The link could not be requested."
          description="The portal could not reach the sign-in service. Check your connection and try again."
        />
      ) : null}
      <FormField label="Email address" error={fieldError}>
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Email me a sign-in link
      </Button>
    </form>
  );
}

/** Step 2: the same confirmation for every address. */
function LinkSent({ onReset }: { onReset: () => void }) {
  return (
    <div role="status" className="grid gap-3 rounded-card border border-border bg-surface p-5">
      <h2 className="text-lg font-medium text-fg-strong">Check your email</h2>
      <p className="text-fg-secondary">
        If the address you entered can receive email, a sign-in link is on its way. Open the link on this device to
        finish signing in. The link works once.
      </p>
      <div>
        <Button onClick={onReset}>Use a different address</Button>
      </div>
    </div>
  );
}

/** The link was opened in a browser that did not ask for it, so the address is needed again. */
function ConfirmEmailForm() {
  const { confirmLinkEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = emailSchema.safeParse(email.trim());
    if (!address.success) {
      setFieldError(EMAIL_FORMAT_MESSAGE);
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await confirmLinkEmail(address.data);
    } catch (error) {
      if (error instanceof SignInError && error.reason === "email-mismatch") {
        setFieldError("That is not the address this link was sent to. Check it and try again.");
      }
      // Any other failure changes the link state, and the page shows the request form again.
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
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" variant="primary" disabled={busy}>
        Finish signing in
      </Button>
    </form>
  );
}

const GOOGLE_FAILURES: Partial<Record<SignInFailure, string>> = {
  "popup-blocked": "Your browser blocked the Google window. Allow pop-up windows for this site and try again.",
  network: "The portal could not reach the sign-in service. Check your connection and try again.",
  "account-disabled": "This account has been disabled. Contact a programme administrator.",
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
  const { session, link } = useAuth();
  const [parameters] = useSearchParams();
  const [sent, setSent] = useState(false);
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
      {sent ? (
        <LinkSent onReset={() => setSent(false)} />
      ) : (
        <>
          {link.status === "failed" ? (
            <ErrorState
              title="That sign-in link no longer works."
              description="A link expires after a while and works once. Ask for a new one below."
            />
          ) : null}
          <p className="text-fg-secondary">
            Enter your email address and we will send you a link that signs you in. There is no password to remember.
          </p>
          <RequestLinkForm next={next} onSent={() => setSent(true)} />
        </>
      )}
      {googleSignInAvailable && !sent ? <GoogleSignIn /> : null}
    </Frame>
  );
}
