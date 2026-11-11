// Home: the member's laboratories and, for a coordinator, what in them needs attention. It reads
// only what the member may read: the directory, the participations, the current equipment, and
// the checklists and requests of the coordinator's own laboratories.
import { laboratoryScopeKey } from "@eegml/shared";
import { type ReactNode, useMemo } from "react";
import { Link } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { retryFailedLiveData, useLiveQuery } from "@/data";
import { usePendingLabClaims } from "@/pages/admin/queues";
import { OwnLabRequests, useOwnPendingLabClaims } from "@/pages/laboratories/OwnLabRequests";
import { combineLive, orEmpty } from "@/registry/combine";
import { LABORATORY_ROLE_LABELS, PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import { laboratoryPath } from "@/registry/paths";
import {
  checklistsInScope,
  laboratoryEntriesOfPerson,
  useCurrentEquipment,
  useLaboratories,
  useParticipations,
} from "@/registry/queries";
import { attentionItems } from "./attention";

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      aria-labelledby="laboratories-panel-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
      data-testid="laboratories-panel"
    >
      <h2 id="laboratories-panel-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Your laboratories
      </h2>
      {children}
    </section>
  );
}

export function LaboratoriesPanel() {
  const { access } = useAuth();
  const record = access.status === "ready" ? access.data : null;
  const personId = record?.member === true ? record.personId : null;
  const coordinated = record?.coordinatorLaboratoryIds ?? [];
  const entries = useLiveQuery(personId === null ? null : laboratoryEntriesOfPerson(personId));
  const laboratories = useLaboratories();
  const participations = useParticipations();
  const equipment = useCurrentEquipment();
  const scopeKeys = coordinated.map(laboratoryScopeKey).slice(0, 30);
  const checklists = orEmpty(useLiveQuery(scopeKeys.length === 0 ? null : checklistsInScope(scopeKeys)));
  const claims = orEmpty(usePendingLabClaims(coordinated.length === 0 ? null : record));
  const ownPending = useOwnPendingLabClaims();
  const live = useMemo(
    () =>
      combineLive(
        [entries, laboratories, participations, equipment, checklists, claims] as const,
        (mine, labs, parts, current, items, requests) => ({ mine, labs, parts, current, items, requests }),
      ),
    [entries, laboratories, participations, equipment, checklists, claims],
  );
  if (personId === null) return null;
  return (
    <Panel>
      <LiveView
        live={live}
        loadingLabel="Loading your laboratories"
        errorTitle="Your laboratories could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ mine, labs, parts, current, items, requests }) => {
          const names = new Map(labs.map((laboratory) => [laboratory.id, laboratory.name]));
          const listed = mine.filter((entry) => entry.status === "confirmed" && entry.archivedAt === null);
          const attention = attentionItems({
            laboratoryIds: coordinated,
            participations: parts,
            currentEquipment: current,
            checklistItems: items,
            pendingRequests: requests,
          });
          return (
            <>
              <OwnLabRequests />
              {listed.length === 0 ? (
                <p className="text-fg-secondary">
                  {ownPending.length > 0
                    ? "You are not listed in a laboratory yet. Your request waits for review, and you are told when it has been decided."
                    : "You are not listed in a laboratory yet. Register your laboratory, or ask to represent it from its page."}
                </p>
              ) : (
                <ul className="grid gap-2">
                  {listed.map((entry) => {
                    const taking = parts.filter(
                      (participation) =>
                        participation.laboratoryId === entry.laboratoryId && participation.archivedAt === null,
                    );
                    return (
                      <li key={entry.id} className="grid gap-0.5">
                        <Link to={laboratoryPath(entry.laboratoryId)} className="font-medium text-fg-accent underline">
                          {names.get(entry.laboratoryId) ?? entry.laboratoryId}
                        </Link>
                        <span className="text-fg-secondary">
                          {LABORATORY_ROLE_LABELS[entry.role]}
                          {entry.isAuthorisedRepresentative ? ", authorised representative" : ""}
                          {taking.length === 0
                            ? ". Takes part in no replication in the portal yet."
                            : `. ${taking
                                .map(
                                  (participation) =>
                                    `${participation.replicationId}: ${PARTICIPATION_STATUS_LABELS[participation.status].toLowerCase()}`,
                                )
                                .join("; ")}.`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {coordinated.length === 0 ? null : (
                <div className="grid gap-2" data-testid="attention">
                  <h3 className="text-md font-medium text-fg-strong">Needs your attention</h3>
                  {attention.length === 0 ? (
                    <p className="text-fg-secondary">Nothing in the laboratories you coordinate waits for you.</p>
                  ) : (
                    <ul className="grid gap-1">
                      {attention.map((item) => (
                        <li key={item.id}>
                          <Link to={item.to} className="text-fg-accent underline">
                            {item.text(names.get(item.laboratoryId) ?? item.laboratoryId)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div>
                <Button asChild size="sm">
                  <Link to="/labs">Go to the laboratories</Link>
                </Button>
              </div>
            </>
          );
        }}
      </LiveView>
    </Panel>
  );
}
