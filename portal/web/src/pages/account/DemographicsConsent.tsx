// Consent to the portal holding the member's gender and ethnicity (shared/src/governance/
// demographics-consent.ts). The programme decided on 13 November 2026 that these values are held
// only with explicit consent. Here a member reads what is held, who can see it and how to
// withdraw; gives, reviews and withdraws consent; and, while consent is in force, enters their
// values in their own words or confirms the terms recorded for them. The record of consent is
// read live; the values come only from the audited function, and every change goes through a
// callable function, which decides what is allowed.
import {
  type ConsentWording,
  CURRENT_DEMOGRAPHICS_CONSENT,
  consentWording,
  getPersonDemographicsContract,
  OWN_WORDS_MAX,
  type PersonDemographics,
  saveOwnDemographicsContract,
  setDemographicsConsentContract,
} from "@eegml/shared";
import { type FormEvent, useId, useState } from "react";
import { formatDate, formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  CallableError,
  callFunction,
  type RecordOf,
  retryFailedLiveData,
  useCallResult,
  useLiveDocument,
} from "@/data";

type ConsentRecord = RecordOf<"personDemographicsConsent">;

const inForce = (record: ConsentRecord | null): boolean => record?.status === "given" && record.withdrawnAt === null;

const failureOf = (error: unknown, fallback: string): string =>
  error instanceof CallableError ? error.message : fallback;

function Wording({ wording }: { wording: ConsentWording }) {
  return (
    <div className="grid gap-3" data-testid="consent-wording">
      {wording.sections.map((section) => (
        <div key={section.heading} className="grid gap-1">
          <h3 className="text-md font-medium text-fg-strong">{section.heading}</h3>
          <p className="text-fg-secondary">{section.text}</p>
        </div>
      ))}
      <p className="text-xs text-fg-muted">
        Wording of {formatDate(`${wording.publishedOn}T12:00:00Z`)}, version {wording.version}.
      </p>
    </div>
  );
}

