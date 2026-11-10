import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  normaliseCode,
  SECOND_FACTOR_MESSAGES,
  type SecondFactorChallenge,
  SecondFactorError,
  SUPPORTED_FACTOR_IDS,
} from "@/data";

/** The second step of a sign-in for an account with a second factor: the code from its authenticator app. */
export function SecondFactorChallengeForm({ challenge }: { challenge: SecondFactorChallenge }) {
  const { answerSecondFactor, abandonLink } = useAuth();
  const factors = challenge.factors.filter((factor) => SUPPORTED_FACTOR_IDS.includes(factor.factorId));
  const [factorUid, setFactorUid] = useState(factors[0]?.uid ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  if (factors.length === 0) {
    return (
      <div className="grid gap-4">
        <ErrorState
          title="This account's second factor cannot be used here."
          description="The portal accepts codes from an authenticator app only. Contact a programme administrator to have your second factor reset."
        />
        <div>
          <Button onClick={abandonLink}>Use a different address</Button>
        </div>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const digits = normaliseCode(code);
    if (digits === null) {
      setError("Enter the 6 digits your authenticator app shows.");
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await answerSecondFactor(factorUid, digits);
    } catch (failure) {
      setError(SECOND_FACTOR_MESSAGES[failure instanceof SecondFactorError ? failure.reason : "unknown"]);
      field.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <p className="text-fg-secondary">
        Your account has a second factor. Open your authenticator app and enter the code it shows for the portal.
      </p>
      {factors.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-fg-strong">Which app</legend>
          {factors.map((factor) => (
            <label key={factor.uid} className="flex cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
              <input
                type="radio"
                name="factor"
                value={factor.uid}
                checked={factorUid === factor.uid}
                onChange={() => setFactorUid(factor.uid)}
              />
              {factor.displayName ?? "Authenticator app"}
            </label>
          ))}
        </fieldset>
      ) : null}
      <FormField label="Code from your authenticator app" error={error}>
        {(control) => (
          <Input
            {...control}
            ref={field}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Verify and sign in
        </Button>
        <Button onClick={abandonLink}>Start again</Button>
      </div>
    </form>
  );
}
