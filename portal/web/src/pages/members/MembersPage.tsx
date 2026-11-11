import { useMemo } from "react";
import { Link } from "react-router";
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
import { retryFailedLiveData } from "@/data";
import { countryName, formatCount } from "@/registry/labels";
import { memberPath, replicationPath } from "@/registry/paths";
import { ALL_PERSONS, useDirectory, useLaboratories, usePersons, useReplications } from "@/registry/queries";
import { useSearchText, useUrlState } from "@/registry/url-state";
import { useViewer } from "@/registry/viewer";
import {
  buildMemberRows,
  countryOptions,
  DEFAULT_MEMBER_STATE,
  filterMembers,
  type MemberRow,
  type MemberSortKey,
  NO_COUNTRY,
  parseMemberState,
  serialiseMemberState,
  sortMembers,
} from "./member-list";

/** Every row has this height, which is what lets the table render only the rows in view. */
const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 560;

function columnsFor(showClaimed: boolean): readonly RecordColumn<MemberRow, MemberSortKey>[] {
  const columns: RecordColumn<MemberRow, MemberSortKey>[] = [
    {
      id: "name",
      header: "Name",
      sortKey: "name",
      className: "max-w-64 truncate whitespace-nowrap",
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          <Link
            to={memberPath(row.id)}
            tabIndex={-1}
            className="truncate font-medium text-fg-strong hover:text-fg-accent"
          >
            {row.name}
          </Link>
          <OriginBadge origin={row.dataOrigin} />
        </span>
      ),
    },
    {
      id: "affiliation",
      header: "Affiliation",
      sortKey: "affiliation",
      className: "max-w-72 truncate whitespace-nowrap",
      cell: (row) => row.affiliation ?? <Unknown />,
    },
    {
      id: "country",
      header: "Country",
      sortKey: "country",
      className: "whitespace-nowrap",
      cell: (row) => row.countryName ?? <Unknown />,
    },
    {
      id: "replications",
      header: "Replications",
      sortKey: "replications",
      className: "max-w-56 truncate whitespace-nowrap",
      cell: (row) =>
        row.replicationIds.length === 0 ? <Unknown>None confirmed</Unknown> : row.replicationIds.join(", "),
    },
    {
      id: "core",
      header: "Core team",
      sortKey: "core",
      className: "max-w-48 truncate whitespace-nowrap",
      cell: (row) => (row.isCoreTeam ? row.coreRoles.join(", ") || "Core team" : <Unknown>No</Unknown>),
    },
  ];
  if (showClaimed) {
    columns.push({
      id: "claimed",
      header: "Profile",
      sortKey: "claimed",
      className: "whitespace-nowrap",
      cell: (row) => (row.claimed ? "Claimed" : <Unknown>Not claimed</Unknown>),
    });
  }
  return columns;
}