function History({ record }: { record: ConsentRecord }) {
  return (
    <div className="grid gap-1 border-t border-border pt-3">
      <h3 className="text-md font-medium text-fg-strong">What you have recorded</h3>
      <ol className="grid gap-1 text-sm" data-testid="consent-history">
        {[...record.history].reverse().map((event) => (
          <li key={`${event.status} ${event.at.toMillis()}`}>
            {event.status === "given" ? "Consent given" : "Consent withdrawn"} on {formatDateTime(event.at.toDate())},
            wording of {formatDate(`${consentWording(event.wordingVersion).publishedOn}T12:00:00Z`)}, version{" "}
            {event.wordingVersion}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Giving consent: an unticked statement, which the member ticks before the button acts. */
function GiveConsent({ withdrawnBefore }: { withdrawnBefore: boolean }) {
  const toast = useToast();
  const statementId = useId();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!agreed) return;
    setBusy(true);
    setFailure(null);
    callFunction(setDemographicsConsentContract, {
      status: "given",
      wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
    })
      .then(() => toast.show({ tone: "neutral", title: "Your consent is recorded." }))
      .catch((error: unknown) => setFailure(failureOf(error, "Your consent was not recorded. Try again.")))
      .finally(() => setBusy(false));
  };
  return (
    <form className="grid gap-3" onSubmit={submit} noValidate aria-label="Give consent">
      <p className="text-fg-secondary">
        {withdrawnBefore
          ? "You have withdrawn your consent, and nothing about your gender or ethnicity is held. You can give it again."
          : "You have not given consent, and nothing about your gender or ethnicity is held."}
      </p>
      <label htmlFor={statementId} className="flex items-start gap-2">
        <input
          id={statementId}
          type="checkbox"
          className="mt-1"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        <span>{CURRENT_DEMOGRAPHICS_CONSENT.statement}</span>
      </label>
      {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
      <div>
        <Button type="submit" variant="primary" disabled={!agreed || busy}>
          {busy ? "Recording…" : "Give consent"}
        </Button>
      </div>
    </form>
  );
}

/** The values, read from the audited function on request, and the form for the member's own words. */
function OwnValues({ personId }: { personId: string }) {
  const toast = useToast();
  const { live, reload } = useCallResult(getPersonDemographicsContract, { personId }, `own-demographics:${personId}`);
  return (
    <div className="grid gap-3 border-t border-border pt-3" data-testid="own-demographics">
      <h3 className="text-md font-medium text-fg-strong">Your values</h3>
      <LiveView
        live={live}
        loadingLabel="Loading your values"
        errorTitle="Your values could not be loaded."
        onRetry={reload}
        fromCallable
      >
        {(data) => (
          <OwnValuesForm
            // A save changes one of these, which resets the form, the box that confirms the terms included.
            key={[
              data.demographics?.recordedAt ?? "none",
              data.demographics?.confirmedAt ?? "",
              data.demographics?.genderSelfDescribed ?? "",
              data.demographics?.ethnicitySelfDescribed ?? "",
            ].join("|")}
            demographics={data.demographics}
            onSaved={(held) => {
              toast.show({ tone: "neutral", title: held ? "Your values are saved." : "Your values are removed." });
              reload();
            }}
          />
        )}
      </LiveView>
    </div>
  );
}

function OwnValuesForm({
  demographics,
  onSaved,
}: {
  demographics: PersonDemographics | null;
  onSaved: (held: boolean) => void;
}) {
  const [gender, setGender] = useState(demographics?.genderSelfDescribed ?? "");
  const [ethnicity, setEthnicity] = useState(demographics?.ethnicitySelfDescribed ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const confirmId = useId();
  const recorded = [
    ["Gender, as recorded", demographics?.genderSource],
    ["Ethnicity, as recorded", demographics?.ethnicitySource],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined);
  // Terms confirmed since they were last recorded need no second confirmation, so the box is offered only until then.
  const confirmedSinceRecorded =
    demographics?.confirmedAt !== undefined && demographics.confirmedAt >= demographics.recordedAt;
  const tooLong = (text: string) =>
    text.trim().length > OWN_WORDS_MAX ? `At most ${OWN_WORDS_MAX} characters.` : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (tooLong(gender) !== null || tooLong(ethnicity) !== null) return;
    setBusy(true);
    setFailure(null);
    callFunction(saveOwnDemographicsContract, {
      genderSelfDescribed: gender.trim() === "" ? null : gender.trim(),
      ethnicitySelfDescribed: ethnicity.trim() === "" ? null : ethnicity.trim(),
      confirmRecorded: confirm,
    })
      .then((result) => onSaved(result.held))
      .catch((error: unknown) => setFailure(failureOf(error, "Your values were not saved. Try again.")))
      .finally(() => setBusy(false));
  };
  return (
    <form className="grid gap-3" onSubmit={submit} noValidate aria-label="Your values">
      {recorded.length === 0 ? (
        <p className="text-fg-secondary">
          No recorded term is held for you now. If the programme's membership workbook records terms for you, the next
          import adds them while your consent is in force.
        </p>
      ) : (
        <div className="grid gap-2">
          <dl className="grid gap-1" data-testid="recorded-terms">
            {recorded.map(([term, value]) => (
              <div key={term} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-fg-muted">{term}</dt>
                <dd className="min-w-0 break-words text-fg">{value}</dd>
              </div>
            ))}
          </dl>
          {demographics?.confirmedAt === undefined ? null : (
            <p className="text-sm text-fg-muted">
              You confirmed these terms on {formatDate(demographics.confirmedAt)}.
            </p>
          )}
          {confirmedSinceRecorded ? null : (
            <label htmlFor={confirmId} className="flex items-start gap-2">
              <input
                id={confirmId}
                type="checkbox"
                className="mt-1"
                checked={confirm}
                onChange={(event) => setConfirm(event.target.checked)}
              />
              <span>These recorded terms describe me</span>
            </label>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Your gender, in your own words"
          hint="Optional. Leave empty to hold nothing here."
          error={tooLong(gender)}
        >
          {(control) => <Input {...control} value={gender} onChange={(event) => setGender(event.target.value)} />}
        </FormField>
        <FormField
          label="Your ethnicity, in your own words"
          hint="Optional. Leave empty to hold nothing here."
          error={tooLong(ethnicity)}
        >
          {(control) => <Input {...control} value={ethnicity} onChange={(event) => setEthnicity(event.target.value)} />}
        </FormField>
      </div>
      {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save your values"}
        </Button>
      </div>
    </form>
  );
}

function WithdrawConsent({ version }: { version: ConsentRecord["wordingVersion"] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const withdraw = () => {
    setBusy(true);
    setFailure(null);
    callFunction(setDemographicsConsentContract, { status: "withdrawn", wordingVersion: version })
      .then(() => {
        setOpen(false);
        toast.show({ tone: "neutral", title: "Your consent is withdrawn and your values are deleted." });
      })
      .catch((error: unknown) => setFailure(failureOf(error, "Your consent was not withdrawn. Try again.")))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Withdraw consent</Button>
      </DialogTrigger>
      <DialogContent
        title="Withdraw your consent?"
        description="Your gender and ethnicity are deleted at once, including what an import recorded, and they leave every count the next time it is computed. You can give consent again later."
      >
        {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={withdraw}>
            {busy ? "Withdrawing…" : "Withdraw and delete"}
          </Button>
          <DialogClose asChild>
            <Button>Keep my consent</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConsentBody({ personId, record }: { personId: string; record: ConsentRecord | null }) {
  const given = inForce(record);
  const shown = given && record !== null ? consentWording(record.wordingVersion) : CURRENT_DEMOGRAPHICS_CONSENT;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-testid="consent-status">
        {given && record?.givenAt ? (
          <>
            <Badge tone="accent">Consent given</Badge>
            <span className="text-sm text-fg-secondary">on {formatDateTime(record.givenAt.toDate())}</span>
          </>
        ) : (
          <Badge tone="neutral">No consent</Badge>
        )}
      </div>
      <Wording wording={shown} />
      {given && record !== null ? (
        <>
          <OwnValues personId={personId} />
          <div className="grid gap-2 border-t border-border pt-3">
            <p className="text-fg-secondary">
              You can withdraw your consent at any time. Your values are deleted at once.
            </p>
            <div>
              <WithdrawConsent version={record.wordingVersion} />
            </div>
          </div>
        </>
      ) : (
        <GiveConsent withdrawnBefore={record !== null} />
      )}
      {record === null ? null : <History record={record} />}
    </>
  );
}

/** The panel on the account page. Shown to a member whose account is linked to their profile. */
export function DemographicsConsent({ personId }: { personId: string }) {
  const record = useLiveDocument("personDemographicsConsent", [personId]);
  return (
    <section
      aria-labelledby="demographics-consent-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="demographics-consent"
    >
      <h2 id="demographics-consent-heading" className="text-lg font-medium tracking-title text-fg-strong">
        {CURRENT_DEMOGRAPHICS_CONSENT.title}
      </h2>
      <LiveView
        live={record}
        loadingLabel="Loading your consent"
        errorTitle="Your consent could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(data) => <ConsentBody personId={personId} record={data} />}
      </LiveView>
    </section>
  );
}
