import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { Detail, Details } from "@/components/registry/details";
import { FavouriteButton } from "@/components/registry/favourite-button";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Live, type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { combineLive, orEmpty } from "@/registry/combine";
import {
  ALL_PERSONS,
  aliasesOfReplication,
  CONFIRMED_MEMBERSHIPS,
  contributorsOfReplication,
  documentLinksOfReplication,
  historicalAggregatesOfReplication,
  hypothesesOfReplication,
  membershipsOfReplication,
  statusHistoryOfReplication,
  useCurrentEquipment,
  useDirectoryItems,
  useLaboratories,
  useManuscripts,
  useParticipations,
  usePersonNames,
  useReplicationStatuses,
  useRequirements,
} from "@/registry/queries";
import { useRecordVisit } from "@/registry/use-record-visit";
import { useViewer, type Viewer } from "@/registry/viewer";
import { LeadsText } from "./replication-display";
import type { LeadState } from "./replication-list";
import { stageText } from "./replication-list";
import { StatusChangeDialog } from "./StatusChangeDialog";
import { ActivityTab } from "./tabs/ActivityTab";
import { ContributorsTab } from "./tabs/ContributorsTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { HypothesesTab } from "./tabs/HypothesesTab";
import { LaboratoriesTab } from "./tabs/LaboratoriesTab";
import { LeadershipTab, leadsUndecided } from "./tabs/LeadershipTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { PublicationsTab } from "./tabs/PublicationsTab";

const TAB_IDS = [
  "overview",
  "leadership",
  "laboratories",
  "hypotheses",
  "publications",
  "contributors",
  "documents",
  "activity",
] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Readonly<Record<TabId, string>> = {
  overview: "Overview",
  leadership: "Leadership",
  laboratories: "Laboratories",
  hypotheses: "Hypotheses",
  publications: "Publications",
  contributors: "Contributors",
  documents: "Documents",
  activity: "Activity",
};

interface TabSpec {
  readonly id: TabId;
  /** Whether the tab has content: it is present only then. */
  readonly live: Live<boolean>;
  readonly render: () => ReactNode;
}

const ready = <T,>(live: Live<readonly T[]>): readonly T[] => (live.status === "ready" ? live.data : []);
const hasAny = <T,>(live: Live<readonly T[]>): Live<boolean> =>
  live.status === "ready"
    ? { ...live, data: live.data.some((item) => (item as { archivedAt?: unknown }).archivedAt == null) }
    : live;

const NO_PERSON_NAMES: ReadonlyMap<string, string> = new Map();

