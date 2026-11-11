// The equipment of a laboratory: each current configuration and the history of every chain.
// A configuration changes only through `saveEquipmentConfiguration`, which closes the current one
// and opens its successor in one transaction, so a closed configuration is shown as it was.
import {
  type EquipmentConfigurationInput,
  equipmentConfigurationInputSchema,
  saveEquipmentConfigurationContract,
} from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { Section } from "@/pages/replications/tabs/OverviewTab";

type Configuration = RecordOf<"laboratoryEquipment">;

const TEXT_FIELDS = [
  ["amplifierManufacturer", "Amplifier manufacturer"],
  ["amplifierModel", "Amplifier model"],
  ["capType", "Cap"],
  ["electrodeType", "Electrode type"],
  ["referenceScheme", "Reference scheme"],
  ["triggerMethod", "Trigger method"],
  ["presentationSoftware", "Presentation software"],
  ["stimulusComputer", "Stimulus computer"],
  ["eyeTracker", "Eye tracker"],
] as const;

type TextField = (typeof TEXT_FIELDS)[number][0];

/** The configurations of a laboratory as chains, each from its latest configuration back to its first. */
export function equipmentChains(configurations: readonly Configuration[]): Configuration[][] {
  const live = configurations.filter((configuration) => configuration.archivedAt === null);
  const byId = new Map(live.map((configuration) => [configuration.id, configuration]));
  const superseded = new Set(
    live.flatMap((configuration) => (configuration.supersedesId === null ? [] : [configuration.supersedesId])),
  );
  const heads = live.filter((configuration) => !superseded.has(configuration.id));
  return heads
    .map((head) => {
      const chain: Configuration[] = [];
      let next: Configuration | undefined = head;
      while (next !== undefined && !chain.includes(next)) {
        chain.push(next);
        next = next.supersedesId === null ? undefined : byId.get(next.supersedesId);
      }
      return chain;
    })
    .sort(
      (a, b) =>
        Number(b[0]?.isCurrent ?? false) - Number(a[0]?.isCurrent ?? false) ||
        (a[0]?.name ?? "").localeCompare(b[0]?.name ?? "", "en"),
    );
}

const list = (values: readonly (string | number)[] | undefined, unit = "") =>
  values === undefined || values.length === 0 ? <Unknown /> : values.map((value) => `${value}${unit}`).join(", ");

function ConfigurationDetails({ configuration }: { configuration: Configuration }) {
  return (
    <Details>
      {configuration.eegSystemSource === undefined ? null : (
        <Detail term="EEG system, as the source wrote it">{configuration.eegSystemSource}</Detail>
      )}
      {TEXT_FIELDS.map(([field, label]) => (
        <Detail key={field} term={label}>
          {configuration[field] ?? <Unknown />}
        </Detail>
      ))}
      <Detail term="EEG channels">{configuration.channelCount ?? <Unknown />}</Detail>
      <Detail term="Sampling rates">{list(configuration.samplingRatesHz, " Hz")}</Detail>
      <Detail term="Display refresh rate">
        {configuration.displayRefreshHz === undefined ? <Unknown /> : `${configuration.displayRefreshHz} Hz`}
      </Detail>
      <Detail term="Response devices">{list(configuration.responseDevices)}</Detail>
      <Detail term="Notes">{configuration.notes ?? <Unknown>None</Unknown>}</Detail>
    </Details>
  );
}

interface Draft {
  name: string;
  texts: Record<TextField, string>;
  channelCount: string;
  samplingRatesHz: string;
  displayRefreshHz: string;
  responseDevices: string;
  notes: string;
}

function draftOf(configuration: Configuration | null): Draft {
  return {
    name: configuration?.name ?? "",
    texts: Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, configuration?.[field] ?? ""])) as Record<
      TextField,
      string
    >,
    channelCount: configuration?.channelCount?.toString() ?? "",
    samplingRatesHz: configuration?.samplingRatesHz?.join(", ") ?? "",
    displayRefreshHz: configuration?.displayRefreshHz?.toString() ?? "",
    responseDevices: configuration?.responseDevices?.join(", ") ?? "",
    notes: configuration?.notes ?? "",
  };
}

const parts = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

/** The input of the contract from the form, or the message of what does not fit. */
export function equipmentInputOf(draft: Draft): EquipmentConfigurationInput | string {
  const number = (text: string) => (text.trim() === "" ? undefined : Number(text.trim()));
  const rates = parts(draft.samplingRatesHz).map(Number);
  const devices = parts(draft.responseDevices);
  const candidate = {
    name: draft.name.trim(),
    ...Object.fromEntries(
      TEXT_FIELDS.flatMap(([field]) => (draft.texts[field].trim() === "" ? [] : [[field, draft.texts[field].trim()]])),
    ),
    ...(number(draft.channelCount) === undefined ? {} : { channelCount: number(draft.channelCount) }),
    ...(rates.length === 0 ? {} : { samplingRatesHz: rates }),
    ...(number(draft.displayRefreshHz) === undefined ? {} : { displayRefreshHz: number(draft.displayRefreshHz) }),
    ...(devices.length === 0 ? {} : { responseDevices: devices }),
    ...(draft.notes.trim() === "" ? {} : { notes: draft.notes.trim() }),
  };
  const parsed = equipmentConfigurationInputSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const field = String(parsed.error.issues[0]?.path[0] ?? "");
  if (field === "name") return "Give the configuration a name, such as the room it is in.";
  if (field === "channelCount") return "Enter the number of EEG channels as a whole number from 1 to 4,096.";
  if (field === "samplingRatesHz") return "Enter the sampling rates as whole numbers in hertz, separated by commas.";
  if (field === "displayRefreshHz") return "Enter the refresh rate of the display in hertz.";
  return "Check the values and try again.";
}

