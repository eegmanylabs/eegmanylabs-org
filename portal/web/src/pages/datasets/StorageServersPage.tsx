// The storage servers that hold copies of datasets (docs/INTEGRATIONS.md, sections 7 and 9): each
// server's protocol, institution and owner, whether it was reachable at the last check, when it
// was last seen, and, for the programme, its connection details and a check on demand. Every
// member reads the public description of a server, which never names its address. A server
// that is down is shown as unreachable with the time it was last seen, and becomes active again
// at the next check or scan that reaches it.
import {
  checkStorageEndpointContract,
  getStorageEndpointConnectionContract,
  keySchema,
  laboratoryScopeKey,
  normaliseStoragePath,
  replicationScopeKey,
  type StorageProtocol,
  saveStorageEndpointContract,
  storagePathProblem,
  storageSecretNameSchema,
} from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf, retryFailedLiveData } from "@/data";
import { combineLive } from "@/registry/combine";
import { useInstitutions, useLaboratories, useReplications, useStorageEndpoints } from "@/registry/queries";
import { useViewer } from "@/registry/viewer";
import { FormDialog, useAction } from "./dataset-actions";
import { ENDPOINT_STATUS_LABELS, PROTOCOL_LABELS } from "./dataset-format";

type Endpoint = RecordOf<"storageEndpoints">;

/** A folder of one replication or laboratory on a server, as the form holds it. */
interface FolderRow {
  readonly id: number;
  readonly scopeKey: string;
  readonly folder: string;
}

/** A replication or a laboratory that a folder can belong to. */
interface UnitOption {
  readonly scopeKey: string;
  readonly label: string;
}

/**
 * The folders of the units on a server. A holder of `datasets.manage` for a replication or a
 * laboratory names a copy only inside its unit's folder, so that the server's account never
 * lists another unit's files for it.
 */
