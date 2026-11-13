// The administration page of the Google integrations (docs/INTEGRATIONS.md, section 9): the state
// of each connection, the mappings with their configuration, the jobs, the questions that wait
// for a person, the templates and generated documents, and the Drive push channels. It reads the
// documents that functions keep and calls no Google interface itself, so it works during an
// outage and shows the last known state with its time. Every action goes through a function.
import {
  controlIntegrationConnectionContract,
  DOCUMENT_TEMPLATE_KINDS,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateKind,
  GOOGLE_SYSTEMS,
  type GoogleSystem,
  generateDocumentContract,
  PROGRAMME_KEY,
  resolveSyncReviewItemContract,
  saveDocumentTemplateContract,
} from "@eegml/shared";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { useProgrammeAdministrator } from "@/auth/use-privilege";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { AdminPage } from "@/pages/admin/AdminPage";
import { ReasonDialog } from "@/pages/admin/ReasonDialog";
import { GeneratedDocumentCard } from "@/pages/integrations/GeneratedDocuments";
import { combineLive } from "@/registry/combine";
import {
  ADAPTER_LABELS,
  CONNECTION_STATUS_LABELS,
  connectionHint,
  labelOf,
  MODE_LABELS,
  REVIEW_KIND_LABELS,
  SYSTEM_LABELS,
} from "./integration-format";
import { JobsSection, RUN_FILTERS, RunDialog, type RunFilter } from "./JobsSection";
import { MappingsSection } from "./MappingsSection";

type Connection = RecordOf<"integrationConnections">;
type Mapping = RecordOf<"syncMappings">;
type Run = RecordOf<"syncRuns">;
type Item = RecordOf<"syncReviewItems">;
type Template = RecordOf<"documentTemplates">;
type Generated = RecordOf<"generatedDocuments">;
type Channel = RecordOf<"driveChannels">;

const CONNECTIONS: LiveQuery<"integrationConnections"> = {
  collection: "integrationConnections",
  within: [],
  limit: 20,
};
const MAPPINGS: LiveQuery<"syncMappings"> = { collection: "syncMappings", within: [], limit: 200 };
const RUNS: LiveQuery<"syncRuns"> = { collection: "syncRuns", within: [], orderBy: [["queuedAt", "desc"]], limit: 300 };
const OPEN_CONFLICTS: LiveQuery<"syncConflicts"> = {
  collection: "syncConflicts",
  within: [],
  where: [["status", "==", "open"]],
  limit: 1_000,
};
const OPEN_ITEMS: LiveQuery<"syncReviewItems"> = {
  collection: "syncReviewItems",
  within: [],
  where: [["status", "==", "open"]],
  limit: 1_000,
};
const TEMPLATES: LiveQuery<"documentTemplates"> = { collection: "documentTemplates", within: [], limit: 100 };
const GENERATED: LiveQuery<"generatedDocuments"> = { collection: "generatedDocuments", within: [], limit: 500 };
const CHANNELS: LiveQuery<"driveChannels"> = {
  collection: "driveChannels",
  within: [],
  orderBy: [["expiresAt", "desc"]],
  limit: 50,
};

const TABS = ["overview", "mappings", "jobs", "review", "documents", "drive"] as const;
type TabId = (typeof TABS)[number];
const TAB_LABELS: Readonly<Record<TabId, string>> = {
  overview: "Overview",
  mappings: "Mappings",
  jobs: "Jobs",
  review: "Review",
  documents: "Documents",
  drive: "Drive notifications",
};

function useConnectionAction() {
  const toast = useToast();
  return async (system: GoogleSystem, action: "test" | "pause" | "resume" | "renewChannel") => {
    try {
      const result = await callFunction(controlIntegrationConnectionContract, { system, action });
      toast.show({ title: result.message });
    } catch (error) {
      toast.show({ title: "Nothing was changed.", description: error instanceof CallableError ? error.message : "" });
    }
  };
}

