import { type FormEvent, useState } from "react";
import { config } from "@/app/config";
import { formatDate } from "@/app/labels";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorState } from "@/components/feedback/error-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  type EnrolledFactor,
  normaliseCode,
  SECOND_FACTOR_MESSAGES,
  type SecondFactorApi,
  SecondFactorError,
  SUPPORTED_FACTOR_IDS,
  secondFactor,
  type TotpEnrolment,
} from "@/data";
import { TotpQrCode } from "./TotpQrCode";

const messageOf = (error: unknown) =>
  SECOND_FACTOR_MESSAGES[error instanceof SecondFactorError ? error.reason : "unknown"];

const FACTOR_LABELS: Readonly<Record<string, string>> = { totp: "Authenticator app", phone: "Text message" };

/** The secret in groups of four, which is easier to type into an app. */
export const groupedSecret = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

interface EnrolProps {
  enrolment: TotpEnrolment;
  onDone: () => void;
  onCancel: () => void;
}

/** The second step of an enrolment: the secret as a QR code and as text, and the first code. */
function ConfirmEnrolment({ enrolment, onDone, onCancel }: EnrolProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("Authenticator app");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const digits = normaliseCode(code, enrolment.codeLength);
    if (digits === null) {
      setError(`Enter the ${enrolment.codeLength} digits your authenticator app shows.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await enrolment.complete(digits, name.trim() === "" ? "Authenticator app" : name.trim());
      onDone();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4" aria-label="Add an authenticator app">
      <ol className="grid list-decimal gap-2 pl-5 text-fg-secondary">
        <li>Open an authenticator app on your phone and add an account.</li>
        <li>Scan the QR code, or type the key shown under it.</li>
        <li>Enter the code the app shows for the portal.</li>
      </ol>
      <div className="flex flex-wrap items-start gap-5">
        <TotpQrCode value={enrolment.otpauthUrl} label="QR code that adds the portal to an authenticator app" />
        <div className="grid min-w-0 gap-1">
          <p className="text-fg-muted">Key to type instead</p>
          <code data-testid="totp-secret" className="font-medium break-all text-fg-strong">
            {groupedSecret(enrolment.secretKey)}
          </code>
        </div>
      </div>
      <FormField label="Code from the app" error={error}>
        {(control) => (
          <Input
            {...control}
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
      <FormField label="Name for this device" hint="Shown in your list of second factors.">
        {(control) => (
          <Input
            {...control}
            name="factorName"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Confirm and turn on
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function FactorRow({ factor, onRemove }: { factor: EnrolledFactor; onRemove: (factor: EnrolledFactor) => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <span className="grid">
        <span className="font-medium text-fg-strong">
          {factor.displayName ?? FACTOR_LABELS[factor.factorId] ?? "Second factor"}
        </span>
        <span className="text-fg-secondary">
          {FACTOR_LABELS[factor.factorId] ?? factor.factorId}
          {factor.enrolledAt === null ? null : <>, added {formatDate(factor.enrolledAt)}</>}
        </span>
      </span>
      <Button size="sm" onClick={() => onRemove(factor)} aria-label={`Remove ${factor.displayName ?? "this factor"}`}>
        Remove
      </Button>
    </li>
  );
}

export interface SecondFactorSectionProps {
  /** Labels the entry in the authenticator app: the signed-in address. */
  accountName: string;
  /** Whether the account's role requires a second factor. */
  required: boolean;
  /** The multi-factor API. The Firebase implementation, unless a test gives a fake. */
  api?: SecondFactorApi;
}

/** Whether this build runs against the local emulators, whose Authentication cannot enrol an app. */
const emulated = config.emulators !== null;

const EMULATOR_ENROLMENT_MESSAGE =
  "This copy of the portal runs on the local emulators, which cannot enrol an authenticator app. Adding one works on the staging and live portals.";

/**
 * The second factors of the signed-in account: the list, the enrolment of an authenticator app
 * and the removal of a factor. Each change asks the server to start the session again, so that
 * the access document and the security rules see it.
 */
export function SecondFactorSection({ accountName, required, api = secondFactor }: SecondFactorSectionProps) {
  const { retryRegistration } = useAuth();
  const toast = useToast();
  const [factors, setFactors] = useState<readonly EnrolledFactor[]>(() => api.listFactors());
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<EnrolledFactor | null>(null);

  const refresh = () => {
    setFactors(api.listFactors());
    retryRegistration();
  };

  const start = async () => {
    setFailure(null);
    setBusy(true);
    try {
      setEnrolment(await api.startTotpEnrolment(accountName));
    } catch (error) {
      setFailure(
        emulated && !(error instanceof SecondFactorError && error.reason === "requires-recent-login")
          ? EMULATOR_ENROLMENT_MESSAGE
          : messageOf(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (removing === null) return;
    setBusy(true);
    setFailure(null);
    try {
      await api.removeFactor(removing.uid);
      toast.show({ title: "The second factor has been removed." });
      refresh();
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const supported = factors.filter((factor) => SUPPORTED_FACTOR_IDS.includes(factor.factorId));

  return (
    <section
      id="second-factor"
      aria-labelledby="second-factor-heading"
      className="grid scroll-mt-20 gap-3 rounded-card border border-border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="second-factor-heading" className="text-lg font-medium tracking-title text-fg-strong">
          Second factor
        </h2>
        {required ? <Badge tone="accent">Required for your role</Badge> : null}
      </div>
      <p className="text-fg-secondary">
        A second factor is a code from an authenticator app on your phone, which the portal asks for when you sign in.
        {required
          ? " Your role gives you administrative powers, and these work only while your account has one."
          : " It keeps your account safe even if someone gets into your email."}
      </p>
      {failure ? <ErrorState title="That did not work." description={failure} /> : null}
      {enrolment !== null ? (
        <ConfirmEnrolment
          enrolment={enrolment}
          onCancel={() => setEnrolment(null)}
          onDone={() => {
            setEnrolment(null);
            toast.show({
              title: "Your authenticator app is set up.",
              description: "The portal will ask for a code from it each time you sign in.",
            });
            refresh();
          }}
        />
      ) : (
        <>
          {factors.length === 0 ? (
            <EmptyState title="No second factor yet" description="Add an authenticator app to protect your account." />
          ) : (
            <ul aria-label="Your second factors" data-testid="second-factors">
              {factors.map((factor) => (
                <FactorRow key={factor.uid} factor={factor} onRemove={setRemoving} />
              ))}
            </ul>
          )}
          <div>
            <Button variant={supported.length === 0 ? "primary" : "outline"} disabled={busy} onClick={start}>
              Add an authenticator app
            </Button>
          </div>
        </>
      )}
      <Dialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        {removing === null ? null : (
          <DialogContent
            title="Remove this second factor?"
            description={
              required && factors.length === 1
                ? "This is your only second factor. Your administrative powers stop working until you add another one."
                : "You will no longer be asked for a code from it when you sign in."
            }
          >
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy} onClick={remove}>
                Remove
              </Button>
              <DialogClose asChild>
                <Button>Keep it</Button>
              </DialogClose>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
