import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { useNavigableCapabilities } from "@/auth/use-privilege";
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
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Live,
  type RecordOf,
  retryFailedLiveData,
  useLiveDocument,
  useLiveDocumentsAt,
  useLiveQuery,
} from "@/data";
import { ScopeDashboard } from "@/pages/dashboards/ScopeDashboard";
import { DatasetsTab } from "@/pages/datasets/DatasetsTab";
import { RecruitmentTab } from "@/pages/recruitment/RecruitmentTab";
import { AnalysisTab } from "@/pages/science/AnalysisTab";
import { DecisionsTab } from "@/pages/science/DecisionsTab";
import { IncidentsTab } from "@/pages/science/IncidentsTab";
import type { OutputContext } from "@/pages/science/OutputCard";
import { OutputsTab, ReportsTab } from "@/pages/science/OutputsTabs";
import { ProtocolTab } from "@/pages/science/ProtocolTab";
import { RisksTab } from "@/pages/science/RisksTab";
import { EntityTasksTab } from "@/pages/tasks/EntityTasksTab";
import { UpdatesTab } from "@/pages/tasks/UpdatesTab";
import { NotesTab } from "@/pages/workspace/NotesTab";
import { combineLive, orEmpty } from "@/registry/combine";
import {
  ALL_PERSONS,
  aliasesOfReplication,
  CONFIRMED_MEMBERSHIPS,
  contributorsOfReplication,
  documentLinksOfReplication,
  generatedDocumentsOf,
  historicalAggregatesOfReplication,
  hypothesesOfReplication,
  membershipsOfReplication,
  statusHistoryOfReplication,
  useCurrentEquipment,
  useDatasets,
  useDirectoryItems,
  useLaboratories,
  useManuscripts,
  useParticipations,
  usePersonNames,
  useReplicationStatuses,
  useRequirements,
} from "@/registry/queries";
import {
  acknowledgementsOfReplication,
  analysisRunsOfReplication,
  authorshipListsOfReplication,
  decisionsOfReplication,
  deviationsOfReplication,
  incidentActionsOfReplication,
  incidentsOfReplication,
  predictionItemsOfReplication,
  protocolsOfReplication,
  protocolVersionsOfReplication,
  type ReadScope,
  risksOfReplication,
  taskListsOfReplication,
  teamMembersOfReplication,
} from "@/registry/scientific-queries";
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

