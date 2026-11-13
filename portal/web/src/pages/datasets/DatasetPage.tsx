// The record page of a dataset (acceptance scenario 8): what it is, where its copies are held and
// whether they could be reached, its files against what was expected, its transfers, its quality
// control and BIDS status, its history and, for those who may read paths, who read them. Every
// member reads the overview; what sits beneath the dataset is read within its scope; paths,
// listings and the BIDS report only by its leads, the laboratory's coordinators and the
// programme. Nothing here needs a viewer such as ElectroTag, and no data passes through the
// portal.
import {
  canTransition,
  claimsChecksPassed,
  type DatasetWorkflow,
  DEFAULT_DATASET_WORKFLOW,
  datasetContradictions,
  setDatasetStatusContract,
  workflowState,
} from "@eegml/shared";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { usePaletteActions } from "@/app/shell/palette-actions";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { Detail, Details } from "@/components/registry/details";
import { FavouriteButton } from "@/components/registry/favourite-button";
import { FollowButton } from "@/components/registry/follow-button";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type Live, type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { DriveLinks } from "@/pages/integrations/DriveLinks";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import { orEmpty } from "@/registry/combine";
import {
  accessEventsOf,
  deviationsOfParticipation,
  documentLinksOfDataset,
  manifestsOf,
  qcAssessmentsOf,
  statusHistoryOfDataset,
  storageRefsOf,
  transfersOf,
} from "@/registry/dataset-queries";
import { DATASETS_PATH, laboratoryPath, replicationPath } from "@/registry/paths";
import { useDatasetWorkflows, useLaboratories, usePersonNames, useStorageEndpoints } from "@/registry/queries";
import { EXCLUSION_REASONS_QUERY } from "@/registry/recruitment-data";
import { useRecordVisit } from "@/registry/use-record-visit";
import { useViewer, type Viewer } from "@/registry/viewer";
import { BidsSection } from "./BidsSection";
import { FormDialog, useAction } from "./dataset-actions";
import {
  AVAILABILITY_LABELS,
  BIDS_STATUS_LABELS,
  datasetScope,
  formatBytes,
  MODALITY_LABELS,
  managesDataset,
  pathsUnit,
  QC_STATUS_LABELS,
  readsPaths as readsPathsOf,
} from "./dataset-format";
import { FilesSection } from "./FilesSection";
import { QualitySection } from "./QualitySection";
import { StorageSection } from "./StorageSection";
import { TransfersSection } from "./TransfersSection";

const TAB_IDS = [
  "overview",
  "storage",
  "files",
  "transfers",
  "quality",
  "bids",
  "history",
  "access",
  "documents",
] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Readonly<Record<TabId, string>> = {
  overview: "Overview",
  storage: "Storage",
  files: "Files",
  transfers: "Transfers",
  quality: "Quality control",
  bids: "BIDS",
  history: "History",
  access: "Access record",
  documents: "Documents",
};

interface TabSpec {
  readonly id: TabId;
  readonly live: Live<boolean>;
  readonly render: () => ReactNode;
}

const ALWAYS: Live<boolean> = { status: "ready", data: true, fromCache: false, hasPendingWrites: false };
const NEVER: Live<boolean> = { status: "ready", data: false, fromCache: false, hasPendingWrites: false };
const ready = <T,>(live: Live<readonly T[]>): readonly T[] => (live.status === "ready" ? live.data : []);
const present = <T,>(live: Live<T>): Live<boolean> =>
  live.status === "ready" ? { ...live, data: true } : (live as Live<boolean>);