function FoldersField({
  rows,
  units,
  onChange,
}: {
  rows: readonly FolderRow[];
  units: readonly UnitOption[];
  onChange: (rows: readonly FolderRow[]) => void;
}) {
  const update = (id: number, change: Partial<FolderRow>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Folders of replications and laboratories</legend>
      <p className="text-xs text-fg-muted">
        Those who manage the datasets of a replication or a laboratory name copies only inside its folder below the base
        path. Programme administrators and the core team name any folder.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No folder yet, so only the programme adds copies here.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <FormField label={`Unit ${index + 1}`}>
            {(control) => (
              <Select
                {...control}
                value={row.scopeKey}
                onChange={(event) => update(row.id, { scopeKey: event.target.value })}
              >
                {units.map((unit) => (
                  <option key={unit.scopeKey} value={unit.scopeKey}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={`Folder ${index + 1}`}>
            {(control) => (
              <Input
                {...control}
                value={row.folder}
                maxLength={1_024}
                onChange={(event) => update(row.id, { folder: event.target.value })}
              />
            )}
          </FormField>
          <Button type="button" variant="ghost" onClick={() => onChange(rows.filter((other) => other.id !== row.id))}>
            Remove folder {index + 1}
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          disabled={units.length === 0}
          onClick={() =>
            onChange([
              ...rows,
              { id: Math.max(0, ...rows.map((row) => row.id)) + 1, scopeKey: units[0]?.scopeKey ?? "", folder: "" },
            ])
          }
        >
          Add a folder
        </Button>
      </div>
    </fieldset>
  );
}

function EndpointDialog({
  endpoint,
  institutions,
  units,
  credentials,
  onClose,
}: {
  endpoint: Endpoint | null;
  institutions: readonly RecordOf<"institutions">[];
  units: readonly UnitOption[];
  credentials: boolean;
  onClose: () => void;
}) {
  const action = useAction();
  const [key, setKey] = useState(endpoint?.id ?? "");
  const [name, setName] = useState(endpoint?.name ?? "");
  const [protocol, setProtocol] = useState<StorageProtocol>(endpoint?.protocol ?? "sftp");
  const [scanMode, setScanMode] = useState<Endpoint["scanMode"]>(endpoint?.scanMode ?? "remote");
  const [institutionId, setInstitutionId] = useState(endpoint?.institutionId ?? "");
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [retired, setRetired] = useState(endpoint?.status === "retired");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [basePath, setBasePath] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [folders, setFolders] = useState<readonly FolderRow[]>([]);
  const [loaded, setLoaded] = useState(endpoint === null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = () =>
    action.run(
      async () => {
        if (endpoint === null) return;
        const connection = await callFunction(getStorageEndpointConnectionContract, { key: endpoint.id });
        setHost(connection.host);
        setPort(connection.port === null ? "" : String(connection.port));
        setBasePath(connection.basePath ?? "");
        setCredentialRef(connection.credentialRef ?? "");
        setFolders(
          Object.entries(connection.allowedPrefixes).map(([scopeKey, folder], index) => ({
            id: index + 1,
            scopeKey,
            folder,
          })),
        );
        setLoaded(true);
      },
      null,
      "The connection details could not be read.",
    );
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title={endpoint === null ? "Register a storage server" : `Change ${endpoint.name}`}
      description="The address of a server is kept where no member can read it. A credential is never entered here: name the secret that holds it."
      submitLabel="Save the server"
      failureTitle="The server was not saved."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const portNumber = port.trim() === "" ? undefined : Number(port);
        if (!keySchema.safeParse(key).success || name.trim() === "" || host.trim() === "") {
          setProblem("Give the server a key of letters, digits and hyphens, a name and a host.");
          return;
        }
        if (portNumber !== undefined && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535)) {
          setProblem("The port is a whole number between 1 and 65535.");
          return;
        }
        if (credentialRef.trim() !== "" && !storageSecretNameSchema.safeParse(credentialRef.trim()).success) {
          setProblem(
            "The name of a secret begins with STORAGE_ and holds capitals, digits and underscores, such as STORAGE_BREMEN_READONLY.",
          );
          return;
        }
        const baseProblem = basePath.trim() === "" ? null : storagePathProblem(basePath.trim());
        if (baseProblem !== null) {
          setProblem(`Base path: ${baseProblem}`);
          return;
        }
        const allowedPrefixes: Record<string, string> = {};
        for (const [index, row] of folders.entries()) {
          const folder = normaliseStoragePath(row.folder.trim());
          if (folder === null) {
            setProblem(`Folder ${index + 1}: ${storagePathProblem(row.folder.trim()) ?? "Give a folder."}`);
            return;
          }
          if (allowedPrefixes[row.scopeKey] !== undefined) {
            setProblem(`Folder ${index + 1}: each replication or laboratory has one folder on a server.`);
            return;
          }
          allowedPrefixes[row.scopeKey] = folder;
        }
        setProblem(null);
        if (
          await action.run(
            () =>
              callFunction(saveStorageEndpointContract, {
                key,
                name: name.trim(),
                institutionId: institutionId === "" ? null : institutionId,
                ownerPersonId: endpoint?.ownerPersonId ?? null,
                protocol,
                scanMode,
                description: description.trim(),
                retired,
                connection: {
                  host: host.trim(),
                  ...(portNumber === undefined ? {} : { port: portNumber }),
                  ...(basePath.trim() === ""
                    ? {}
                    : { basePath: normaliseStoragePath(basePath.trim()) ?? basePath.trim() }),
                  ...(credentialRef.trim() === "" ? {} : { credentialRef: credentialRef.trim() }),
                  allowedPrefixes,
                },
              }),
            "The server has been saved.",
            "The server could not be saved. Try again.",
          )
        )
          onClose();
      }}
    >
      {!loaded ? (
        <div className="grid gap-2">
          <p className="text-sm">Reading the connection details is recorded in the audit trail.</p>
          <div>
            <Button type="button" onClick={load} disabled={action.busy}>
              Read the connection details
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Key" hint="Permanent, for example bremen-sftp.">
              {(control) => (
                <Input
                  {...control}
                  value={key}
                  disabled={endpoint !== null}
                  maxLength={100}
                  onChange={(event) => setKey(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Name">
              {(control) => (
                <Input {...control} value={name} maxLength={300} onChange={(event) => setName(event.target.value)} />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Protocol">
              {(control) => (
                <Select
                  {...control}
                  value={protocol}
                  onChange={(event) => setProtocol(event.target.value as StorageProtocol)}
                >
                  {(Object.keys(PROTOCOL_LABELS) as StorageProtocol[]).map((value) => (
                    <option key={value} value={value}>
                      {PROTOCOL_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="How its files are listed">
              {(control) => (
                <Select
                  {...control}
                  value={scanMode}
                  onChange={(event) => setScanMode(event.target.value as Endpoint["scanMode"])}
                >
                  <option value="remote">The portal scans it</option>
                  <option value="uploadedManifest">Listings are made inside the institution and uploaded</option>
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Institution">
            {(control) => (
              <Select {...control} value={institutionId} onChange={(event) => setInstitutionId(event.target.value)}>
                <option value="">Not recorded</option>
                {institutions.map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Description" hint="What the server is and who runs it. Never a password.">
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Host">
              {(control) => (
                <Input {...control} value={host} maxLength={253} onChange={(event) => setHost(event.target.value)} />
              )}
            </FormField>
            <FormField label="Port" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Base path" hint="Optional, with no slash at the start.">
              {(control) => (
                <Input
                  {...control}
                  value={basePath}
                  maxLength={1_024}
                  onChange={(event) => setBasePath(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <FoldersField rows={folders} units={units} onChange={setFolders} />
          <FormField
            label="Name of the secret"
            hint={
              credentials
                ? "The secret in the secret store that holds a read-only credential, and names the host it is for."
                : "Only an administrator names a secret, or moves a server that names one."
            }
          >
            {(control) => (
              <Input
                {...control}
                value={credentialRef}
                disabled={!credentials}
                onChange={(event) => setCredentialRef(event.target.value)}
              />
            )}
          </FormField>
          {endpoint === null ? null : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={retired} onChange={(event) => setRetired(event.target.checked)} />
              Retired: no new copy goes to this server
            </label>
          )}
        </>
      )}
    </FormDialog>
  );
}

export function StorageServersPage() {
  const viewer = useViewer();
  const endpoints = useStorageEndpoints();
  const institutions = useInstitutions();
  const replications = useReplications();
  const laboratories = useLaboratories();
  const live = combineLive(
    [endpoints, institutions, replications, laboratories] as const,
    (servers, insts, reps, labs) => ({
      servers,
      insts,
      units: [
        ...reps.map((replication) => ({
          scopeKey: replicationScopeKey(replication.id),
          label: `Replication ${replication.id}`,
        })),
        ...[...labs]
          .sort((a, b) => a.name.localeCompare(b.name, "en"))
          .map((laboratory) => ({ scopeKey: laboratoryScopeKey(laboratory.id), label: laboratory.name })),
      ],
    }),
  );
  const administers = viewer?.can("datasets.manage", "programme") === true;
  const credentials = viewer?.can("integrations.credentials", "programme") === true;
  const check = useAction();
  const [editing, setEditing] = useState<Endpoint | "new" | null>(null);
  return (
    <>
      <PageHeader
        title="Storage servers"
        description="The servers that hold copies of datasets. The portal lists files and checksums there and never moves a recording."
        actions={
          administers ? (
            <Button variant="primary" onClick={() => setEditing("new")}>
              Register a server
            </Button>
          ) : undefined
        }
      />
      {check.failure === null ? null : (
        <p role="alert" className="mb-3 text-sm text-fg-accent">
          {check.failure}
        </p>
      )}
      <LiveView
        live={live}
        loadingLabel="Loading the servers"
        errorTitle="The servers could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {({ servers, insts }) =>
          servers.length === 0 ? (
            <EmptyState
              title="No storage server yet"
              description="An administrator registers each server once an institution has agreed how it is reached."
            />
          ) : (
            <Table caption="Storage servers" data-testid="storage-servers">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Server</TableHeaderCell>
                  <TableHeaderCell>Protocol</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Last seen</TableHeaderCell>
                  <TableHeaderCell>Last checked</TableHeaderCell>
                  {administers ? <TableHeaderCell>Actions</TableHeaderCell> : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {[...servers]
                  .sort((a, b) => a.name.localeCompare(b.name, "en"))
                  .map((server) => (
                    <TableRow key={server.id}>
                      <TableCell>
                        <span className="grid">
                          <span className="font-medium">{server.name}</span>
                          <span className="text-xs text-fg-muted">
                            {insts.find((institution) => institution.id === server.institutionId)?.name ?? ""}
                            {server.scanMode === "uploadedManifest" ? " Listings uploaded from the institution." : ""}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>{PROTOCOL_LABELS[server.protocol]}</TableCell>
                      <TableCell>
                        {server.status === "active" ? (
                          ENDPOINT_STATUS_LABELS.active
                        ) : (
                          <Badge tone={server.status === "unreachable" ? "accent" : "outline"}>
                            {ENDPOINT_STATUS_LABELS[server.status]}
                          </Badge>
                        )}
                        {server.statusReason === undefined ? null : (
                          <span className="block text-xs text-fg-muted">{server.statusReason}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {server.lastSeenAt === null ? (
                          <Unknown>Never</Unknown>
                        ) : (
                          formatDateTime(server.lastSeenAt.toDate())
                        )}
                      </TableCell>
                      <TableCell>
                        {server.lastCheckedAt === null ? (
                          <Unknown>Never</Unknown>
                        ) : (
                          formatDateTime(server.lastCheckedAt.toDate())
                        )}
                      </TableCell>
                      {administers ? (
                        <TableCell>
                          <span className="flex flex-wrap gap-1.5">
                            {server.scanMode === "remote" && server.status !== "retired" ? (
                              <Button
                                size="sm"
                                disabled={check.busy}
                                onClick={() =>
                                  check.run(
                                    async () => {
                                      const result = await callFunction(checkStorageEndpointContract, {
                                        key: server.id,
                                      });
                                      if (!result.reachable) throw new Error(result.message);
                                    },
                                    `${server.name} answered.`,
                                    `${server.name} did not answer. It is shown as unreachable until it does.`,
                                  )
                                }
                              >
                                Check now
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => setEditing(server)}>
                              Change
                            </Button>
                          </span>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )
        }
      </LiveView>
      {editing === null || live.status !== "ready" ? null : (
        <EndpointDialog
          endpoint={editing === "new" ? null : editing}
          institutions={live.data.insts}
          units={live.data.units}
          credentials={credentials}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