function MemberPreview({ row, showClaimed }: { row: MemberRow; showClaimed: boolean }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <OriginBadge origin={row.dataOrigin} showLive />
        {row.isCoreTeam ? <Badge tone="neutral">Core team</Badge> : null}
      </div>
      <Details>
        <Detail term="Affiliation">{row.affiliation ?? <Unknown />}</Detail>
        <Detail term="Country">{row.countryName ?? <Unknown />}</Detail>
        <Detail term="Replications">
          {row.replicationIds.length === 0 ? (
            <Unknown>None confirmed</Unknown>
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
        {row.isCoreTeam ? <Detail term="Core-team roles">{row.coreRoles.join(", ") || <Unknown />}</Detail> : null}
        {showClaimed ? (
          <Detail term="Profile">{row.claimed ? "Claimed by an account" : "Not claimed yet"}</Detail>
        ) : null}
      </Details>
    </>
  );
}

export function MembersPage() {
  const viewer = useViewer();
  const persons = usePersons();
  const directory = useDirectory(ALL_PERSONS);
  // The directory is read in pages up to a bound; past it, the count is a lower bound.
  const truncated = directory.status === "ready" && directory.data.truncated;
  const replications = useReplications();
  const laboratories = useLaboratories();
  const [state, update] = useUrlState(parseMemberState, serialiseMemberState);
  const [searchText, setSearchText] = useSearchText(state.query, (query) => update({ query }));
  const filtered =
    state.query !== "" ||
    state.country !== null ||
    state.replication !== null ||
    state.laboratory !== null ||
    state.coreTeam;
  const clearFilters = () =>
    update({ ...DEFAULT_MEMBER_STATE, sort: state.sort, direction: state.direction, open: state.open });
  usePaletteActions(
    [
      ...(filtered ? [{ id: "clear", label: "Clear the search and filters", run: clearFilters }] : []),
      ...(state.open === null ? [] : [{ id: "close", label: "Close the preview", run: () => update({ open: null }) }]),
    ],
    `${filtered}:${state.open}`,
  );
  const showClaimed =
    viewer !== null && (viewer.can("claims.review", "programme") || viewer.can("people.manage", "programme"));
  const columns = useMemo(() => columnsFor(showClaimed), [showClaimed]);
  const rows = useMemo(
    () => (persons.status === "ready" ? { ...persons, data: buildMemberRows(persons.data, countryName) } : persons),
    [persons],
  );
  const studyKeys =
    replications.status === "ready" ? replications.data.map((replication) => replication.studyKey).sort() : [];
  const laboratoryChoices =
    laboratories.status === "ready"
      ? laboratories.data
          .filter((laboratory) => laboratory.archivedAt === null)
          .map((laboratory) => ({ id: laboratory.id, name: laboratory.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone the programme knows, whether or not they have signed in. Select a row to preview it, or open the full profile."
      />
      <LiveView
        live={rows}
        loadingLabel="Loading the members"
        errorTitle="The members could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(all) => {
          const shown = sortMembers(filterMembers(all, state), state.sort, state.direction);
          const open = state.open === null ? undefined : all.find((row) => row.id === state.open);
          return (
            <div className="grid gap-4 *:min-w-0">
              <div className="grid gap-3 *:min-w-0 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_repeat(4,minmax(9rem,1fr))]">
                <FormField label="Search members" hint="Name or affiliation">
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
                      {countryOptions(all).map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.name}
                        </option>
                      ))}
                      <option value={NO_COUNTRY}>No country recorded</option>
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
                      {studyKeys.map((studyKey) => (
                        <option key={studyKey} value={studyKey}>
                          {studyKey}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                {laboratoryChoices.length === 0 && state.laboratory === null ? null : (
                  <FormField label="Laboratory">
                    {(control) => (
                      <Select
                        {...control}
                        value={state.laboratory ?? ""}
                        onChange={(event) => update({ laboratory: event.target.value || null })}
                      >
                        <option value="">Every laboratory</option>
                        {laboratoryChoices.map((laboratory) => (
                          <option key={laboratory.id} value={laboratory.id}>
                            {laboratory.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                )}
                <FormField label="Core team">
                  {(control) => (
                    <Select
                      {...control}
                      value={state.coreTeam ? "yes" : ""}
                      onChange={(event) => update({ coreTeam: event.target.value === "yes" })}
                    >
                      <option value="">Everyone</option>
                      <option value="yes">Core team only</option>
                    </Select>
                  )}
                </FormField>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p aria-live="polite" className="text-fg-secondary" data-testid="result-count">
                  {truncated
                    ? `Showing ${formatCount(shown.length)} of at least ${formatCount(all.length)} members. The directory reads the first ${formatCount(all.length)}, so the search may miss people.`
                    : `Showing ${formatCount(shown.length)} of ${formatCount(all.length)} members`}
                </p>
                {filtered ? (
                  <Button size="sm" variant="ghost" onClick={clearFilters}>
                    Clear the search and filters
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-fg-muted">
                In the table, the arrow keys move between rows and Enter opens a preview.
              </p>
              {shown.length === 0 ? (
                <EmptyState
                  title={all.length === 0 ? "No members yet" : "No member matches"}
                  description={
                    all.length === 0
                      ? "Members appear here once an administrator imports or creates them."
                      : "Change the search or clear the filters to see more."
                  }
                />
              ) : (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <RecordTable
                      rememberScroll
                      caption="Members"
                      rows={shown}
                      columns={columns}
                      rowKey={(row) => row.id}
                      rowLabel={(row) => (row.affiliation === null ? row.name : `${row.name}, ${row.affiliation}`)}
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
                      virtualise={{
                        rowHeight: ROW_HEIGHT,
                        // A short list takes the height it needs; a long one scrolls within the table.
                        viewportHeight: Math.min(VIEWPORT_HEIGHT, (shown.length + 1) * ROW_HEIGHT + 2),
                      }}
                      data-testid="members-table"
                    />
                  </div>
                  {open === undefined ? null : (
                    <SidePanel
                      title={open.name}
                      fullPage={memberPath(open.id)}
                      onClose={() => {
                        update({ open: null });
                        document.querySelector<HTMLElement>(`tr[aria-current="true"]`)?.focus();
                      }}
                    >
                      <MemberPreview row={open} showClaimed={showClaimed} />
                    </SidePanel>
                  )}
                </div>
              )}
            </div>
          );
        }}
      </LiveView>
    </>
  );
}
