import { laboratoryDetailDocSchema, laboratoryDocSchema } from "@eegml/shared";
import { type ReactNode, useMemo, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { Detail, Details } from "@/components/registry/details";
import { EditableField } from "@/components/registry/editable-field";
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
  saveLaboratoryDetail,
  updateLaboratoryFields,
  useLiveDocument,
  useLiveQuery,
} from "@/data";
import { ScopeDashboard } from "@/pages/dashboards/ScopeDashboard";
import { DatasetsTab } from "@/pages/datasets/DatasetsTab";
import { DriveLinks } from "@/pages/integrations/DriveLinks";
import { GeneratedDocuments } from "@/pages/integrations/GeneratedDocuments";
import { ParticipationCard } from "@/pages/participations/ParticipationCard";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import { EntityTasksTab } from "@/pages/tasks/EntityTasksTab";
import { UpdatesTab } from "@/pages/tasks/UpdatesTab";
import { NotesTab } from "@/pages/workspace/NotesTab";
import { combineLive, orEmpty } from "@/registry/combine";
import { countryName, LABORATORY_STATUS_LABELS, PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import { memberPath, replicationPath } from "@/registry/paths";
import {
  documentLinksOfLaboratory,
  equipmentOfLaboratory,
  generatedDocumentsOf,
  membersOfLaboratory,
  statusHistoryOfLaboratory,
  useInstitutions,
  useParticipations,
  usePersonNames,
  useRequirements,
} from "@/registry/queries";
import { useRecordVisit } from "@/registry/use-record-visit";
import { useViewer, type Viewer } from "@/registry/viewer";
import { EquipmentTab } from "./EquipmentTab";
import { LaboratoryMembersTab } from "./LaboratoryMembersTab";
import { RepresentDialog } from "./RepresentDialog";

const TAB_IDS = [
  "profile",
  "members",
  "equipment",
  "participations",
  "datasets",
  "documents",
  "activity",
  "tasks",
  "updates",
  "notes",
  "dashboard",
] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Readonly<Record<TabId, string>> = {
  profile: "Profile",
  members: "Members",
  equipment: "Equipment",
  participations: "Participations",
  datasets: "Datasets",
  documents: "Documents",
  activity: "Activity",
  tasks: "Tasks",
  updates: "Updates",
  notes: "Notes",
  dashboard: "Dashboard",
};

const ready = <T,>(live: Live<readonly T[]>): readonly T[] => (live.status === "ready" ? live.data : []);

/** A participation status in words, or its key where the portal no longer knows it. */
function statusText(key: string): string {
  const labels: Readonly<Record<string, string>> = PARTICIPATION_STATUS_LABELS;
  return (labels[key] ?? key).toLowerCase();
}

type Laboratory = RecordOf<"laboratories">;
type Entry = RecordOf<"laboratoryMembers">;

function PersonLink({ id, names }: { id: string; names: ReadonlyMap<string, string> }) {
  return (
    <Link to={memberPath(id)} className="text-fg-accent underline">
      {names.get(id) ?? id}
    </Link>
  );
}

function PeopleList({
  ids,
  names,
  none,
}: {
  ids: readonly string[];
  names: ReadonlyMap<string, string>;
  none: string;
}) {
  if (ids.length === 0) return <Unknown>{none}</Unknown>;
  return (
    <ul className="grid gap-1">
      {ids.map((id) => (
        <li key={id}>
          <PersonLink id={id} names={names} />
        </li>
      ))}
    </ul>
  );
}

function RestrictedDetail({ laboratory, canEdit, uid }: { laboratory: Laboratory; canEdit: boolean; uid: string }) {
  const detail = useLiveDocument("laboratoryDetail", [laboratory.id]);
  return (
    <Section title="Address and internal notes" testId="laboratory-detail">
      <p className="text-xs text-fg-muted">
        Visible to the members and coordinators of the laboratory, the core team and programme administrators.
      </p>
      <LiveView
        live={detail}
        loadingLabel="Loading the address and notes"
        errorTitle="The address and notes could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(stored) => (
          <Details>
            <EditableField
              label="Postal address"
              value={stored?.address}
              kind="longText"
              schema={laboratoryDetailDocSchema.shape.address}
              invalidMessage="Enter the address in up to 2,000 characters."
              canEdit={canEdit}
              onSave={(value) =>
                saveLaboratoryDetail(
                  uid,
                  laboratory.id,
                  { address: value === null ? null : String(value) },
                  stored !== null,
                )
              }
            />
            <EditableField
              label="Internal notes"
              value={stored?.internalNotes}
              kind="longText"
              schema={laboratoryDetailDocSchema.shape.internalNotes}
              invalidMessage="Shorten the notes to 10,000 characters or fewer."
              canEdit={canEdit}
              onSave={(value) =>
                saveLaboratoryDetail(
                  uid,
                  laboratory.id,
                  { internalNotes: value === null ? null : String(value) },
                  stored !== null,
                )
              }
            />
          </Details>
        )}
      </LiveView>
    </Section>
  );
}

