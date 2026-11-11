import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { Detail, Details } from "@/components/registry/details";
import { OriginBadge } from "@/components/registry/origin-badge";
import { SidePanel } from "@/components/registry/side-panel";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { retryFailedLiveData } from "@/data";
import { combineLive } from "@/registry/combine";
import { countryName, formatCount, LABORATORY_STATUS_LABELS } from "@/registry/labels";
import { LABORATORY_DIALOG_PARAMETER, laboratoryPath, replicationPath } from "@/registry/paths";
import { useInstitutions, useLaboratories, useParticipations, usePersons } from "@/registry/queries";
import { useSearchText, useUrlState } from "@/registry/url-state";
import { useViewer } from "@/registry/viewer";
import {
  buildLaboratoryRows,
  DEFAULT_LABORATORY_STATE,
  filterLaboratories,
  type LaboratoryRow,
  type LaboratorySortKey,
  laboratoryFilterOptions,
  parseLaboratoryState,
  serialiseLaboratoryState,
  sortLaboratories,
} from "./laboratory-list";
import { OwnLabRequests } from "./OwnLabRequests";
import { RegisterLaboratoryDialog } from "./RegisterLaboratoryDialog";

const COLUMNS: readonly RecordColumn<LaboratoryRow, LaboratorySortKey>[] = [
  {
    id: "name",
    header: "Laboratory",
    sortKey: "name",
    className: "min-w-48",
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          to={laboratoryPath(row.id)}
          tabIndex={-1}
          className="rounded-control font-medium text-fg-strong hover:text-fg-accent"
        >
          {row.name}
        </Link>
        <OriginBadge origin={row.dataOrigin} />
        {row.status === "active" ? null : <Badge tone="outline">{LABORATORY_STATUS_LABELS[row.status]}</Badge>}
      </span>
    ),
  },
  {
    id: "institution",
    header: "Institution",
    sortKey: "institution",
    className: "min-w-40",
    cell: (row) => row.institution ?? <Unknown />,
  },
  { id: "country", header: "Country", sortKey: "country", cell: (row) => row.countryName ?? <Unknown /> },
  { id: "city", header: "City", sortKey: "city", cell: (row) => row.city ?? <Unknown /> },
  {
    id: "replications",
    header: "Replications",
    sortKey: "replications",
    className: "min-w-36",
    cell: (row) =>
      row.replicationIds.length === 0 ? <Unknown>None in the portal</Unknown> : row.replicationIds.join(", "),
  },
];

function useLaboratoryRows() {
  const laboratories = useLaboratories();
  const institutions = useInstitutions();
  const persons = usePersons();
  const participations = useParticipations();
  return useMemo(
    () =>
      combineLive([laboratories, institutions, persons, participations] as const, (labs, insts, people, parts) => ({
        records: labs,
        institutions: insts,
        rows: buildLaboratoryRows({
          laboratories: labs,
          institutionNames: new Map(insts.map((institution) => [institution.id, institution.name])),
          personNames: new Map(people.map((person) => [person.id, person.displayName])),
          replicationsOf: parts
            .filter((participation) => participation.archivedAt === null)
            .reduce((map, participation) => {
              map.set(participation.laboratoryId, [
                ...(map.get(participation.laboratoryId) ?? []),
                participation.replicationId,
              ]);
              return map;
            }, new Map<string, string[]>()),
          countryName,
        }),
      })),
    [laboratories, institutions, persons, participations],
  );
}