const TAB_IDS = [
  "overview",
  "leadership",
  "laboratories",
  "recruitment",
  "datasets",
  "hypotheses",
  "protocol",
  "reports",
  "analysis",
  "outputs",
  "decisions",
  "incidents",
  "risks",
  "contributors",
  "documents",
  "activity",
  "tasks",
  "updates",
  "notes",
  "dashboard",
] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Readonly<Record<TabId, string>> = {
  overview: "Overview",
  leadership: "Leadership",
  laboratories: "Laboratories",
  recruitment: "Recruitment",
  datasets: "Datasets",
  hypotheses: "Hypotheses",
  protocol: "Protocol",
  reports: "Registered Reports",
  analysis: "Analysis",
  outputs: "Outputs",
  decisions: "Decisions",
  incidents: "Incidents",
  risks: "Risks",
  contributors: "Contributors",
  documents: "Documents",
  activity: "Activity",
  tasks: "Tasks",
  updates: "Updates",
  notes: "Notes",
  dashboard: "Dashboard",
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

/** A tab that every reader of the record has. */
const ALWAYS: Live<boolean> = { status: "ready", data: true, fromCache: false, hasPendingWrites: false };

function ReplicationRecord({ replication, viewer }: { replication: RecordOf<"replications">; viewer: Viewer }) {
  const { studyKey } = replication;
  const [params, setParams] = useSearchParams();
  const statuses = useReplicationStatuses();
  const member = viewer.access.member;
  const addsLaboratories =
    member && replication.archivedAt === null && viewer.can("participations.manage", { replicationId: studyKey });
  // Those who manage the replication manage its outputs and their authorship lists too, which
  // the functions decide again.
  const managesOutputs =
    member && replication.archivedAt === null && viewer.can("replications.manage", { replicationId: studyKey });
  // The directory serves the choice of a local lead when a laboratory is added, and of an author
  // who is in no contributor table, so only those who do either read it.
  // A coordinator of a laboratory chooses the team of its participation from the directory too.
  const managesTeams =
    member &&
    replication.archivedAt === null &&
    (addsLaboratories || viewer.access.coordinatorLaboratoryIds.length > 0);
  const persons = useDirectoryItems(addsLaboratories || managesOutputs || managesTeams ? ALL_PERSONS : null);
  const laboratories = useLaboratories();
  const allParticipations = useParticipations();
  const allManuscripts = useManuscripts();
  const currentEquipment = useCurrentEquipment();
  const allRequirements = useRequirements();
  const team = viewer.readsTeamOf(studyKey);
  // What a decision of the programme seals is read by programme administrators alone.
  const sealedReader = useNavigableCapabilities().has("sealed.read");
  const teamMemberships = orEmpty(useLiveQuery(team ? membershipsOfReplication(studyKey) : null));
  const confirmedMemberships = orEmpty(useLiveQuery(team ? null : CONFIRMED_MEMBERSHIPS));
  const aliases = useLiveQuery(aliasesOfReplication(studyKey));
  const hypotheses = useLiveQuery(hypothesesOfReplication(studyKey));
  // The prediction-market data of the replication, its outcome and null-significance labels and the links to the
  // market's documents, are sealed by decisions of the programme: programme administrators alone read them.
  const outcomes = useLiveDocument("predictionMarketOutcomes", sealedReader ? [studyKey] : null);
  // The summary figures of the historical workbooks are sealed: programme administrators alone read them.
  const aggregates = orEmpty(useLiveQuery(sealedReader ? historicalAggregatesOfReplication(studyKey) : null));
  // The contributor lists are read by the team of the replication, by a decision of the programme.
  const contributors = orEmpty(useLiveQuery(team ? contributorsOfReplication(studyKey) : null));
  const links = useLiveQuery(documentLinksOfReplication(studyKey, viewer.queryScopeKeys));
  const generated = orEmpty(
    useLiveQuery(
      viewer.queryScopeKeys.length === 0 ? null : generatedDocumentsOf("replication", studyKey, viewer.queryScopeKeys),
    ),
  );
  const history = useLiveQuery(statusHistoryOfReplication(studyKey));

  // The scientific workflows. What is read within scope is read by the keys the viewer holds, and
  // not at all by a viewer who holds none.
  const readScope: ReadScope | null = viewer.staff
    ? "all"
    : viewer.queryScopeKeys.length === 0
      ? null
      : viewer.queryScopeKeys;
  const scoped = <T,>(query: (studyKey: string, scope: ReadScope) => T): T | null =>
    readScope === null ? null : query(studyKey, readScope);
  const protocols = useLiveQuery(protocolsOfReplication(studyKey));
  const protocolVersions = useLiveQuery(protocolVersionsOfReplication(studyKey));
  const decisions = useLiveQuery(decisionsOfReplication(studyKey));
  // The questions of the prediction market are sealed by a decision of the programme: programme administrators alone read them.
  const predictionItems = orEmpty(useLiveQuery(sealedReader ? predictionItemsOfReplication(studyKey) : null));
  const runs = orEmpty(useLiveQuery(scoped(analysisRunsOfReplication)));
  const incidents = orEmpty(useLiveQuery(scoped(incidentsOfReplication)));
  const incidentActions = orEmpty(useLiveQuery(scoped(incidentActionsOfReplication)));
  const risks = orEmpty(useLiveQuery(scoped(risksOfReplication)));
  const authorshipLists = orEmpty(useLiveQuery(scoped(authorshipListsOfReplication)));
  const teamMembers = orEmpty(useLiveQuery(scoped(teamMembersOfReplication)));
  const acknowledgements = orEmpty(useLiveQuery(scoped(acknowledgementsOfReplication)));
  const deviations = orEmpty(useLiveQuery(scoped(deviationsOfReplication)));
  const taskLists = orEmpty(useLiveQuery(managesOutputs ? scoped(taskListsOfReplication) : null));

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
  const allDatasets = useDatasets();
  const datasets = useMemo<Live<readonly RecordOf<"datasets">[]>>(
    () =>
      allDatasets.status === "ready"
        ? { ...allDatasets, data: allDatasets.data.filter((item) => item.replicationId === studyKey) }
        : allDatasets,
    [allDatasets, studyKey],
  );
  const manuscripts = useMemo<Live<readonly RecordOf<"manuscripts">[]>>(
    () =>
      allManuscripts.status === "ready"
        ? { ...allManuscripts, data: allManuscripts.data.filter((item) => item.replicationId === studyKey) }
        : allManuscripts,
    [allManuscripts, studyKey],
  );

  const milestoneIds = useMemo(
    () =>
      ready(manuscripts).flatMap((manuscript) =>
        Object.values(manuscript.milestoneTaskIds ?? {}).map((id) => [id] as [string]),
      ),
    [manuscripts],
  );
  const watchedMilestones = useLiveDocumentsAt("tasks", milestoneIds);
  // No milestone planned is no milestone to read.
  const milestoneTasks: Live<ReadonlyMap<string, RecordOf<"tasks">>> =
    watchedMilestones.status === "idle"
      ? { status: "ready", data: new Map(), fromCache: false, hasPendingWrites: false }
      : watchedMilestones;

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
  const laboratoryNames = new Map(ready(laboratories).map((laboratory) => [laboratory.id, laboratory.name]));
  const outputContext: OutputContext = {
    studyKey,
    readScope: readScope ?? [],
    uid: viewer.uid,
    manages: managesOutputs,
    manuscripts: ready(manuscripts),
    hypotheses: ready(hypotheses),
    datasets: ready(datasets),
    links: ready(links),
    lists: ready(taskLists),
    milestones: milestoneTasks.status === "ready" ? milestoneTasks.data : new Map(),
  };

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
    // Every replication has recruitment, whose reports its team and laboratories read and whose
    // latest totals every member reads.
    { id: "recruitment", live: ALWAYS, render: () => <RecruitmentTab viewer={viewer} studyKey={studyKey} /> },
    // Every replication has a registry of datasets, which every member reads.
    { id: "datasets", live: ALWAYS, render: () => <DatasetsTab viewer={viewer} replicationId={studyKey} /> },
    {
      id: "hypotheses",
      // An administrator waits for the sealed labels too, so that none is shown as missing while it loads.
      live: sealedReader && outcomes.status === "loading" ? { status: "loading" } : hasAny(hypotheses),
      render: () => (
        <HypothesesTab
          studyKey={studyKey}
          hypotheses={ready(hypotheses)}
          sealed={
            sealedReader && outcomes.status === "ready"
              ? {
                  replicated: outcomes.data?.labelsSource ?? {},
                  nullSig: outcomes.data?.nullSigSource ?? {},
                  studyDescriptionUrl: outcomes.data?.studyDescriptionUrl,
                  infosheetUrl: outcomes.data?.infosheetUrl,
                }
              : null
          }
          runs={ready(runs)}
          manuscripts={ready(manuscripts)}
          predictionItems={sealedReader ? ready(predictionItems) : null}
          canRecord={managesOutputs}
        />
      ),
    },
    // Every replication has a protocol, Registered Reports, analyses, outputs, a decision log and
    // an incident registry, which say so while they are empty.
    {
      id: "protocol",
      live: combineLive(
        [protocols, protocolVersions, participations, teamMembers, acknowledgements, deviations, laboratories] as const,
        () => true,
      ),
      render: () => (
        <ProtocolTab
          studyKey={studyKey}
          viewer={viewer}
          protocols={ready(protocols)}
          versions={ready(protocolVersions)}
          participations={ready(participations)}
          laboratoryNames={laboratoryNames}
          teamMembers={ready(teamMembers)}
          acknowledgements={ready(acknowledgements)}
          deviations={ready(deviations)}
          persons={ready(persons)}
        />
      ),
    },
    {
      id: "reports",
      live: combineLive([manuscripts, links, taskLists, milestoneTasks] as const, () => true),
      render: () => <ReportsTab context={outputContext} />,
    },
    {
      id: "analysis",
      live: combineLive([runs, datasets, hypotheses] as const, () => true),
      render: () => (
        <AnalysisTab
          studyKey={studyKey}
          viewer={viewer}
          runs={ready(runs)}
          datasets={ready(datasets)}
          hypotheses={ready(hypotheses)}
        />
      ),
    },
    {
      id: "outputs",
      live: combineLive(
        [manuscripts, links, authorshipLists, contributors, taskLists, milestoneTasks, orEmpty(persons)] as const,
        () => true,
      ),
      render: () => (
        <OutputsTab
          context={outputContext}
          lists={new Map(ready(authorshipLists).map((list) => [list.manuscriptId, list]))}
          contributors={ready(contributors)}
          persons={ready(persons)}
        />
      ),
    },
    {
      id: "decisions",
      live: combineLive([decisions, deviations] as const, () => true),
      render: () => (
        <DecisionsTab
          studyKey={studyKey}
          viewer={viewer}
          entries={ready(decisions)}
          deviations={ready(deviations)}
          laboratoryNames={laboratoryNames}
        />
      ),
    },
    {
      id: "incidents",
      live: combineLive([incidents, incidentActions, participations, deviations, laboratories] as const, () => true),
      render: () => (
        <IncidentsTab
          studyKey={studyKey}
          viewer={viewer}
          incidents={ready(incidents)}
          actions={ready(incidentActions)}
          participations={ready(participations)}
          laboratoryNames={laboratoryNames}
          deviations={ready(deviations)}
        />
      ),
    },
    {
      id: "risks",
      live: combineLive([risks] as const, () => true),
      render: () => <RisksTab studyKey={studyKey} viewer={viewer} risks={ready(risks)} persons={ready(persons)} />,
    },
    {
      id: "contributors",
      live: hasAny(contributors),
      render: () => <ContributorsTab contributors={ready(contributors)} origin={replication.dataOrigin} />,
    },
    {
      id: "documents",
      // Those who manage the replication see the tab without documents too, to link the first.
      live: combineLive(
        [links, manuscripts, generated, datasets] as const,
        (list, _manuscripts, documents) =>
          list.some((link) => link.archivedAt === null) ||
          documents.length > 0 ||
          (viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey })) ||
          viewer.can("integrations.manage", "programme"),
      ),
      render: () => (
        <DocumentsTab
          studyKey={studyKey}
          links={ready(links)}
          manuscripts={ready(manuscripts)}
          datasets={ready(datasets)}
          viewer={viewer}
        />
      ),
    },
    {
      id: "activity",
      live: hasAny(history),
      render: () => <ActivityTab entries={ready(history)} statusLabel={statusLabel} />,
    },
    // Every replication has tasks and a log of progress updates, which every member may read.
    {
      id: "tasks",
      live: ALWAYS,
      render: () => <EntityTasksTab viewer={viewer} entityType="replication" entityId={studyKey} />,
    },
    {
      id: "updates",
      live: ALWAYS,
      render: () => (
        <UpdatesTab
          viewer={viewer}
          entityType="replication"
          entityId={studyKey}
          canPost={member && (team || viewer.can("replications.manage", { replicationId: studyKey }))}
        />
      ),
    },
    // Every replication has notes, which every member may read.
    { id: "notes", live: ALWAYS, render: () => <NotesTab entityType="replication" entityId={studyKey} /> },
    // Every replication has a dashboard, which every member may read.
    { id: "dashboard", live: ALWAYS, render: () => <ScopeDashboard scopeType="replication" scopeId={studyKey} /> },
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
          <HorizontalScroll>
            <TabsList aria-label="Sections of the replication" className="min-w-max">
              {present.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {TAB_LABELS[tab.id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </HorizontalScroll>
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