function ReplicationRecord({ replication, viewer }: { replication: RecordOf<"replications">; viewer: Viewer }) {
  const { studyKey } = replication;
  const [params, setParams] = useSearchParams();
  const statuses = useReplicationStatuses();
  const member = viewer.access.member;
  const addsLaboratories =
    member && replication.archivedAt === null && viewer.can("participations.manage", { replicationId: studyKey });
  // The directory serves the choice of a local lead when a laboratory is added, so only those who
  // add laboratories read it.
  const persons = useDirectoryItems(addsLaboratories ? ALL_PERSONS : null);
  const laboratories = useLaboratories();
  const allParticipations = useParticipations();
  const allManuscripts = useManuscripts();
  const currentEquipment = useCurrentEquipment();
  const allRequirements = useRequirements();
  const team = viewer.readsTeamOf(studyKey);
  const teamMemberships = orEmpty(useLiveQuery(team ? membershipsOfReplication(studyKey) : null));
  const confirmedMemberships = orEmpty(useLiveQuery(team ? null : CONFIRMED_MEMBERSHIPS));
  const aliases = useLiveQuery(aliasesOfReplication(studyKey));
  const hypotheses = useLiveQuery(hypothesesOfReplication(studyKey));
  const detail = useLiveDocument("replicationDetail", team ? [studyKey] : null);
  const aggregates = useLiveQuery(historicalAggregatesOfReplication(studyKey));
  const contributors = useLiveQuery(contributorsOfReplication(studyKey));
  const links = useLiveQuery(documentLinksOfReplication(studyKey, viewer.queryScopeKeys));
  const history = useLiveQuery(statusHistoryOfReplication(studyKey));

  const memberships = useMemo<Live<readonly RecordOf<"replicationMemberships">[]>>(() => {
    if (team) return teamMemberships;
    return confirmedMemberships.status === "ready"
      ? {
          ...confirmedMemberships,
          data: confirmedMemberships.data.filter((membership) => membership.replicationId === studyKey),
        }
      : confirmedMemberships;
  }, [team, teamMemberships, confirmedMemberships, studyKey]);
  const participations = useMemo<Live<readonly RecordOf<"participations">[]>>(
    () =>
      allParticipations.status === "ready"
        ? {
            ...allParticipations,
            data: allParticipations.data.filter((item) => item.replicationId === studyKey && item.archivedAt === null),
          }
        : allParticipations,
    [allParticipations, studyKey],
  );
  const manuscripts = useMemo<Live<readonly RecordOf<"manuscripts">[]>>(
    () =>
      allManuscripts.status === "ready"
        ? { ...allManuscripts, data: allManuscripts.data.filter((item) => item.replicationId === studyKey) }
        : allManuscripts,
    [allManuscripts, studyKey],
  );

  // Only the people the page names are read: the leads, the team and the local leads.
  const names = usePersonNames([
    ...replication.leadPersonIds,
    ...ready(memberships).map((membership) => membership.personId),
    ...ready(participations).flatMap((participation) =>
      participation.localLeadPersonId === undefined ? [] : [participation.localLeadPersonId],
    ),
  ]);
  const personNames = names.status === "ready" ? names.data : NO_PERSON_NAMES;
  const statusOptions = useMemo(
    () =>
      ready(statuses)
        .filter((status) => status.archivedAt === null)
        .sort((a, b) => a.position - b.position)
        .map((status) => ({ key: status.key, label: status.label })),
    [statuses],
  );
  const statusLabel = (key: string) => statusOptions.find((status) => status.key === key)?.label ?? key;

  const leadNames = replication.leadPersonIds.map((id) => personNames.get(id) ?? id);
  const leadState: LeadState =
    leadNames.length > 0 ? "confirmed" : leadsUndecided(ready(memberships)) ? "needsReview" : "none";
  const leadNamesLoading = leadNames.length > 0 && names.status === "loading";
  const canEdit =
    viewer.access.member &&
    replication.archivedAt === null &&
    viewer.can("replications.manage", { replicationId: studyKey });
  const aggregatesLive = hasAny(aggregates);

  const tabs: readonly TabSpec[] = [
    {
      id: "overview",
      live: aliases.status === "ready" ? { ...aliases, data: true } : (aliases as Live<boolean>),
      render: () => (
        <OverviewTab
          replication={replication}
          aliases={ready(aliases)}
          uid={viewer.uid}
          canEdit={canEdit}
          reporter={member ? viewer.uid : null}
        />
      ),
    },
    {
      id: "leadership",
      // Waits for the names too, so that no identifier stands where a name belongs.
      live: names.status === "loading" ? names : hasAny(memberships),
      render: () => (
        <LeadershipTab
          memberships={ready(memberships)}
          personNames={personNames}
          seesUnconfirmed={team}
          reviews={viewer.can("replications.manage", "programme")}
          hasConfirmedLead={leadNames.length > 0}
        />
      ),
    },
    {
      id: "laboratories",
      // Present with participations or historical figures, and for whoever may add a laboratory.
      live: combineLive(
        [participations, aggregatesLive, currentEquipment, allRequirements] as const,
        (linked, historical) => linked.length > 0 || historical || addsLaboratories,
      ),
      render: () => (
        <LaboratoriesTab
          studyKey={studyKey}
          viewer={viewer}
          participations={ready(participations)}
          laboratories={ready(laboratories)}
          persons={ready(persons)}
          personNames={personNames}
          requirements={ready(allRequirements).filter(
            (requirement) => requirement.replicationId === studyKey && requirement.archivedAt === null,
          )}
          currentEquipment={ready(currentEquipment)}
          aggregates={ready(aggregates)}
        />
      ),
    },
    {
      id: "hypotheses",
      // The team waits for the restricted labels too, so that none is shown as missing while it loads.
      live: team && detail.status === "loading" ? { status: "loading" } : hasAny(hypotheses),
      render: () => (
        <HypothesesTab
          hypotheses={ready(hypotheses)}
          replicatedLabels={team && detail.status === "ready" ? (detail.data?.replicatedSource ?? {}) : null}
        />
      ),
    },
    {
      id: "publications",
      live: hasAny(manuscripts),
      render: () => <PublicationsTab manuscripts={ready(manuscripts)} />,
    },
    {
      id: "contributors",
      live: hasAny(contributors),
      render: () => <ContributorsTab contributors={ready(contributors)} origin={replication.dataOrigin} />,
    },
    { id: "documents", live: hasAny(links), render: () => <DocumentsTab links={ready(links)} /> },
    {
      id: "activity",
      live: hasAny(history),
      render: () => <ActivityTab entries={ready(history)} statusLabel={statusLabel} />,
    },
  ];

  // The page waits for every section once, so that no tab appears or disappears as data arrives.
  // After that a section whose data loads again, for example because the account's rights have
  // changed, stays where it is and shows that it is loading.
  const shown = useRef(new Set<TabId>());
  const loading = shown.current.size === 0 && tabs.some((tab) => tab.live.status === "loading");
  const present = loading
    ? []
    : tabs.filter(
        (tab) =>
          tab.live.status === "error" ||
          (tab.live.status === "ready" && tab.live.data) ||
          (tab.live.status === "loading" && shown.current.has(tab.id)),
      );
  for (const tab of present) shown.current.add(tab.id);
  const requested = params.get("tab");
  const selected = present.find((tab) => tab.id === requested) ?? present[0];
  const showTab = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "overview") next.delete("tab");
        else next.set("tab", value);
        return next;
      },
      { replace: true },
    );
  const otherTabs = loading ? [] : present.filter((tab) => tab.id !== selected?.id).map((tab) => tab.id);
  usePaletteActions(
    otherTabs.map((id) => ({
      id: `tab-${id}`,
      label: `Show the ${TAB_LABELS[id].toLowerCase()} of ${studyKey}`,
      run: () => showTab(id),
    })),
    `${studyKey}:${otherTabs.join(",")}`,
  );

  return (
    <>
      <header className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="text-2xl text-fg">{studyKey}</h1>
            {replication.shortTitle === undefined ? null : (
              <p className="text-md text-fg-secondary">{replication.shortTitle}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <OriginBadge origin={replication.dataOrigin} showLive />
              {replication.selectionStatus === "withdrawn" ? (
                <Badge tone="outline">Not on the public website</Badge>
              ) : null}
              {replication.archivedAt === null ? null : <Badge tone="accent">Archived</Badge>}
            </div>
          </div>
          {member ? (
            <FavouriteButton uid={viewer.uid} entityType="replication" entityId={studyKey} name={studyKey} />
          ) : null}
        </div>
        <Details className="grid gap-0 rounded-tile border border-border bg-surface px-4 py-1">
          <Detail term="Status">
            <span className="flex flex-wrap items-center gap-3" data-testid="replication-status">
              {replication.statusKey === null ? <Unknown /> : statusLabel(replication.statusKey)}
              {canEdit && statuses.status === "ready" ? (
                <StatusChangeDialog
                  studyKey={studyKey}
                  currentStatusKey={replication.statusKey}
                  statuses={statusOptions}
                />
              ) : null}
            </span>
          </Detail>
          <Detail term="Public stage">
            {stageText({
              stageNumber: replication.publicStageNumber ?? null,
              stageName: replication.publicStageName ?? null,
            }) ?? <Unknown />}
          </Detail>
          <Detail term="Leads">
            {leadNamesLoading ? (
              <span className="text-fg-muted" aria-busy="true">
                Loading the names
              </span>
            ) : (
              <LeadsText row={{ leadNames, leadState }} />
            )}
          </Detail>
        </Details>
        {canEdit ? null : (
          <p className="text-xs text-fg-muted">
            The leads of this replication, the core team and programme administrators can edit it.
          </p>
        )}
      </header>
      {loading || selected === undefined ? (
        <LoadingState label="Loading the replication" />
      ) : (
        <Tabs value={selected.id} onValueChange={showTab}>
          <div className="relative overflow-x-auto">
            <TabsList aria-label="Sections of the replication" className="min-w-max">
              {present.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {TAB_LABELS[tab.id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {present.map((tab) => (
            <TabsContent key={tab.id} value={tab.id}>
              {tab.live.status === "loading" ? (
                <LoadingState label={`Loading the ${TAB_LABELS[tab.id].toLowerCase()}`} />
              ) : tab.live.status === "error" ? (
                <ErrorState
                  title={`The ${TAB_LABELS[tab.id].toLowerCase()} could not be loaded.`}
                  description="Reload the page to try again."
                  action={<Button onClick={retryFailedLiveData}>Try again</Button>}
                />
              ) : (
                tab.render()
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </>
  );
}

export function ReplicationPage() {
  const { studyKey = "" } = useParams();
  const viewer = useViewer();
  const replication = useLiveDocument("replications", studyKey === "" ? null : [studyKey]);
  const exists = replication.status === "ready" && replication.data !== null;
  useRecordVisit(exists && viewer?.access.member === true ? viewer.uid : null, "replication", exists ? studyKey : null);
  return (
    <LiveView
      live={replication}
      loadingLabel="Loading the replication"
      errorTitle="The replication could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <EmptyState
            title="This replication does not exist"
            description={`No replication has the identifier ${studyKey}. It may have been mistyped.`}
            action={
              <Button asChild>
                <Link to="/replications">Go to the list of replications</Link>
              </Button>
            }
          />
        ) : viewer === null ? (
          <LoadingState label="Checking your access" />
        ) : (
          <ReplicationRecord replication={record} viewer={viewer} />
        )
      }
    </LiveView>
  );
}