function LaboratoryPreview({ row }: { row: LaboratoryRow }) {
  return (
    <Details>
      <Detail term="Institution">{row.institution ?? <Unknown />}</Detail>
      <Detail term="Department">{row.department ?? <Unknown />}</Detail>
      <Detail term="Country">{row.countryName ?? <Unknown />}</Detail>
      <Detail term="City">{row.city ?? <Unknown />}</Detail>
      <Detail term="Principal investigator">{row.principalInvestigator ?? <Unknown />}</Detail>
      <Detail term="Status">{LABORATORY_STATUS_LABELS[row.status]}</Detail>
      <Detail term="Replications">
        {row.replicationIds.length === 0 ? (
          <Unknown>None in the portal</Unknown>
        ) : (
          <ul className="grid gap-1">
            {row.replicationIds.map((id) => (
              <li key={id}>
                <Link to={replicationPath(id)} className="text-fg-accent underline">
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Detail>
    </Details>
  );
}

const rowLabel = (row: LaboratoryRow) => (row.institution === null ? row.name : `${row.name}, ${row.institution}`);

export function LaboratoriesPage() {
  const viewer = useViewer();
  const toast = useToast();
  const navigate = useNavigate();
  const live = useLaboratoryRows();
  const [state, update] = useUrlState(parseLaboratoryState, serialiseLaboratoryState);
  const [searchText, setSearchText] = useSearchText(state.query, (query) => update({ query }));
  // A link from elsewhere, such as a replication with no laboratory to add, may open a dialog.
  const [params] = useSearchParams();
  const [dialog, setDialog] = useState<"register" | "create" | null>(() => {
    const requested = params.get(LABORATORY_DIALOG_PARAMETER);
    return requested === "register" || requested === "create" ? requested : null;
  });
  const registers = viewer?.access.member === true && viewer.personId !== null;
  const creates = viewer?.can("labs.manage", "programme") === true;
  const filtered = state.query !== "" || state.country !== null || state.replication !== null;
  const clearFilters = () =>
    update({ ...DEFAULT_LABORATORY_STATE, sort: state.sort, direction: state.direction, open: state.open });
  usePaletteActions(
    [
      ...(registers ? [{ id: "register", label: "Register a laboratory", run: () => setDialog("register") }] : []),
      ...(creates ? [{ id: "create", label: "Create a laboratory", run: () => setDialog("create") }] : []),
      ...(filtered ? [{ id: "clear", label: "Clear the search and filters", run: clearFilters }] : []),
    ],
    `${registers}:${creates}:${filtered}`,
  );

  const actions = (
    <div className="flex flex-wrap gap-2">
      {registers ? (
        <Button variant="primary" onClick={() => setDialog("register")}>
          Register a laboratory
        </Button>
      ) : null}
      {creates ? <Button onClick={() => setDialog("create")}>Create a laboratory</Button> : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Laboratories"
        description="Every laboratory in the portal. Select a row to preview it beside the list, or open its full page."
      />
      <OwnLabRequests />
      <LiveView
        live={live}
        loadingLabel="Loading the laboratories"
        errorTitle="The laboratories could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ rows, records, institutions }) => {
          const options = laboratoryFilterOptions(rows);
          const shown = sortLaboratories(filterLaboratories(rows, state), state.sort, state.direction);
          const open = state.open === null ? undefined : rows.find((row) => row.id === state.open);
          return (
            <div className="grid gap-4 *:min-w-0">
              {rows.length === 0 ? null : (
                <>
                  {/* The actions sit on a row of their own until the filters have room beside them. */}
                  <div className="grid gap-3 *:min-w-0 xl:grid-cols-[1fr_auto] xl:items-end">
                    <div className="grid gap-3 *:min-w-0 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_repeat(2,minmax(9rem,1fr))]">
                      <FormField label="Search laboratories" hint="Name, institution, department, city or country">
                        {(control) => (
                          <Input
                            {...control}
                            type="search"
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                          />
                        )}
                      </FormField>
                      <FormField label="Country">
                        {(control) => (
                          <Select
                            {...control}
                            value={state.country ?? ""}
                            onChange={(event) => update({ country: event.target.value || null })}
                          >
                            <option value="">Every country</option>
                            {options.countries.map((country) => (
                              <option key={country.code} value={country.code}>
                                {country.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </FormField>
                      <FormField label="Replication">
                        {(control) => (
                          <Select
                            {...control}
                            value={state.replication ?? ""}
                            onChange={(event) => update({ replication: event.target.value || null })}
                          >
                            <option value="">Every replication</option>
                            {options.replications.map((id) => (
                              <option key={id} value={id}>
                                Takes part in {id}
                              </option>
                            ))}
                          </Select>
                        )}
                      </FormField>
                    </div>
                    {actions}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p aria-live="polite" className="text-fg-secondary" data-testid="result-count">
                      Showing {formatCount(shown.length)} of {formatCount(rows.length)} laboratories
                    </p>
                    {filtered ? (
                      <Button size="sm" variant="ghost" onClick={clearFilters}>
                        Clear the search and filters
                      </Button>
                    ) : null}
                  </div>
                </>
              )}
              {rows.length === 0 ? (
                <EmptyState
                  title="No laboratories yet"
                  description={
                    "No record that could be imported lists laboratories, so laboratories come into the portal one by one. " +
                    "A member registers a laboratory and an administrator or the core team reviews the registration, or an administrator creates one directly. " +
                    (registers ? "Register yours to start." : "Claim your member profile to register yours.")
                  }
                  action={actions}
                />
              ) : shown.length === 0 ? (
                <EmptyState
                  title="No laboratory matches"
                  description="Change the search or clear the filters to see more."
                />
              ) : (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <RecordTable
                      rememberScroll
                      caption="Laboratories"
                      rows={shown}
                      columns={COLUMNS}
                      rowKey={(row) => row.id}
                      rowLabel={rowLabel}
                      sortKey={state.sort}
                      direction={state.direction}
                      onSort={(key) =>
                        update({
                          sort: key,
                          direction: key === state.sort && state.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      onOpen={(row) => update({ open: row.id })}
                      openKey={state.open}
                      data-testid="laboratories-table"
                    />
                  </div>
                  {open === undefined ? null : (
                    <SidePanel
                      title={open.name}
                      fullPage={laboratoryPath(open.id)}
                      onClose={() => {
                        update({ open: null });
                        document.querySelector<HTMLElement>(`tr[aria-current="true"]`)?.focus();
                      }}
                    >
                      <LaboratoryPreview row={open} />
                    </SidePanel>
                  )}
                </div>
              )}
              {dialog === null || (dialog === "register" ? !registers : !creates) ? null : (
                <RegisterLaboratoryDialog
                  mode={dialog}
                  open
                  onOpenChange={(next) => (next ? null : setDialog(null))}
                  institutions={institutions
                    .filter((institution) => institution.archivedAt === null)
                    .map((institution) => ({
                      id: institution.id,
                      name: institution.name,
                      countryCode: institution.countryCode ?? null,
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name, "en"))}
                  laboratories={records}
                  onDone={({ laboratoryId, duplicate }) => {
                    if (dialog === "create") {
                      toast.show({ title: "The laboratory has been created." });
                      navigate(laboratoryPath(laboratoryId));
                      return;
                    }
                    toast.show({
                      title: "Your registration has been sent for review.",
                      description: duplicate
                        ? "A laboratory with this name at this institution is in the portal already. The reviewer compares the two."
                        : "You will be notified when it has been decided.",
                    });
                  }}
                />
              )}
            </div>
          );
        }}
      </LiveView>
    </>
  );
}
