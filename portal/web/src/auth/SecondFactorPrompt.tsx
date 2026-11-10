import { ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "./AuthProvider";

export interface SecondFactorPromptProps {
  /** `enrol`: the account has no factor yet. `sign-in`: it has one, and this session did not present it. */
  kind: "enrol" | "sign-in";
}

/**
 * Stands in for a page that needs the powers of a programme role while the second factor is
 * missing. The security rules and the functions refuse such a session in any case.
 */
export function SecondFactorPrompt({ kind }: SecondFactorPromptProps) {
  const { signOut } = useAuth();
  const toast = useToast();
  return (
    <section
      aria-labelledby="second-factor-prompt-heading"
      className="grid max-w-reading gap-3 rounded-card border border-border bg-surface p-5"
    >
      <h2 id="second-factor-prompt-heading" className="flex items-center gap-2 text-lg font-medium text-fg-strong">
        <ShieldCheck aria-hidden="true" className="size-5 text-fg-accent" strokeWidth={1.8} />
        {kind === "enrol" ? "Set up a second factor to continue" : "Sign in again with your second factor"}
      </h2>
      {kind === "enrol" ? (
        <p className="text-fg-secondary">
          Your role gives you administrative powers, and these stay switched off until your account has a second factor.
          Add an authenticator app on the Account and security page, then come back here.
        </p>
      ) : (
        <p className="text-fg-secondary">
          Your account has a second factor, and this session began without it. Sign out and sign in again, and enter the
          code from your authenticator app when the portal asks for it.
        </p>
      )}
      <div>
        {kind === "enrol" ? (
          <Button asChild variant="primary">
            <Link to="/account#second-factor">Set up a second factor</Link>
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() =>
              void signOut().catch(() =>
                toast.show({
                  tone: "error",
                  title: "You are still signed in.",
                  description: "Signing out failed. Try again.",
                }),
              )
            }
          >
            Sign out and sign in again
          </Button>
        )}
      </div>
    </section>
  );
}