function ProfileTab({
  laboratory,
  viewer,
  canEdit,
  institutionName,
  entries,
  personNames,
}: {
  laboratory: Laboratory;
  viewer: Viewer;
  canEdit: boolean;
  institutionName: string | null;
  entries: readonly Entry[];
  personNames: ReadonlyMap<string, string>;
}) {
  const confirmed = entries.filter((entry) => entry.status === "confirmed" && entry.archivedAt === null);
  const save = (field: string) => (value: string | number | boolean | null) =>
    updateLaboratoryFields(viewer.uid, laboratory.id, { [field]: value });
  const text = (field: "name" | "department" | "city" | "website" | "description", label: string) => (
    <EditableField
      label={label}
      value={laboratory[field]}
      kind={field === "website" ? "url" : field === "description" ? "longText" : "text"}
      schema={laboratoryDocSchema.shape[field]}
      invalidMessage={
        field === "website"
          ? "Enter a full web address that starts with https://."
          : field === "name"
            ? "Enter the name, up to 300 characters."
            : field === "description"
              ? "Shorten the description to 10,000 characters or fewer."
              : "Shorten the text to 300 characters or fewer."
      }
      canEdit={canEdit}
      onSave={(value) =>
        // A laboratory keeps its name: clearing it is refused before anything is sent.
        field === "name" && value === null
          ? Promise.reject(new Error("A laboratory keeps its name."))
          : save(field)(value)
      }
    />
  );
  return (
    <div className="grid gap-4">
      <Section title="Profile" testId="laboratory-profile">
        <Details>
          {text("name", "Name")}
          <Detail term="Institution">{institutionName ?? <Unknown />}</Detail>
          {text("department", "Department")}
          <Detail term="Country">
            {laboratory.countryCode === undefined ? <Unknown /> : countryName(laboratory.countryCode)}
          </Detail>
          {text("city", "City")}
          {text("website", "Website")}
          <Detail term="Principal investigator">
            {laboratory.piPersonId === undefined ? (
              <Unknown />
            ) : (
              <PersonLink id={laboratory.piPersonId} names={personNames} />
            )}
          </Detail>
          <Detail term="Coordinators">
            <PeopleList
              ids={confirmed.filter((entry) => entry.role === "coordinator").map((entry) => entry.personId)}
              names={personNames}
              none="No confirmed coordinator"
            />
          </Detail>
          <Detail term="Authorised representatives">
            <PeopleList
              ids={confirmed.filter((entry) => entry.isAuthorisedRepresentative).map((entry) => entry.personId)}
              names={personNames}
              none="No confirmed representative"
            />
          </Detail>
          {text("description", "Description")}
        </Details>
        {canEdit ? null : (
          <p className="text-xs text-fg-muted">
            The coordinators of this laboratory, the core team and programme administrators can edit it.
          </p>
        )}
      </Section>
      {viewer.readsLaboratoryDetail(laboratory.id) ? (
        <RestrictedDetail laboratory={laboratory} canEdit={canEdit} uid={viewer.uid} />
      ) : null}
    </div>
  );
}

