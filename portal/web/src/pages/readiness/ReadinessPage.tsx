import { participationStatusSchema } from "@eegml/shared";
import { useMemo } from "react";
import { Link } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { OriginBadge } from "@/components/registry/origin-badge";
import { SidePanel } from "@/components/registry/side-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { retryFailedLiveData, useLiveQuery } from "@/data";
import { ParticipationCard } from "@/pages/participations/ParticipationCard";
import { combineLive, orEmpty } from "@/registry/combine";
import { countryName, PARTICIPATION_STATUS_LABELS, READINESS_LABELS } from "@/registry/labels";
import { laboratoryDialogPath, laboratoryPath, replicationPath } from "@/registry/paths";
import {
  checklistsInScope,
  useCurrentEquipment,
  useLaboratories,
  useParticipations,
  usePersons,
  useRequirements,
} from "@/registry/queries";
import { useUrlState } from "@/registry/url-state";
import { useViewer, type Viewer } from "@/registry/viewer";
import { buildMatrix, parseReadinessState, progressByParticipation, serialiseReadinessState } from "./readiness";

function Matrix({ viewer }: { viewer: Viewer }) {
  const [state, update] = useUrlState(parseReadinessState, serialiseReadinessState);
  const participations = useParticipations();
  const laboratories = useLaboratories();
  const persons = usePersons();
  const requirements = useRequirements();
  const equipment = useCurrentEquipment();
  const checklists = orEmpty(useLiveQuery(checklistsInScope(viewer.staff ? "all" : viewer.queryScopeKeys)));
  const live = useMemo(
    () =>
      combineLive(
        [participations, laboratories, persons, requirements, equipment, checklists] as const,
        (parts, labs, people, needs, current, items) => ({ parts, labs, people, needs, current, items }),
      ),
    [participations, laboratories, persons, requirements, equipment, checklists],
  );
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the readiness of the laboratories"
      errorTitle="The readiness matrix could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {({ parts, labs, people, needs, current, items }) => {
        const active = parts.filter((participation) => participation.archivedAt === null);
        const laboratoryInfo = new Map(
          labs
            .filter((laboratory) => laboratory.archivedAt === null)
            .map((laboratory) => [
              laboratory.id,
              { name: laboratory.name, countryCode: laboratory.countryCode ?? null },
            ]),
        );
        const { columns, rows } = buildMatrix({
          participations: active,
          laboratories: laboratoryInfo,
          progress: progressByParticipation(items),
          state,
        });
        const countries = [
          ...new Set(
            [...laboratoryInfo.values()].flatMap((lab) => (lab.countryCode === null ? [] : [lab.countryCode])),
          ),
        ]
          .map((code) => ({ code, name: countryName(code) }))
          .sort((a, b) => a.name.localeCompare(b.name, "en"));
        const replicationIds = [...new Set(active.map((participation) => participation.replicationId))].sort();
        const open = state.open === null ? undefined : active.find((participation) => participation.id === state.open);
        const personNames = new Map(people.map((person) => [person.id, person.displayName]));
        return (
          <div className="grid gap-4 *:min-w-0">
            <div className="grid gap-3 *:min-w-0 sm:grid-cols-3">
              <FormField label="Replication">
                {(control) => (
                  <Select
                    {...control}
                    value={state.replication ?? ""}
                    onChange={(event) => update({ replication: event.target.value || null })}
                  >
                    <option value="">Every replication</option>
                    {replicationIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </Select>
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
                    {countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField label="Status of the participation">
                {(control) => (
                  <Select
                    {...control}
                    value={state.status ?? ""}
                    onChange={(event) => {
                      const parsed = participationStatusSchema.safeParse(event.target.value);
                      update({ status: parsed.success ? parsed.data : null });
                    }}
                  >
                    <option value="">Every status</option>
                    {participationStatusSchema.options.map((status) => (
                      <option key={status} value={status}>
                        {PARTICIPATION_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            <p className="text-xs text-fg-muted">
              The progress of a checklist is shown where your account may read it: to the laboratory, the team of the
              replication and the programme.
            </p>
            {rows.length === 0 ? (
              <EmptyState
                title={active.length === 0 ? "No participations yet" : "No participation matches"}
                description={
                  active.length === 0
                    ? "A laboratory appears here once it is registered in the portal and the leads of a replication have added it to the replication."
                    : "Change the filters to see more."
                }
                {...(active.length === 0
                  ? {
                      action: (
                        <Link className="text-fg-accent underline" to={laboratoryDialogPath("register")}>
                          Register a laboratory
                        </Link>
                      ),
                    }
                  : {})}
              />
            ) : (
              <div className="flex items-start gap-4">
                <div className="relative min-w-0 flex-1 overflow-x-auto rounded-tile border border-border bg-surface">
                  <table className="w-full border-collapse text-left text-sm" data-testid="readiness-matrix">
                    <caption className="sr-only">Readiness of the laboratories, by replication</caption>
                    <thead className="bg-surface-muted text-micro text-fg-muted">
                      <tr className="border-b border-border">
                        <th scope="col" className="px-3 py-2 font-medium">
                          Laboratory
                        </th>
                        {columns.map((id) => (
                          <th key={id} scope="col" className="px-3 py-2 font-medium">
                            <Link to={replicationPath(id)} className="hover:text-fg-accent">
                              {id}
                            </Link>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.laboratoryId} className="border-b border-border last:border-b-0">
                          <th scope="row" className="px-3 py-2 align-top font-medium text-fg-strong">
                            <Link to={laboratoryPath(row.laboratoryId)} className="hover:text-fg-accent">
                              {row.name}
                            </Link>
                          </th>
                          {columns.map((id) => {
                            const cell = row.cells.get(id);
                            if (cell === undefined) {
                              return (
                                <td key={id} className="px-3 py-2 align-top text-fg-muted">
                                  Not taking part
                                </td>
                              );
                            }
                            const { participation, progress } = cell;
                            return (
                              <td key={id} className="px-1 py-1 align-top">
                                <button
                                  type="button"
                                  className="grid w-full cursor-pointer gap-0.5 rounded-control px-2 py-1 text-left hover:bg-surface-muted aria-[current=true]:bg-surface-accent"
                                  aria-current={state.open === participation.id ? "true" : undefined}
                                  onClick={() => update({ open: participation.id })}
                                  data-testid="readiness-cell"
                                >
                                  <span className="sr-only">
                                    {row.name} in {id}:{" "}
                                  </span>
                                  <span className="font-medium text-fg-strong">
                                    {PARTICIPATION_STATUS_LABELS[participation.status]}
                                  </span>
                                  <span className="text-xs text-fg-secondary">
                                    {READINESS_LABELS[participation.readinessStatus]}
                                  </span>
                                  {progress === null ? null : (
                                    <span className="text-xs text-fg-muted">
                                      {progress.settled} of {progress.total} items done
                                    </span>
                                  )}
                                  {participation.dataOrigin === "live" ? null : (
                                    <span>
                                      <OriginBadge origin={participation.dataOrigin} />
                                    </span>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {open === undefined ? null : (
                  <SidePanel
                    title={`${laboratoryInfo.get(open.laboratoryId)?.name ?? open.laboratoryId} in ${open.replicationId}`}
                    fullPage={`${laboratoryPath(open.laboratoryId)}?tab=participations`}
                    onClose={() => update({ open: null })}
                  >
                    <ParticipationCard
                      participation={open}
                      viewer={viewer}
                      title={
                        <Link to={replicationPath(open.replicationId)} className="hover:text-fg-accent">
                          {open.replicationId}
                        </Link>
                      }
                      label={`${laboratoryInfo.get(open.laboratoryId)?.name ?? open.laboratoryId} in ${open.replicationId}`}
                      requirements={needs.filter(
                        (requirement) =>
                          requirement.replicationId === open.replicationId && requirement.archivedAt === null,
                      )}
                      currentConfigurations={current.filter(
                        (configuration) =>
                          configuration.laboratoryId === open.laboratoryId && configuration.archivedAt === null,
                      )}
                      personNames={personNames}
                    />
                  </SidePanel>
                )}
              </div>
            )}
          </div>
        );
      }}
    </LiveView>
  );
}

export function ReadinessPage() {
  const viewer = useViewer();
  return (
    <>
      <PageHeader
        title="Readiness"
        description="The onboarding of each laboratory in each replication. Select a cell to open the participation beside the matrix."
      />
      {viewer === null ? <LoadingState label="Checking your access" /> : <Matrix viewer={viewer} />}
    </>
  );
}