function SecretDialog({ system, onClose }: { system: GoogleSystem; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await callFunction(controlIntegrationConnectionContract, {
        system,
        action: "setCredentialRef",
        credentialRef: name.trim(),
      });
      toast.show({ title: "The secret is named." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The name could not be saved.");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title={`Name the secret of ${SYSTEM_LABELS[system]}`}
        description="The portal stores the name of the secret in the secret store, never its value. Enter the value in the secret store itself."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure ? <ErrorState title="Nothing was saved." description={failure} /> : null}
          <FormField
            label="Name of the secret"
            hint="Capital letters, digits and underscores, for example GOOGLE_DOCS_REFRESH_TOKEN."
          >
            {(control) => (
              <Input {...control} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Save the name
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServicesSection({
  connections,
  administrator,
}: {
  connections: readonly Connection[];
  administrator: boolean;
}) {
  const act = useConnectionAction();
  const [naming, setNaming] = useState<GoogleSystem | null>(null);
  const bySystem = new Map(connections.map((connection) => [connection.system, connection]));
  const fake = connections.some((connection) => connection.adapter === "fake");
  return (
    <section aria-labelledby="services-heading" className="grid gap-3">
      <h2 id="services-heading" className="text-lg text-fg-strong">
        Connected services
      </h2>
      {fake ? (
        <p className="rounded-control border border-border bg-background px-3 py-2 text-sm" data-testid="fake-notice">
          The real Google services are not connected: credentials not supplied. Here every Google call reaches a
          synthetic fake, which holds invented files only.
        </p>
      ) : null}
      <div className="relative overflow-x-auto">
        <Table caption="Connected services">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Service</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell>Acts as</TableHeaderCell>
              <TableHeaderCell>Last success</TableHeaderCell>
              <TableHeaderCell>Last error</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Actions</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {GOOGLE_SYSTEMS.map((system) => {
              const connection = bySystem.get(system);
              if (connection === undefined) {
                return (
                  <TableRow key={system} className="align-top">
                    <TableCell className="font-medium text-fg-strong">{SYSTEM_LABELS[system]}</TableCell>
                    <TableCell colSpan={5}>
                      <Badge tone="accent">Not connected</Badge>
                      <span className="mt-1 block text-sm text-fg-secondary">{ADAPTER_LABELS.none}</span>
                    </TableCell>
                  </TableRow>
                );
              }
              const paused = connection.status === "paused";
              return (
                <TableRow key={system} className="align-top" data-testid={`connection-${system}`}>
                  <TableCell>
                    <span className="font-medium text-fg-strong">{SYSTEM_LABELS[system]}</span>
                    <span className="block text-xs text-fg-muted">{ADAPTER_LABELS[connection.adapter]}</span>
                    {connection.credentialRef === undefined ? null : (
                      <span className="block text-xs text-fg-muted">Secret {connection.credentialRef}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        ["degraded", "needsAttention", "notConfigured"].includes(connection.status)
                          ? "accent"
                          : "neutral"
                      }
                    >
                      {CONNECTION_STATUS_LABELS[connection.status]}
                    </Badge>
                    <span className="mt-1 block max-w-xs text-xs text-fg-secondary">
                      {connection.statusReason ?? connectionHint(connection.status, connection.adapter)}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-48 break-all">
                    {connection.identity ?? <Unknown>No account</Unknown>}
                  </TableCell>
                  <TableCell>
                    {connection.lastSuccessAt === null ? (
                      <Unknown>Never</Unknown>
                    ) : (
                      formatDateTime(connection.lastSuccessAt.toDate())
                    )}
                  </TableCell>
                  <TableCell>
                    {connection.lastErrorAt === null ? (
                      <Unknown>None</Unknown>
                    ) : (
                      <>
                        {formatDateTime(connection.lastErrorAt.toDate())}
                        <span className="block text-xs text-fg-secondary">{connection.lastError}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void act(system, "test")}>
                        Test<span className="sr-only"> {SYSTEM_LABELS[system]}</span>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void act(system, paused ? "resume" : "pause")}>
                        {paused ? "Resume" : "Pause"}
                        <span className="sr-only"> {SYSTEM_LABELS[system]}</span>
                      </Button>
                      {administrator ? (
                        <Button size="sm" variant="ghost" onClick={() => setNaming(system)}>
                          Name the secret<span className="sr-only"> of {SYSTEM_LABELS[system]}</span>
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {naming === null ? null : <SecretDialog system={naming} onClose={() => setNaming(null)} />}
    </section>
  );
}

function HealthSummary({
  conflicts,
  items,
  runs,
  connections,
  onTab,
}: {
  conflicts: number;
  items: number;
  runs: readonly Run[];
  connections: readonly Connection[];
  onTab: (tab: TabId, filter?: RunFilter) => void;
}) {
  const pending = runs.filter((run) => (RUN_FILTERS.pending.statuses as readonly string[]).includes(run.status)).length;
  const failed = runs.filter((run) => (RUN_FILTERS.errors.statuses as readonly string[]).includes(run.status)).length;
  const attention = connections.filter(
    (connection) => connection.status === "needsAttention" || connection.status === "degraded",
  ).length;
  const figures = [
    {
      label: "Open conflicts",
      value: conflicts,
      action: (
        <Link to="/admin/integrations/conflicts" className="text-fg-accent underline">
          Resolve conflicts
        </Link>
      ),
    },
    {
      label: "Items to review",
      value: items,
      action: (
        <button type="button" className="text-fg-accent underline" onClick={() => onTab("review")}>
          Review
        </button>
      ),
    },
    {
      label: "Jobs waiting or running",
      value: pending,
      action: (
        <button type="button" className="text-fg-accent underline" onClick={() => onTab("jobs", "pending")}>
          See the jobs
        </button>
      ),
    },
    {
      label: "Failed jobs",
      value: failed,
      action: (
        <button type="button" className="text-fg-accent underline" onClick={() => onTab("jobs", "errors")}>
          See the errors
        </button>
      ),
    },
    { label: "Services that need attention", value: attention, action: null },
  ];
  return (
    <section aria-labelledby="health-heading" className="grid gap-3">
      <h2 id="health-heading" className="text-lg text-fg-strong">
        Health
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="integration-health">
        {figures.map((figure) => (
          <li key={figure.label} className="grid gap-1 rounded-tile border border-border bg-surface px-4 py-3">
            <span className="text-sm text-fg-secondary">{figure.label}</span>
            <span className="text-2xl tabular-nums text-fg-strong">{figure.value}</span>
            {figure.value > 0 ? <span className="text-sm">{figure.action}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

const ITEM_ACTIONS = {
  dismiss: {
    label: "Dismiss",
    title: "Dismiss this item?",
    description: "The item is closed, and nothing in the sheet or the portal changes.",
  },
  forgetRow: {
    label: "Write the row again",
    title: "Forget the state of this row?",
    description:
      "The next run appends the row again from the portal, as for a record that has no row. Nothing is deleted.",
  },
  clearMark: {
    label: "Clear the mark",
    title: "Write this cell again?",
    description:
      "The next run may write the cell again. Clear the mark once the formula, rule or add-on that changed the value is dealt with.",
  },
} as const;

function ReviewSection({ items, mappings }: { items: readonly Item[]; mappings: readonly Mapping[] }) {
  const toast = useToast();
  const [acting, setActing] = useState<{ item: Item; action: keyof typeof ITEM_ACTIONS } | null>(null);
  const names = new Map(mappings.map((mapping) => [mapping.id, mapping.name]));
  return (
    <section aria-labelledby="review-heading" className="grid gap-3">
      <h2 id="review-heading" className="text-lg text-fg-strong">
        Items to review
      </h2>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing waits for review"
          description="Rows that have gone, keys the portal does not know, formulas in mapped cells and lost access are listed here."
        />
      ) : (
        <ul className="grid gap-3">
          {[...items]
            .sort((a, b) => a.detectedAt.toMillis() - b.detectedAt.toMillis())
            .map((item) => (
              <li
                key={item.id}
                className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
                data-testid="review-item"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{labelOf(REVIEW_KIND_LABELS, item.kind)}</Badge>
                  <span className="text-sm text-fg-secondary">{names.get(item.mappingId) ?? item.mappingId}</span>
                  {item.rowKey === undefined ? null : <span className="text-sm break-all">Row {item.rowKey}</span>}
                  {item.field === undefined ? null : <span className="text-sm">Field {item.field}</span>}
                </div>
                <p>{item.detail}</p>
                <p className="text-xs text-fg-muted">
                  First seen {formatDateTime(item.detectedAt.toDate())}, last seen{" "}
                  {formatDateTime(item.lastSeenAt.toDate())}
                </p>
                <div className="flex flex-wrap gap-2">
                  {item.kind === "missingRow" ? (
                    <Button size="sm" onClick={() => setActing({ item, action: "forgetRow" })}>
                      {ITEM_ACTIONS.forgetRow.label}
                    </Button>
                  ) : null}
                  {item.kind === "unstableCell" ? (
                    <Button size="sm" onClick={() => setActing({ item, action: "clearMark" })}>
                      {ITEM_ACTIONS.clearMark.label}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setActing({ item, action: "dismiss" })}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      )}
      {acting === null ? null : (
        <ReasonDialog
          open
          onOpenChange={(open) => (open ? null : setActing(null))}
          title={ITEM_ACTIONS[acting.action].title}
          description={ITEM_ACTIONS[acting.action].description}
          label="Note"
          confirmLabel={ITEM_ACTIONS[acting.action].label}
          onConfirm={async (note) => {
            await callFunction(resolveSyncReviewItemContract, { itemId: acting.item.id, action: acting.action, note });
            toast.show({ title: "The item is settled." });
          }}
        />
      )}
    </section>
  );
}

function TemplateDialog({
  template,
  onClose,
  administrator,
}: {
  template: Template;
  onClose: () => void;
  administrator: boolean;
}) {
  const toast = useToast();
  const [name, setName] = useState(template.name);
  const [document, setDocument] = useState(template.externalDocumentId ?? "");
  const [folder, setFolder] = useState(template.targetFolderId ?? "");
  const [enabled, setEnabled] = useState(template.enabled);
  const [mode, setMode] = useState(template.mode);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await callFunction(saveDocumentTemplateContract, {
        key: template.key,
        kind: template.kind,
        name: name.trim(),
        externalDocumentId: document.trim(),
        targetFolderId: folder.trim(),
        enabled,
        mode,
      });
      toast.show({ title: "The template is saved." });
      onClose();
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The template could not be saved.");
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title={`Change ${template.name}`}
        description="The template is a Google Doc kept by people. Its copies are made in a folder of a shared drive, because the portal's account cannot own files elsewhere."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure ? <ErrorState title="Nothing was saved." description={failure} /> : null}
          <FormField label="Name">
            {(control) => <Input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
          </FormField>
          <FormField label="Identifier of the template document in Drive">
            {(control) => <Input {...control} value={document} onChange={(event) => setDocument(event.target.value)} />}
          </FormField>
          <FormField label="Identifier of the folder for its copies">
            {(control) => <Input {...control} value={folder} onChange={(event) => setFolder(event.target.value)} />}
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            In use
          </label>
          <FormField
            label="Mode"
            hint={administrator ? undefined : "Only a programme administrator approves live writes."}
          >
            {(control) => (
              <Select
                {...control}
                value={mode}
                onChange={(event) => setMode(event.target.value as "dryRun" | "live")}
                disabled={!administrator && template.mode === "dryRun"}
              >
                <option value="dryRun">{MODE_LABELS.dryRun}</option>
                <option value="live">{MODE_LABELS.live}</option>
              </Select>
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Save the template
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DocumentsSection({
  templates,
  documents,
  administrator,
}: {
  templates: readonly Template[];
  documents: readonly Generated[];
  administrator: boolean;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Template | null>(null);
  const kindName = (kind: string) =>
    labelOf(
      Object.fromEntries(DOCUMENT_TEMPLATE_KINDS.map((key) => [key, DOCUMENT_TEMPLATES[key].name])) as Readonly<
        Record<DocumentTemplateKind, string>
      >,
      kind,
    );
  const generateProgramme = async (template: Template) => {
    try {
      await callFunction(generateDocumentContract, {
        templateKey: template.key,
        entityType: "programme",
        entityId: PROGRAMME_KEY,
      });
      toast.show({ title: `${template.name} will be updated in a moment.` });
    } catch (error) {
      toast.show({
        title: "The document could not be created.",
        description: error instanceof CallableError ? error.message : "",
      });
    }
  };
  return (
    <section aria-labelledby="documents-heading" className="grid gap-4">
      <h2 id="documents-heading" className="text-lg text-fg-strong">
        Templates and generated documents
      </h2>
      {templates.length === 0 ? (
        <EmptyState
          title="No template is registered"
          description="A template is a Google Doc whose tags mark the sections the portal manages."
        />
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption="Document templates">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Template</TableHeaderCell>
                <TableHeaderCell>Sections</TableHeaderCell>
                <TableHeaderCell>Mode</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {[...templates]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((template) => (
                  <TableRow key={template.key} className="align-top">
                    <TableCell>
                      <span className="font-medium text-fg-strong">{template.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {kindName(template.kind)}
                        {template.enabled ? "" : ", not in use"}
                      </span>
                    </TableCell>
                    <TableCell>{template.managedSections.join(", ")}</TableCell>
                    <TableCell>
                      <Badge tone={template.mode === "live" ? "solid" : "outline"}>{MODE_LABELS[template.mode]}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>
                          Change<span className="sr-only"> {template.name}</span>
                        </Button>
                        {template.entityType === "programme" && template.enabled ? (
                          <Button size="sm" onClick={() => void generateProgramme(template)}>
                            Generate for the programme
                          </Button>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      {documents.length === 0 ? (
        <EmptyState
          title="No document is generated yet"
          description="Documents are generated from the documents tab of a replication or a laboratory, or here for the programme."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {[...documents]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((document) => (
              <GeneratedDocumentCard key={document.id} document={document} canUpdate />
            ))}
        </div>
      )}
      {editing === null ? null : (
        <TemplateDialog template={editing} administrator={administrator} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function DriveSection({ channels, connection }: { channels: readonly Channel[]; connection: Connection | undefined }) {
  const act = useConnectionAction();
  return (
    <section aria-labelledby="drive-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="drive-heading" className="text-lg text-fg-strong">
          Drive notifications
        </h2>
        <Button size="sm" onClick={() => void act("googleDrive", "renewChannel")}>
          Renew the channel
        </Button>
      </div>
      <p className="text-sm text-fg-secondary">
        Drive says that a file changed, never what changed. A push channel lasts a week at most, and the change feed is
        also read every ten minutes, which covers a channel that expired or a message that was lost. Last read of the
        feed:{" "}
        {connection?.lastPolledAt === undefined || connection.lastPolledAt === null
          ? "never"
          : formatDateTime(connection.lastPolledAt.toDate())}
        .
      </p>
      {channels.length === 0 ? (
        <EmptyState
          title="No push channel is open"
          description="Without one, changes are found by reading the change feed."
        />
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption="Push channels">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell>Last message</TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell className="break-all">{channel.channelId}</TableCell>
                  <TableCell>{formatDateTime(channel.expiresAt.toDate())}</TableCell>
                  <TableCell>
                    {channel.lastMessageAt === null ? (
                      <Unknown>None</Unknown>
                    ) : (
                      `${formatDateTime(channel.lastMessageAt.toDate())}, number ${channel.lastMessageNumber}`
                    )}
                  </TableCell>
                  <TableCell>
                    {channel.stoppedAt !== null
                      ? "Stopped"
                      : channel.expiresAt.toMillis() < Date.now()
                        ? "Expired"
                        : "Open"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function Console() {
  const administrator = useProgrammeAdministrator();
  const connections = useLiveQuery(CONNECTIONS);
  const mappings = useLiveQuery(MAPPINGS);
  const runs = useLiveQuery(RUNS);
  const conflicts = useLiveQuery(OPEN_CONFLICTS);
  const items = useLiveQuery(OPEN_ITEMS);
  const templates = useLiveQuery(TEMPLATES);
  const generated = useLiveQuery(GENERATED);
  const channels = useLiveQuery(CHANNELS);
  const live = useMemo(
    () =>
      combineLive(
        [connections, mappings, runs, conflicts, items, templates, generated, channels] as const,
        (c, m, r, x, i, t, g, h) => ({
          connections: c,
          mappings: m,
          runs: r,
          conflicts: x,
          items: i,
          templates: t,
          generated: g,
          channels: h,
        }),
      ),
    [connections, mappings, runs, conflicts, items, templates, generated, channels],
  );
  const [params, setParams] = useSearchParams();
  const tab: TabId = (TABS as readonly string[]).includes(params.get("tab") ?? "")
    ? (params.get("tab") as TabId)
    : "overview";
  const filter: RunFilter =
    params.get("runs") === "errors" ? "errors" : params.get("runs") === "all" ? "all" : "pending";
  const [shownRun, setShownRun] = useState<Run | null>(null);
  const runOpener = useRef<HTMLElement | null>(null);
  const show = (next: TabId, runFilter?: RunFilter) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "overview") updated.delete("tab");
        else updated.set("tab", next);
        if (runFilter !== undefined) updated.set("runs", runFilter);
        return updated;
      },
      { replace: true },
    );
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the integrations"
      errorTitle="The integrations could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(data) => {
        const mappingNames = new Map(data.mappings.map((mapping) => [mapping.id, mapping.name]));
        const documentNames = new Map(data.generated.map((document) => [document.id, document.title]));
        const subjectOf = (run: Run) =>
          run.mappingId !== undefined
            ? (mappingNames.get(run.mappingId) ?? run.mappingId)
            : run.generatedDocumentId !== undefined
              ? (documentNames.get(run.generatedDocumentId) ?? run.generatedDocumentId)
              : run.automationRunId !== undefined
                ? `Run ${run.automationRunId}`
                : "Google Drive";
        return (
          <Tabs value={tab} onValueChange={(value) => show(value as TabId)}>
            <HorizontalScroll>
              <TabsList aria-label="Sections of the integrations" className="min-w-max">
                {TABS.map((id) => (
                  <TabsTrigger key={id} value={id}>
                    {TAB_LABELS[id]}
                    {id === "review" && data.items.length > 0 ? ` (${data.items.length})` : ""}
                  </TabsTrigger>
                ))}
              </TabsList>
            </HorizontalScroll>
            <TabsContent value="overview" className="grid gap-8">
              <HealthSummary
                conflicts={data.conflicts.length}
                items={data.items.length}
                runs={data.runs}
                connections={data.connections}
                onTab={show}
              />
              <ServicesSection connections={data.connections} administrator={administrator} />
            </TabsContent>
            <TabsContent value="mappings">
              <MappingsSection
                mappings={data.mappings}
                runs={data.runs}
                administrator={administrator}
                sheetsPaused={data.connections.some(
                  (connection) => connection.system === "googleSheets" && connection.status === "paused",
                )}
                onShowRun={(run, opener) => {
                  runOpener.current = opener;
                  setShownRun(run);
                }}
              />
            </TabsContent>
            <TabsContent value="jobs">
              <JobsSection
                runs={data.runs}
                subjectOf={subjectOf}
                filter={filter}
                onFilter={(next) => show("jobs", next)}
              />
            </TabsContent>
            <TabsContent value="review" className="grid gap-4">
              <p>
                {data.conflicts.length === 0 ? (
                  "No conflict is open."
                ) : (
                  <Link to="/admin/integrations/conflicts" className="text-fg-accent underline">
                    Resolve{" "}
                    {data.conflicts.length === 1 ? "the open conflict" : `the ${data.conflicts.length} open conflicts`}
                  </Link>
                )}
              </p>
              <ReviewSection items={data.items} mappings={data.mappings} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsSection templates={data.templates} documents={data.generated} administrator={administrator} />
            </TabsContent>
            <TabsContent value="drive">
              <DriveSection
                channels={data.channels}
                connection={data.connections.find((connection) => connection.system === "googleDrive")}
              />
            </TabsContent>
            {shownRun === null ? null : (
              <RunDialog
                run={shownRun}
                subject={subjectOf(shownRun)}
                onClose={() => setShownRun(null)}
                returnFocus={() => runOpener.current}
              />
            )}
          </Tabs>
        );
      }}
    </LiveView>
  );
}

/** The page of the Google integrations, for holders of `integrations.manage`. */
export function IntegrationsPage() {
  return (
    <AdminPage
      entryId="admin-integrations"
      description="Google Drive, Sheets and Docs: the state of each service, the sheet mappings, the jobs and their retries, what waits for a person, and the generated documents."
    >
      <Console />
    </AdminPage>
  );
}