interface ActivityEntry {
  readonly id: string;
  readonly at: Date;
  readonly title: ReactNode;
  readonly detail: string | null;
}

function ActivityTab({ entries }: { entries: readonly ActivityEntry[] }) {
  return (
    <ol className="grid gap-2" aria-label="Activity of the laboratory">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="grid gap-1 rounded-tile border border-border bg-surface px-4 py-3"
          data-testid="activity-entry"
        >
          <p className="font-medium text-fg-strong">{entry.title}</p>
          <p className="text-fg-secondary">
            <time dateTime={entry.at.toISOString()}>{formatDateTime(entry.at)}</time>
          </p>
          {entry.detail === null ? null : <p>{entry.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

interface TabSpec {
  readonly id: TabId;
  readonly live: Live<boolean>;
  readonly render: () => ReactNode;
}

const NO_PERSON_NAMES: ReadonlyMap<string, string> = new Map();

function LaboratoryRecord({ laboratory, viewer }: { laboratory: Laboratory; viewer: Viewer }) {
  const [params, setParams] = useSearchParams();
  const institutions = useInstitutions();
  const allParticipations = useParticipations();
  const requirements = useRequirements();
  const entries = useLiveQuery(membersOfLaboratory(laboratory.id));
  const configurations = useLiveQuery(equipmentOfLaboratory(laboratory.id));
  const history = useLiveQuery(statusHistoryOfLaboratory(laboratory.id));
  // Only the people the page names are read: the principal investigator, the member entries and
  // the local leads of the participations.
  const named = [
    ...(laboratory.piPersonId === undefined ? [] : [laboratory.piPersonId]),
    ...ready(entries).map((entry) => entry.personId),
    ...ready(allParticipations).flatMap((participation) =>
      participation.laboratoryId === laboratory.id && participation.localLeadPersonId !== undefined
        ? [participation.localLeadPersonId]
        : [],
    ),
  ];
  const names = usePersonNames(named);
  const personNames = names.status === "ready" ? names.data : NO_PERSON_NAMES;
  const institutionName =
    laboratory.institutionId === undefined
      ? null
      : (ready(institutions).find((institution) => institution.id === laboratory.institutionId)?.name ??
        laboratory.institutionId);
  const participations = ready(allParticipations).filter(
    (participation) => participation.laboratoryId === laboratory.id && participation.archivedAt === null,
  );
  const current = viewer.access.member && laboratory.archivedAt === null;
  const canEdit = current && viewer.can("labs.manage", { laboratoryId: laboratory.id });
  const links = orEmpty(
    useLiveQuery(
      viewer.queryScopeKeys.length === 0 ? null : documentLinksOfLaboratory(laboratory.id, viewer.queryScopeKeys),
    ),
  );
  const generated = orEmpty(
    useLiveQuery(
      viewer.queryScopeKeys.length === 0
        ? null
        : generatedDocumentsOf("laboratory", laboratory.id, viewer.queryScopeKeys),
    ),
  );
  const confirmedEntry = ready(entries).find(
    (entry) => entry.personId === viewer.personId && entry.status === "confirmed" && entry.archivedAt === null,
  );
  const represents =
    confirmedEntry !== undefined &&
    (confirmedEntry.isAuthorisedRepresentative || confirmedEntry.role === "coordinator");
  // Offered only once the entries are known, so that a coordinator never sees it while they load.
  const offersClaim = current && entries.status === "ready" && viewer.personId !== null && !represents;

  const activity = useMemo<ActivityEntry[]>(
    () =>
      [
        ...ready(history).map((entry) => ({
          id: entry.id,
          at: entry.effectiveAt.toDate(),
          title: (
            <>
              <Link to={replicationPath(entry.replicationId ?? "")} className="text-fg-accent underline">
                {entry.replicationId}
              </Link>
              {": "}
              {entry.fromStatusKey === null
                ? `participation ${statusText(entry.toStatusKey)}`
                : `participation moved from ${statusText(entry.fromStatusKey)} to ${statusText(entry.toStatusKey)}`}
            </>
          ),
          detail: entry.reason ?? null,
        })),
        ...ready(configurations).map((configuration) => ({
          id: `equipment-${configuration.id}`,
          at: configuration.validFrom.toDate(),
          title:
            configuration.supersedesId === null
              ? `Equipment configuration ${configuration.name} recorded`
              : `Equipment configuration ${configuration.name} replaced its earlier version`,
          detail: null,
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime()),
    [history, configurations],
  );

  const tabs: readonly TabSpec[] = [
    {
      id: "profile",
      live: combineLive([entries, names] as const, () => true),
      render: () => (
        <ProfileTab
          laboratory={laboratory}
          viewer={viewer}
          canEdit={canEdit}
          institutionName={institutionName}
          entries={ready(entries)}
          personNames={personNames}
        />
      ),
    },
    {
      id: "members",
      // Those who manage the laboratory see the tab without members too, to propose the first.
      live: combineLive([entries] as const, (list) => list.some((entry) => entry.archivedAt === null) || canEdit),
      render: () => (
        <LaboratoryMembersTab
          uid={viewer.uid}
          laboratoryId={laboratory.id}
          laboratoryName={laboratory.name}
          entries={ready(entries)}
          personNames={personNames}
          canManage={canEdit}
          canConfirm={current && viewer.can("labs.manage", "programme")}
        />
      ),
    },
    {
      id: "equipment",
      live: combineLive([configurations] as const, (list) => list.length > 0 || canEdit),
      render: () => (
        <EquipmentTab
          laboratoryId={laboratory.id}
          laboratoryName={laboratory.name}
          configurations={ready(configurations)}
          canEdit={canEdit}
        />
      ),
    },
    {
      id: "participations",
      live: combineLive([allParticipations, requirements, configurations] as const, () => participations.length > 0),
      render: () => (
        <div className="grid gap-3">
          {participations
            .sort((a, b) => a.replicationId.localeCompare(b.replicationId, "en"))
            .map((participation) => (
              <ParticipationCard
                key={participation.id}
                participation={participation}
                viewer={viewer}
                title={
                  <Link to={replicationPath(participation.replicationId)} className="hover:text-fg-accent">
                    {participation.replicationId}
                  </Link>
                }
                label={`${laboratory.name} in ${participation.replicationId}`}
                requirements={ready(requirements).filter(
                  (requirement) =>
                    requirement.replicationId === participation.replicationId && requirement.archivedAt === null,
                )}
                currentConfigurations={ready(configurations).filter(
                  (configuration) => configuration.isCurrent && configuration.archivedAt === null,
                )}
                personNames={personNames}
              />
            ))}
        </div>
      ),
    },
    // Every laboratory has a registry of datasets, which every member reads.
    {
      id: "datasets",
      live: { status: "ready", data: true, fromCache: false, hasPendingWrites: false },
      render: () => <DatasetsTab viewer={viewer} laboratoryId={laboratory.id} />,
    },
    {
      id: "documents",
      // Those who manage the laboratory see the tab without documents too, to link the first.
      live: combineLive(
        [links, generated] as const,
        (list, documents) =>
          list.some((link) => link.archivedAt === null) ||
          documents.length > 0 ||
          canEdit ||
          viewer.can("integrations.manage", "programme"),
      ),
      render: () => (
        <div className="grid gap-8">
          <DriveLinks
            links={ready(links)}
            canLink={canEdit}
            targets={[
              {
                value: "laboratory",
                label: `The laboratory ${laboratory.name}`,
                entityType: "laboratory",
                entityId: laboratory.id,
              },
            ]}
            caption="Documents linked to the laboratory"
          />
          <GeneratedDocuments
            entityType="laboratory"
            entityId={laboratory.id}
            scopeKeys={viewer.queryScopeKeys}
            canGenerate={canEdit || viewer.can("integrations.manage", "programme")}
          />
        </div>
      ),
    },
    {
      id: "activity",
      live: combineLive([history, configurations] as const, () => activity.length > 0),
      render: () => <ActivityTab entries={activity} />,
    },
    // Every laboratory has tasks and a log of progress updates, which every member may read.
    {
      id: "tasks",
      live: { status: "ready", data: true, fromCache: false, hasPendingWrites: false },
      render: () => <EntityTasksTab viewer={viewer} entityType="laboratory" entityId={laboratory.id} />,
    },
    {
      id: "updates",
      live: { status: "ready", data: true, fromCache: false, hasPendingWrites: false },
      render: () => (
        <UpdatesTab
          viewer={viewer}
          entityType="laboratory"
          entityId={laboratory.id}
          canPost={
            viewer.access.member &&
            (viewer.readsLaboratoryDetail(laboratory.id) || viewer.can("labs.manage", { laboratoryId: laboratory.id }))
          }
        />
      ),
    },
    // Every laboratory has notes, which every member may read.
    {
      id: "notes",
      live: { status: "ready", data: true, fromCache: false, hasPendingWrites: false },
      render: () => <NotesTab entityType="laboratory" entityId={laboratory.id} />,
    },
    // Every laboratory has a dashboard, which every member may read.
    {
      id: "dashboard",
      live: { status: "ready", data: true, fromCache: false, hasPendingWrites: false },
      render: () => <ScopeDashboard scopeType="laboratory" scopeId={laboratory.id} />,
    },
  ];

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
  const selected = present.find((tab) => tab.id === params.get("tab")) ?? present[0];
  const showTab = (value: string) =>
    setParams(
      (currentParams) => {
        const next = new URLSearchParams(currentParams);
        if (value === "profile") next.delete("tab");
        else next.set("tab", value);
        return next;
      },
      { replace: true },
    );
  const otherTabs = loading ? [] : present.filter((tab) => tab.id !== selected?.id).map((tab) => tab.id);
  usePaletteActions(
    otherTabs.map((id) => ({
      id: `tab-${id}`,
      label: `Show the ${TAB_LABELS[id].toLowerCase()} of ${laboratory.name}`,
      run: () => showTab(id),
    })),
    `${laboratory.id}:${otherTabs.join(",")}`,
  );

  return (
    <>
      <header className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="text-2xl text-fg">{laboratory.name}</h1>
            {institutionName === null ? null : <p className="text-md text-fg-secondary">{institutionName}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <OriginBadge origin={laboratory.dataOrigin} showLive />
              <Badge tone="outline">{LABORATORY_STATUS_LABELS[laboratory.status]}</Badge>
              {laboratory.archivedAt === null ? null : <Badge tone="accent">Archived</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {offersClaim ? <RepresentDialog laboratoryId={laboratory.id} laboratoryName={laboratory.name} /> : null}
            {viewer.access.member ? (
              <FavouriteButton
                uid={viewer.uid}
                entityType="laboratory"
                entityId={laboratory.id}
                name={laboratory.name}
              />
            ) : null}
          </div>
        </div>
      </header>
      {loading || selected === undefined ? (
        <LoadingState label="Loading the laboratory" />
      ) : (
        <Tabs value={selected.id} onValueChange={showTab}>
          <HorizontalScroll>
            <TabsList aria-label="Sections of the laboratory" className="min-w-max">
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

export function LaboratoryPage() {
  const { laboratoryId = "" } = useParams();
  const viewer = useViewer();
  const laboratory = useLiveDocument("laboratories", laboratoryId === "" ? null : [laboratoryId]);
  const exists = laboratory.status === "ready" && laboratory.data !== null;
  useRecordVisit(
    exists && viewer?.access.member === true ? viewer.uid : null,
    "laboratory",
    exists ? laboratoryId : null,
  );
  return (
    <LiveView
      live={laboratory}
      loadingLabel="Loading the laboratory"
      errorTitle="The laboratory could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <EmptyState
            title="This laboratory does not exist"
            description="No laboratory has this address. It may have been mistyped, or the registration may still wait for review."
            action={
              <Button asChild>
                <Link to="/labs">Go to the list of laboratories</Link>
              </Button>
            }
          />
        ) : viewer === null ? (
          <LoadingState label="Checking your access" />
        ) : (
          <LaboratoryRecord laboratory={record} viewer={viewer} />
        )
      }
    </LiveView>
  );
}
