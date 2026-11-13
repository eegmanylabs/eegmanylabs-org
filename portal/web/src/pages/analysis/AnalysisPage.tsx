// Analysis views (requirement R15.10): geographic, equipment, participation and scientific
// progress from the directory documents every member reads, and demographic analysis for those
// who hold a named grant. Demographic counts come only from the audited demographics function,
// which checks the grant and the second factor, records the read, and suppresses every group of
// fewer than five people (and a second group where one alone would let it be worked out). A count
// of people in the other views is suppressed the same way. Nothing special-category is shown or
// exported without that grant, and an export holds the suppressed cells as they are shown.
import {
  type CallableOutput,
  DEMOGRAPHIC_AGGREGATE_FIELDS,
  type ExportTable,
  getDemographicAggregatesContract,
  PROGRAMME_KEY,
  SMALL_CELL_THRESHOLD,
  SUPPRESSED_TEXT,
  suppressSmallCells,
} from "@eegml/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { CallableError, callFunction, retryFailedLiveData, useLiveQuery } from "@/data";
import { combineLive } from "@/registry/combine";
import { countryName, MANUSCRIPT_STATUS_LABELS, PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import {
  ALL_LABORATORIES,
  ALL_MANUSCRIPTS,
  ALL_PARTICIPATIONS,
  ALL_PERSONS,
  ALL_REPLICATIONS,
  CURRENT_EQUIPMENT,
  REPLICATION_STATUS_DEFINITIONS,
} from "@/registry/queries";
import { useViewer } from "@/registry/viewer";
import { ExportMenu } from "@/views/ExportMenu";
import { originNoteOf } from "@/views/origins";

type Counts = Readonly<Record<string, number>>;

/** The label of a stored value, or the value itself where the map has none. */
const labelOf = (labels: Readonly<Record<string, string>>, key: string): string => labels[key] ?? key;

/** A country by its name where the key is an ISO code, and as written otherwise. */
const countryLabel = (key: string): string => (/^[A-Z]{2}$/.test(key) ? countryName(key) : key);

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item) ?? "Not stated";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * A breakdown as a table, with its export. Counts of people are suppressed below the threshold.
 * Its keys are stored values, shown through `label`, and the origin of the records behind it is
 * stated under it and in its export wherever any is not live.
 */