function StatusDialog({
  dataset,
  workflow,
  onClose,
}: {
  dataset: RecordOf<"datasets">;
  workflow: DatasetWorkflow;
  onClose: () => void;
}) {
  const action = useAction();
  const options = workflow.states.filter((state) => canTransition(workflow, dataset.workflowStatusKey, state.key));
  const [to, setTo] = useState(options[0]?.key ?? "");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const target = options.find((state) => state.key === to);
  // What the record says against a state that claims the checks have passed. The function
  // decides again and keeps the acknowledged problems with the move.
  const contradictions = target !== undefined && claimsChecksPassed(target) ? datasetContradictions(dataset) : [];
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Change the state"
      description="The workflow of the replication decides which state may follow. The change is kept in the history."
      submitLabel="Change the state"
      failureTitle="The state did not change."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const unacknowledged = contradictions.length > 0 && !acknowledged;
        setProblem(unacknowledged ? "Tick that you move the dataset despite the problems listed." : null);
        if (unacknowledged) return;
        if (
          await action.run(
            () =>
              callFunction(setDatasetStatusContract, {
                datasetKey: dataset.id,
                fromStatusKey: dataset.workflowStatusKey,
                toStatusKey: to,
                reason: reason.trim(),
                ...(contradictions.length > 0 ? { acknowledgeContradictions: true } : {}),
              }),
            "The state has been changed.",
            "The state could not be changed. Try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="New state">
        {(control) => (
          <Select {...control} value={to} onChange={(event) => setTo(event.target.value)}>
            {options.map((state) => (
              <option key={state.key} value={state.key}>
                {state.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {contradictions.length === 0 ? null : (
        <div
          className="grid gap-2 rounded-control border border-accent-strong p-3 text-sm"
          data-testid="state-contradictions"
        >
          <p className="font-medium">{target?.label} says the checks have passed, but the record says otherwise:</p>
          <ul className="list-disc pl-5">
            {contradictions.map((item) => (
              <li key={item}>{`${item.charAt(0).toUpperCase()}${item.slice(1)}.`}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            Move it anyway. These problems are kept with the reason.
          </label>
        </div>
      )}
      <FormField label="Reason">
        {(control) => (
          <Textarea {...control} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

function DatasetRecord({ dataset, viewer }: { dataset: RecordOf<"datasets">; viewer: Viewer }) {
  const [params, setParams] = useSearchParams();
  const [changing, setChanging] = useState(false);
  const manages = viewer.access.member && managesDataset(viewer, dataset) && dataset.archivedAt === null;
  const readsPaths = readsPathsOf(viewer, dataset);
  const scope = datasetScope(viewer, dataset);
  const unit = pathsUnit(viewer, dataset);
  const workflows = useDatasetWorkflows();
  const workflow = useMemo(
    () =>
      (workflows.status === "ready"
        ? workflows.data.find((candidate) => candidate.replicationId === dataset.replicationId)
        : undefined) ?? DEFAULT_DATASET_WORKFLOW,
    [workflows, dataset.replicationId],
  );
  const laboratories = useLaboratories();
  const endpoints = useStorageEndpoints();
  const refs = orEmpty(useLiveQuery(storageRefsOf(dataset.id, scope)));
  const transfers = orEmpty(useLiveQuery(transfersOf(dataset.id, scope)));
  const assessments = orEmpty(useLiveQuery(qcAssessmentsOf(dataset.id, scope)));
  const manifests = orEmpty(useLiveQuery(manifestsOf(dataset.id, unit)));
  const events = orEmpty(useLiveQuery(accessEventsOf(dataset.id, unit)));
  const history = useLiveQuery(statusHistoryOfDataset(dataset.id));
  const deviations = orEmpty(useLiveQuery(deviationsOfParticipation(dataset.participationId, scope)));
  const reasons = orEmpty(useLiveQuery(EXCLUSION_REASONS_QUERY));
  const detail = useLiveDocument("datasetDetail", readsPaths ? [dataset.id] : null);
  const links = orEmpty(
    useLiveQuery(viewer.queryScopeKeys.length === 0 ? null : documentLinksOfDataset(dataset.id, viewer.queryScopeKeys)),
  );
  const names = usePersonNames(dataset.storageOwnerPersonId === undefined ? [] : [dataset.storageOwnerPersonId]);
  const laboratoryName =
    dataset.laboratoryId === null
      ? null
      : ((laboratories.status === "ready"
          ? laboratories.data.find((lab) => lab.id === dataset.laboratoryId)?.name
          : undefined) ?? dataset.laboratoryId);
  const state = workflowState(workflow, dataset.workflowStatusKey);
  const stateLabel = state?.label ?? dataset.workflowStatusKey;
  const detailData = detail.status === "ready" ? detail.data : null;
  const endpointList = endpoints.status === "ready" ? endpoints.data : [];
  const endpointName = (key: string) => endpointList.find((endpoint) => endpoint.id === key)?.name ?? key;
  const nextStates = workflow.states.filter((candidate) =>
    canTransition(workflow, dataset.workflowStatusKey, candidate.key),
  );
  const stateLabelOf = (key: string | null) =>
    key === null
      ? "None"
      : (workflowState(workflow, key)?.label ??
        DEFAULT_DATASET_WORKFLOW.states.find((candidate) => candidate.key === key)?.label ??
        key);

  const tabs: readonly TabSpec[] = [
    {
      id: "overview",
      live: present(laboratories),
      render: () => (
        <div className="grid gap-4">
          <Section
            title="Workflow"
            aside={
              manages && nextStates.length > 0 ? (
                <Button size="sm" onClick={() => setChanging(true)}>
                  Change the state
                </Button>
              ) : null
            }
          >
            <p className="text-sm">
              <span className="font-medium">{stateLabel}</span>
              {dataset.analysisReady && !/analysis ready/i.test(stateLabel) ? (
                <Badge className="ml-2" tone="solid">
                  Ready for analysis
                </Badge>
              ) : null}
            </p>
            {nextStates.length === 0 ? null : (
              <p className="text-xs text-fg-secondary">
                Next: {nextStates.map((candidate) => candidate.label).join(", ")}
              </p>
            )}
          </Section>
          <Section title="About the dataset">
            <Details>
              <Detail term="Replication">
                <Link to={replicationPath(dataset.replicationId)} className="text-fg-accent underline">
                  {dataset.replicationId}
                </Link>
              </Detail>
              <Detail term="Laboratory">
                {dataset.laboratoryId === null ? (
                  <Unknown>None</Unknown>
                ) : (
                  <Link to={laboratoryPath(dataset.laboratoryId)} className="text-fg-accent underline">
                    {laboratoryName}
                  </Link>
                )}
              </Detail>
              <Detail term="Modality">{MODALITY_LABELS[dataset.modality]}</Detail>
              <Detail term="Session or grouping">{dataset.groupingLabel ?? <Unknown />}</Detail>
              <Detail term="Storage owner">
                {dataset.storageOwnerPersonId === undefined ? (
                  <Unknown />
                ) : names.status === "ready" ? (
                  (names.data.get(dataset.storageOwnerPersonId) ?? dataset.storageOwnerPersonId)
                ) : (
                  <Unknown>Loading</Unknown>
                )}
              </Detail>
              <Detail term="Expected participants">{dataset.expectedParticipants ?? <Unknown />}</Detail>
              <Detail term="Expected files">{dataset.expectedFileCount ?? <Unknown />}</Detail>
              <Detail term="Received files on the primary copy">{dataset.receivedFileCount ?? <Unknown />}</Detail>
              <Detail term="Size of the primary copy">
                {dataset.sizeBytes === undefined ? <Unknown /> : formatBytes(dataset.sizeBytes)}
              </Detail>
              <Detail term="Received">
                {dataset.receivedAt === undefined ? (
                  <Unknown>Not yet</Unknown>
                ) : (
                  formatDateTime(dataset.receivedAt.toDate())
                )}
              </Detail>
              <Detail term="Availability">{AVAILABILITY_LABELS[dataset.availability]}</Detail>
              <Detail term="Last seen">
                {dataset.lastSeenAt === null ? <Unknown>Never</Unknown> : formatDateTime(dataset.lastSeenAt.toDate())}
              </Detail>
              <Detail term="BIDS validation">{BIDS_STATUS_LABELS[dataset.bidsStatus]}</Detail>
              <Detail term="QC">{QC_STATUS_LABELS[dataset.qcStatus]}</Detail>
            </Details>
          </Section>
          {readsPaths ? (
            <Section title="Metadata">
              {detailData?.metadata === undefined || Object.keys(detailData.metadata).length === 0 ? (
                <p className="text-sm text-fg-secondary">No metadata is recorded.</p>
              ) : (
                <Details>
                  {Object.entries(detailData.metadata).map(([name, value]) => (
                    <Detail key={name} term={name}>
                      {String(value)}
                    </Detail>
                  ))}
                </Details>
              )}
            </Section>
          ) : null}
        </div>
      ),
    },
    {
      id: "storage",
      live: scope === null ? NEVER : present(refs),
      render: () => (
        <StorageSection
          datasetKey={dataset.id}
          refs={ready(refs)}
          endpoints={endpointList}
          manages={manages}
          readsPaths={readsPaths}
        />
      ),
    },
    {
      id: "files",
      live: unit === null ? NEVER : present(manifests),
      render: () => (
        <FilesSection
          datasetKey={dataset.id}
          manifests={ready(manifests)}
          refs={ready(refs)}
          expectedManifestId={dataset.expectedManifestId}
          unit={unit}
          manages={manages}
          endpointName={endpointName}
        />
      ),
    },
    {
      id: "transfers",
      live: scope === null ? NEVER : present(transfers),
      render: () => (
        <TransfersSection
          datasetKey={dataset.id}
          transfers={ready(transfers)}
          refs={ready(refs)}
          manages={manages}
          uid={viewer.uid}
          endpointName={endpointName}
        />
      ),
    },
    {
      id: "quality",
      live: scope === null ? NEVER : present(assessments),
      render: () => (
        <QualitySection
          datasetKey={dataset.id}
          assessments={ready(assessments)}
          reasons={ready(reasons).filter((term) => term.archivedAt === null && !term.isDeprecated)}
          deviations={ready(deviations)}
          manages={manages}
        />
      ),
    },
    {
      id: "bids",
      live: readsPaths ? present(detail) : ALWAYS,
      render: () => <BidsSection dataset={dataset} detail={detailData} manages={manages} readsPaths={readsPaths} />,
    },
    {
      id: "history",
      live: present(history),
      render: () => (
        <ul className="grid gap-2" data-testid="dataset-history">
          {ready(history).map((entry) => (
            <li key={entry.id} className="rounded-control border border-border px-3 py-2 text-sm">
              <span className="font-medium">
                {entry.fromStatusKey === null
                  ? `Registered as ${stateLabelOf(entry.toStatusKey)}`
                  : `${stateLabelOf(entry.fromStatusKey)} to ${stateLabelOf(entry.toStatusKey)}`}
              </span>
              <span className="block text-xs text-fg-secondary">
                {formatDateTime(entry.effectiveAt.toDate())}
                {entry.reason === undefined ? "" : `: ${entry.reason}`}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "access",
      live: unit === null ? NEVER : present(events),
      render: () =>
        ready(events).length === 0 ? (
          <EmptyState
            title="No location has been read"
            description="Every reading of a location or a viewer link is recorded here."
          />
        ) : (
          <Table caption="Readings of locations">
            <TableHead>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>What</TableHeaderCell>
                <TableHeaderCell>Account</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...ready(events)]
                .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
                .map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{formatDateTime(event.createdAt.toDate())}</TableCell>
                    <TableCell>
                      {event.action === "viewLocation"
                        ? "The location of a copy"
                        : event.action === "viewConnection"
                          ? "The connection of a server"
                          : "A viewer link"}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {event.uid === viewer.uid ? "You" : event.uid}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        ),
    },
    {
      id: "documents",
      live: present(links),
      render: () => (
        <DriveLinks
          links={ready(links)}
          canLink={manages}
          targets={[
            {
              value: "dataset",
              label: `The dataset ${dataset.datasetKey}`,
              entityType: "dataset",
              entityId: dataset.id,
            },
          ]}
          caption="Documents linked to the dataset"
        />
      ),
    },
  ];

  const shown = useRef(new Set<TabId>());
  const loading = shown.current.size === 0 && tabs.some((tab) => tab.live.status === "loading");
  const visible = loading
    ? []
    : tabs.filter(
        (tab) =>
          tab.live.status === "error" ||
          (tab.live.status === "ready" && tab.live.data) ||
          (tab.live.status === "loading" && shown.current.has(tab.id)),
      );
  for (const tab of visible) shown.current.add(tab.id);
  const selected = visible.find((tab) => tab.id === params.get("tab")) ?? visible[0];
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
  const otherTabs = loading ? [] : visible.filter((tab) => tab.id !== selected?.id).map((tab) => tab.id);
  usePaletteActions(
    otherTabs.map((id) => ({
      id: `tab-${id}`,
      label: `Show the ${TAB_LABELS[id].toLowerCase()} of ${dataset.datasetKey}`,
      run: () => showTab(id),
    })),
    `${dataset.id}:${otherTabs.join(",")}`,
  );

  return (
    <>
      <header className="mb-5 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="break-all text-2xl text-fg">{dataset.datasetKey}</h1>
            <p className="text-md text-fg-secondary">{dataset.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              <OriginBadge origin={dataset.dataOrigin} showLive />
              <Badge tone="outline">{stateLabel}</Badge>
              <Badge
                tone={
                  dataset.availability === "unavailable" || dataset.availability === "partial" ? "accent" : "outline"
                }
              >
                {AVAILABILITY_LABELS[dataset.availability]}
              </Badge>
              <Badge tone="outline">QC {QC_STATUS_LABELS[dataset.qcStatus].toLowerCase()}</Badge>
              <Badge tone="outline">BIDS {BIDS_STATUS_LABELS[dataset.bidsStatus].toLowerCase()}</Badge>
              {dataset.archivedAt === null ? null : <Badge tone="accent">Archived</Badge>}
            </div>
          </div>
          {viewer.access.member ? (
            <div className="flex flex-wrap gap-2">
              <FavouriteButton uid={viewer.uid} entityType="dataset" entityId={dataset.id} name={dataset.datasetKey} />
              <FollowButton uid={viewer.uid} entityType="dataset" entityId={dataset.id} label="Follow" />
            </div>
          ) : null}
        </div>
      </header>
      {loading || selected === undefined ? (
        <LoadingState label="Loading the dataset" />
      ) : (
        <Tabs value={selected.id} onValueChange={showTab}>
          <HorizontalScroll>
            <TabsList aria-label="Sections of the dataset" className="min-w-max">
              {visible.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {TAB_LABELS[tab.id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </HorizontalScroll>
          {visible.map((tab) => (
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
      {changing ? <StatusDialog dataset={dataset} workflow={workflow} onClose={() => setChanging(false)} /> : null}
    </>
  );
}

export function DatasetPage() {
  const { datasetKey = "" } = useParams();
  const viewer = useViewer();
  const dataset = useLiveDocument("datasets", datasetKey === "" ? null : [datasetKey]);
  const exists = dataset.status === "ready" && dataset.data !== null;
  useRecordVisit(exists && viewer?.access.member === true ? viewer.uid : null, "dataset", exists ? datasetKey : null);
  return (
    <LiveView
      live={dataset}
      loadingLabel="Loading the dataset"
      errorTitle="The dataset could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(record) =>
        record === null ? (
          <EmptyState
            title="This dataset is not in the registry"
            description="No dataset has this key. It may have been mistyped, or it may not be registered yet."
            action={
              <Button asChild>
                <Link to={DATASETS_PATH}>Go to the datasets</Link>
              </Button>
            }
          />
        ) : viewer === null ? (
          <LoadingState label="Checking your access" />
        ) : (
          <DatasetRecord dataset={record} viewer={viewer} />
        )
      }
    </LiveView>
  );
}
