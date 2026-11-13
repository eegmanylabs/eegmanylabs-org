// The notification preferences of the signed-in member (requirements R16.6 and R16.7):
// whether notifications also arrive by email, at once or gathered in a daily or weekly digest,
// the quiet hours in which no message is sent, and which kinds of notification are emailed at
// all. Notifications always appear in the portal. The member writes this document alone, under
// the security rules, and the functions read it to decide what goes to the mail outbox.
import { NOTIFICATION_EMAIL_TEXT, type NotificationType, notificationTypeSchema } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type PreferencesInput, type RecordOf, retryFailedLiveData, savePreferences, useLiveDocument } from "@/data";

const DEFAULTS: PreferencesInput = {
  channels: { inApp: true, email: false },
  digestFrequency: "off",
  quietHours: null,
  typeSwitches: {},
};

const ownTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";

/**
 * Whether email is delivered. No mail provider is chosen yet (decision 7 in docs/DECISIONS.md),
 * so the functions keep every message in the outbox and send nothing; in an emulator build the
 * outbox is served by the fake sender. The page says so beside the choices it keeps.
 */
const MAIL_DELIVERY_NOTE =
  import.meta.env.MODE === "emulator"
    ? "Email delivery is not connected: in this emulator build messages go to a fake outbox and are never sent. Your choices are kept."
    : "Email delivery is not connected yet: your choices are kept and take effect once it is.";

function PreferencesForm({ uid, stored }: { uid: string; stored: RecordOf<"userPreferences"> | null }) {
  const initial: PreferencesInput = stored ?? DEFAULTS;
  const [email, setEmail] = useState(initial.channels.email);
  const [frequency, setFrequency] = useState(initial.digestFrequency);
  const [quiet, setQuiet] = useState(initial.quietHours !== null);
  const [start, setStart] = useState(initial.quietHours?.start ?? "22:00");
  const [end, setEnd] = useState(initial.quietHours?.end ?? "07:00");
  const [switches, setSwitches] = useState<Readonly<Record<string, boolean>>>(initial.typeSwitches);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    setSaved(false);
    savePreferences(
      uid,
      {
        channels: { inApp: true, email },
        digestFrequency: email ? frequency : "off",
        quietHours: email && quiet ? { start, end, timeZone: initial.quietHours?.timeZone ?? ownTimeZone() } : null,
        typeSwitches: switches,
      },
      stored !== null,
    )
      .then(() => setSaved(true))
      .catch(() => setFailure("Your preferences were not saved. Try again."))
      .finally(() => setBusy(false));
  };
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate aria-label="Email and digests">
      <p className="text-sm text-fg-secondary">
        Notifications always appear in the portal. Here you choose whether they also reach you by email. A message
        carries a title, a short text and a link back to the portal, never restricted detail.
      </p>
      <p className="text-sm" data-testid="mail-delivery">
        {MAIL_DELIVERY_NOTE}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />
        Send notifications to me by email
      </label>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={!email}>
        <legend className="sr-only">How email reaches you</legend>
        <FormField label="How often">
          {(control) => (
            <Select
              {...control}
              value={frequency}
              onChange={(event) => setFrequency(event.target.value as PreferencesInput["digestFrequency"])}
            >
              <option value="off">One message for each notification</option>
              <option value="daily">A daily digest, each morning</option>
              <option value="weekly">A weekly digest, on Monday morning</option>
            </Select>
          )}
        </FormField>
        <div className="grid content-start gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={quiet} onChange={(event) => setQuiet(event.target.checked)} />
            Keep quiet hours
          </label>
          {quiet ? (
            <div className="grid grid-cols-2 gap-2">
              <FormField label="From">
                {(control) => (
                  <Input {...control} type="time" value={start} onChange={(event) => setStart(event.target.value)} />
                )}
              </FormField>
              <FormField label="Until">
                {(control) => (
                  <Input {...control} type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
                )}
              </FormField>
            </div>
          ) : null}
        </div>
      </fieldset>
      <fieldset className="grid gap-1 sm:grid-cols-2" disabled={!email}>
        <legend className="mb-1 text-sm font-medium text-fg-strong">Kinds of notification sent by email</legend>
        {notificationTypeSchema.options.map((type: NotificationType) => (
          <label key={type} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={switches[type] !== false}
              onChange={(event) => setSwitches((current) => ({ ...current, [type]: event.target.checked }))}
            />
            {NOTIFICATION_EMAIL_TEXT[type]}
          </label>
        ))}
      </fieldset>
      {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save preferences"}
        </Button>
        {saved ? (
          <p className="text-sm" role="status" data-testid="preferences-saved">
            Your preferences are saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** The panel of notification preferences on the account page. */
export function NotificationPreferences({ uid }: { uid: string }) {
  const stored = useLiveDocument("userPreferences", [uid]);
  return (
    <section
      aria-labelledby="preferences-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
    >
      <h2 id="preferences-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Email and digests
      </h2>
      <LiveView
        live={stored}
        loadingLabel="Loading your preferences"
        errorTitle="Your preferences could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(data) => <PreferencesForm uid={uid} stored={data} />}
      </LiveView>
    </section>
  );
}