export function EquipmentDialog({
  laboratoryId,
  laboratoryName,
  replacing,
}: {
  laboratoryId: string;
  laboratoryName: string;
  /** The current configuration that the save replaces, or null to open a new configuration. */
  replacing: Configuration | null;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(replacing));
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = equipmentInputOf(draft);
    if (typeof input === "string") {
      setError(input);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const saved = await callFunction(saveEquipmentConfigurationContract, {
        laboratoryId,
        replacesConfigurationId: replacing?.id ?? null,
        configuration: input,
      });
      setOpen(false);
      toast.show({
        title: saved.changed ? "The equipment has been saved." : "Nothing had changed, so nothing was saved.",
        ...(saved.supersededId === null ? {} : { description: "The earlier configuration is kept in the history." }),
      });
    } catch (failed) {
      setFailure(failed instanceof CallableError ? failed.message : "The equipment could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const title = replacing === null ? `Add a configuration to ${laboratoryName}` : `Edit ${replacing.name}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(draftOf(replacing));
          setError(null);
          setFailure(null);
        }
      }}
    >
      <DialogTrigger asChild>
        {replacing === null ? (
          <Button size="sm">Add a configuration</Button>
        ) : (
          <Button size="sm" aria-label={`Edit the configuration ${replacing.name}`}>
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={title}
        description={
          replacing === null
            ? "A laboratory can hold several configurations, for example one for each recording room. Leave out what you do not know."
            : "Saving keeps the present configuration in the history and makes your version the current one. Leave out what you do not know."
        }
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-3" data-testid="equipment-form">
          {failure === null ? null : <ErrorState title="Nothing was saved." description={failure} />}
          {error === null ? null : (
            <p role="alert" className="text-fg-accent">
              {error}
            </p>
          )}
          <FormField label="Name of the configuration">
            {(control) => (
              <Input
                {...control}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            )}
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map(([field, label]) => (
              <FormField key={field} label={label}>
                {(control) => (
                  <Input
                    {...control}
                    value={draft.texts[field]}
                    onChange={(event) => setDraft({ ...draft, texts: { ...draft.texts, [field]: event.target.value } })}
                  />
                )}
              </FormField>
            ))}
            <FormField label="EEG channels">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  value={draft.channelCount}
                  onChange={(event) => setDraft({ ...draft, channelCount: event.target.value })}
                />
              )}
            </FormField>
            <FormField label="Sampling rates in hertz" hint="Separated by commas, for example 500, 1000.">
              {(control) => (
                <Input
                  {...control}
                  value={draft.samplingRatesHz}
                  onChange={(event) => setDraft({ ...draft, samplingRatesHz: event.target.value })}
                />
              )}
            </FormField>
            <FormField label="Display refresh rate in hertz">
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={draft.displayRefreshHz}
                  onChange={(event) => setDraft({ ...draft, displayRefreshHz: event.target.value })}
                />
              )}
            </FormField>
            <FormField label="Response devices" hint="Separated by commas.">
              {(control) => (
                <Input
                  {...control}
                  value={draft.responseDevices}
                  onChange={(event) => setDraft({ ...draft, responseDevices: event.target.value })}
                />
              )}
            </FormField>
          </div>
          <FormField label="Notes">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Save the configuration
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EquipmentTab({
  laboratoryId,
  laboratoryName,
  configurations,
  canEdit,
}: {
  laboratoryId: string;
  laboratoryName: string;
  configurations: readonly Configuration[];
  canEdit: boolean;
}) {
  const chains = equipmentChains(configurations);
  return (
    <div className="grid gap-4">
      {canEdit ? (
        <div>
          <EquipmentDialog laboratoryId={laboratoryId} laboratoryName={laboratoryName} replacing={null} />
        </div>
      ) : null}
      {chains.length === 0 ? (
        <p className="text-fg-secondary">
          No equipment is recorded for this laboratory, so its compatibility with each replication is unknown.
        </p>
      ) : null}
      {chains.map((chain) => {
        const [latest, ...earlier] = chain;
        if (latest === undefined) return null;
        return (
          <Section
            key={latest.id}
            title={latest.name}
            testId="equipment-configuration"
            aside={
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={latest.isCurrent ? "neutral" : "outline"}>{latest.isCurrent ? "Current" : "Closed"}</Badge>
                {canEdit && latest.isCurrent ? (
                  <EquipmentDialog laboratoryId={laboratoryId} laboratoryName={laboratoryName} replacing={latest} />
                ) : null}
              </span>
            }
          >
            <p className="text-xs text-fg-muted">
              In use from {formatDateTime(latest.validFrom.toDate())}
              {latest.validTo === null ? "" : ` to ${formatDateTime(latest.validTo.toDate())}`}
            </p>
            <ConfigurationDetails configuration={latest} />
            {earlier.length === 0 ? null : (
              <details className="rounded-control border border-border p-2" data-testid="equipment-history">
                <summary className="cursor-pointer text-fg-secondary">
                  Earlier versions of this configuration ({earlier.length})
                </summary>
                <ol className="mt-2 grid gap-3">
                  {earlier.map((configuration) => (
                    <li key={configuration.id} className="grid gap-1 border-t border-border pt-2">
                      <p className="font-medium text-fg-strong">
                        {configuration.name}, from {formatDateTime(configuration.validFrom.toDate())}
                        {configuration.validTo === null ? "" : ` to ${formatDateTime(configuration.validTo.toDate())}`}
                      </p>
                      <ConfigurationDetails configuration={configuration} />
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </Section>
        );
      })}
    </div>
  );
}