function Breakdown({
  title,
  counts,
  of,
  people = false,
  label = (key) => key,
  origins,
}: {
  readonly title: string;
  readonly counts: Counts;
  readonly of: string;
  readonly people?: boolean;
  readonly label?: (key: string) => string;
  /** The `dataOrigin` of each record counted. */
  readonly origins: readonly unknown[];
}) {
  const origin = originNoteOf(origins);
  const shown = people
    ? suppressSmallCells(counts)
    : {
        cells: Object.entries(counts)
          .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
          .map(([key, count]) => ({ key, value: { suppressed: false as const, count } })),
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        suppressedCells: 0,
      };
  const table = (): ExportTable => ({
    title,
    columns: [of, "Count"],
    rows: [
      ...shown.cells.map((cell) => [label(cell.key), cell.value.suppressed ? SUPPRESSED_TEXT : cell.value.count]),
      ...(origin === null ? [] : [[origin, null]]),
    ],
  });
  return (
    <section
      className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
      aria-label={title}
      data-testid="analysis-breakdown"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-md font-medium text-fg-strong">{title}</h3>
        <ExportMenu table={table} />
      </div>
      {shown.cells.length === 0 ? (
        <p className="text-sm text-fg-muted">Nothing to count yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption={title}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{of}</TableHeaderCell>
                <TableHeaderCell className="text-right">Count</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.cells.map((cell) => (
                <TableRow key={cell.key}>
                  <TableCell>{label(cell.key)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cell.value.suppressed ? SUPPRESSED_TEXT : cell.value.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-fg-muted">
        {shown.total === null ? `The total is withheld, since a group is suppressed.` : `Total ${shown.total}.`}
        {people ? ` Groups of fewer than ${SMALL_CELL_THRESHOLD} people are suppressed.` : ""}
      </p>
      {origin === null ? null : (
        <p className="text-xs text-fg-muted" data-testid="origin-note">
          {origin}
        </p>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-lg">{title}</h2>
      <div className="grid gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function DirectoryAnalysis() {
  const live = combineLive(
    [
      useLiveQuery(ALL_LABORATORIES),
      useLiveQuery(ALL_PERSONS),
      useLiveQuery(CURRENT_EQUIPMENT),
      useLiveQuery(ALL_PARTICIPATIONS),
      useLiveQuery(ALL_REPLICATIONS),
      useLiveQuery(REPLICATION_STATUS_DEFINITIONS),
      useLiveQuery(ALL_MANUSCRIPTS),
    ] as const,
    (laboratories, persons, equipment, participations, replications, statuses, manuscripts) => ({
      laboratories,
      persons,
      equipment,
      participations,
      replications,
      statuses,
      manuscripts,
    }),
  );
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the analysis"
      errorTitle="The analysis could not be computed."
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const laboratories = data.laboratories.filter((laboratory) => laboratory.archivedAt === null);
        const persons = data.persons.filter((person) => person.archivedAt === null);
        const participations = data.participations.filter((participation) => participation.archivedAt === null);
        const replications = data.replications.filter((replication) => replication.archivedAt === null);
        const manuscripts = data.manuscripts.filter((manuscript) => manuscript.archivedAt === null);
        // Equipment and outputs carry no origin of their own: theirs is that of their laboratory or replication.
        const laboratoryOrigin = new Map(data.laboratories.map((laboratory) => [laboratory.id, laboratory.dataOrigin]));
        const replicationOrigin = new Map(
          data.replications.map((replication) => [replication.id, replication.dataOrigin]),
        );
        const statusLabel = new Map(data.statuses.map((status) => [status.key, status.label]));
        return (
          <div className="grid gap-6">
            <Group title="Geography">
              <Breakdown
                title="Laboratories by country"
                of="Country"
                counts={countBy(laboratories, (laboratory) => laboratory.countryCode)}
                label={countryLabel}
                origins={laboratories.map((laboratory) => laboratory.dataOrigin)}
              />
              <Breakdown
                title="Members by country"
                of="Country"
                people
                counts={countBy(persons, (person) => person.countryCode ?? person.countrySource)}
                label={countryLabel}
                origins={persons.map((person) => person.dataOrigin)}
              />
            </Group>
            <Group title="Equipment">
              <Breakdown
                title="Current configurations by amplifier manufacturer"
                of="Manufacturer"
                counts={countBy(data.equipment, (configuration) => configuration.amplifierManufacturer)}
                origins={data.equipment.map((configuration) => laboratoryOrigin.get(configuration.laboratoryId))}
              />
              <Breakdown
                title="Current configurations by number of channels"
                of="Channels"
                counts={countBy(data.equipment, (configuration) =>
                  configuration.channelCount === undefined ? null : String(configuration.channelCount),
                )}
                origins={data.equipment.map((configuration) => laboratoryOrigin.get(configuration.laboratoryId))}
              />
            </Group>
            <Group title="Participation">
              <Breakdown
                title="Participations by status"
                of="Status"
                counts={countBy(participations, (participation) => participation.status)}
                label={(key) => labelOf(PARTICIPATION_STATUS_LABELS, key)}
                origins={participations.map((participation) => participation.dataOrigin)}
              />
              <Breakdown
                title="Participating laboratories by replication"
                of="Replication"
                counts={countBy(participations, (participation) => participation.replicationId)}
                origins={participations.map((participation) => participation.dataOrigin)}
              />
            </Group>
            <Group title="Scientific progress">
              <Breakdown
                title="Replications by status"
                of="Status"
                counts={countBy(replications, (replication) =>
                  replication.statusKey === null
                    ? null
                    : (statusLabel.get(replication.statusKey) ?? replication.statusKey),
                )}
                origins={replications.map((replication) => replication.dataOrigin)}
              />
              <Breakdown
                title="Outputs by status"
                of="Status"
                counts={countBy(manuscripts, (manuscript) => manuscript.status)}
                label={(key) => labelOf(MANUSCRIPT_STATUS_LABELS, key)}
                origins={manuscripts.map((manuscript) =>
                  manuscript.replicationId === undefined ? undefined : replicationOrigin.get(manuscript.replicationId),
                )}
              />
            </Group>
          </div>
        );
      }}
    </LiveView>
  );
}

type Aggregates = CallableOutput<typeof getDemographicAggregatesContract>;

const FIELD_LABELS: Readonly<Record<(typeof DEMOGRAPHIC_AGGREGATE_FIELDS)[number], string>> = {
  genderCategory: "Gender",
  ethnicityCategory: "Ethnicity",
};

function DemographicAnalysis() {
  const replications = useLiveQuery(ALL_REPLICATIONS);
  const [field, setField] = useState<(typeof DEMOGRAPHIC_AGGREGATE_FIELDS)[number]>("genderCategory");
  const [scope, setScope] = useState("");
  const [result, setResult] = useState<Aggregates | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    callFunction(getDemographicAggregatesContract, {
      field,
      scopeType: scope === "" ? "programme" : "replication",
      scopeId: scope === "" ? PROGRAMME_KEY : scope,
    })
      .then(setResult)
      .catch((error: unknown) => {
        setResult(null);
        setFailure(error instanceof CallableError ? error.message : "The counts could not be served.");
      })
      .finally(() => setBusy(false));
  };
  return (
    <section className="grid gap-3" aria-label="Demographics">
      <h2 className="text-lg">Demographics</h2>
      <p className="text-sm text-fg-secondary">
        Counts of a special-category field for the people of the programme or of one replication. They are served by the
        audited demographics function, which needs a named grant of the right and a second factor and records every
        read. Groups of fewer than {SMALL_CELL_THRESHOLD} people are suppressed.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <FormField label="Field">
          {(control) => (
            <Select {...control} value={field} onChange={(event) => setField(event.target.value as typeof field)}>
              {DEMOGRAPHIC_AGGREGATE_FIELDS.map((key) => (
                <option key={key} value={key}>
                  {FIELD_LABELS[key]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="People of">
          {(control) => (
            <Select {...control} value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="">The programme</option>
              {replications.status === "ready"
                ? replications.data.map((replication) => (
                    <option key={replication.id} value={replication.id}>
                      {replication.id}
                    </option>
                  ))
                : null}
            </Select>
          )}
        </FormField>
        <Button type="submit" disabled={busy}>
          Show the counts
        </Button>
      </form>
      {failure === null ? null : <ErrorState title="No counts were served." description={failure} />}
      {result === null ? null : (
        <DemographicResult
          result={result}
          title={`${FIELD_LABELS[field]} of ${scope === "" ? "the programme" : scope}`}
        />
      )}
    </section>
  );
}

function DemographicResult({ result, title }: { result: Aggregates; title: string }) {
  const table = (): ExportTable => ({
    title,
    columns: ["Category", "Count"],
    rows: result.cells.map((cell) => [cell.category, cell.count === null ? SUPPRESSED_TEXT : cell.count]),
  });
  if (result.cells.length === 0) {
    return (
      <div className="grid gap-2" data-testid="demographic-result">
        <EmptyState
          title="No counts can be shown"
          description={`Fewer than ${result.threshold} people are in this scope, so any count could point at someone.`}
        />
      </div>
    );
  }
  return (
    <div className="grid gap-2" data-testid="demographic-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {result.people === null || result.total === null
            ? "The number of people and the total are withheld, since a group is suppressed."
            : `${result.people} people in scope. Total ${result.total}.`}
        </p>
        <ExportMenu table={table} />
      </div>
      <ul className="grid gap-1 text-sm">
        {result.cells.map((cell) => (
          <li key={cell.category}>
            {cell.category}: {cell.count === null ? SUPPRESSED_TEXT : cell.count}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisPage() {
  const viewer = useViewer();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Analysis"
        description="Breakdowns of the programme's laboratories, members, equipment, participations and outputs, from the records your account may read, each with its export."
      />
      <DirectoryAnalysis />
      {viewer?.can("demographics.read", "programme") === true ? <DemographicAnalysis /> : null}
    </div>
  );
}
