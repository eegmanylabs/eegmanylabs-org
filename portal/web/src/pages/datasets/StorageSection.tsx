// The copies of a dataset (docs/DATA_MODEL.md, section 10): each storage server it is held on,
// with its role, whether it was reachable, when it was last seen and the outcome of its last scan.
// A server that is down leaves the copy marked unavailable and its last listing in place, so the
// registry stays useful. Paths are never on this page until a reader of paths asks for one,
// which the function records. A viewer such as ElectroTag is offered only where a copy says it
// supports it, and nothing else depends on it.
import {
  addStorageRefContract,
  changeStorageRefContract,
  getStorageLocationContract,
  openViewerLinkContract,
  saveViewerLinkContract,
  scanStorageRefContract,
  storagePathProblem,
} from "@eegml/shared";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf } from "@/data";
import { FormDialog, useAction } from "./dataset-actions";
import {
  countsText,
  ENDPOINT_STATUS_LABELS,
  PROTOCOL_LABELS,
  REF_AVAILABILITY_LABELS,
  ROLE_LABELS,
  SCAN_STATUS_LABELS,
} from "./dataset-format";
import { UploadManifestDialog } from "./FilesSection";

type Ref = RecordOf<"datasetStorageRefs">;
type Endpoint = RecordOf<"storageEndpoints">;
type Role = Ref["role"];

const ROLES = Object.keys(ROLE_LABELS) as Role[];

function LocationDialog({ datasetKey, refId, onClose }: { datasetKey: string; refId: string; onClose: () => void }) {
  const action = useAction();
  const [location, setLocation] = useState<{
    uri: string;
    endpointName: string;
    protocol: Endpoint["protocol"];
    host: string | null;
    port: number | null;
    basePath: string | null;
  } | null>(null);
  const { run } = action;
  // The location is asked for once, when the dialog opens: each request is recorded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is a new function on each render
  useEffect(() => {
    void run(
      async () => setLocation(await callFunction(getStorageLocationContract, { datasetKey, storageRefId: refId })),
      null,
      "The location could not be read. Try again.",
    );
  }, [datasetKey, refId]);
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        title="Where this copy is held"
        description="Your reading of this location is recorded in the dataset's access record."
      >
        <div className="mt-4 grid gap-2" data-testid="storage-location">
          {action.busy ? <p>Reading the location…</p> : null}
          {action.failure === null ? null : (
            <p role="alert" className="text-fg-accent">
              {action.failure}
            </p>
          )}
          {location === null ? null : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-fg-secondary">Server</dt>
              <dd>
                {location.endpointName} ({PROTOCOL_LABELS[location.protocol]})
              </dd>
              <dt className="text-fg-secondary">Host</dt>
              <dd className="break-all font-mono">
                {location.host ?? <Unknown />}
                {location.port === null ? "" : `:${location.port}`}
              </dd>
              <dt className="text-fg-secondary">Base path</dt>
              <dd className="break-all font-mono">{location.basePath ?? <Unknown>None</Unknown>}</dd>
              <dt className="text-fg-secondary">Path of the copy</dt>
              <dd className="break-all font-mono">{location.uri}</dd>
            </dl>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddCopyDialog({
  datasetKey,
  endpoints,
  onClose,
}: {
  datasetKey: string;
  endpoints: readonly Endpoint[];
  onClose: () => void;
}) {
  const action = useAction();
  const open = endpoints.filter((endpoint) => endpoint.status !== "retired" && endpoint.archivedAt === null);
  const [endpointKey, setEndpointKey] = useState(open[0]?.id ?? "");
  const [role, setRole] = useState<Role>("mirror");
  const [path, setPath] = useState("");
  const [note, setNote] = useState("");
  const [electroTag, setElectroTag] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Add a copy"
      description="Register where another copy of this dataset is held. Nothing is moved."
      submitLabel="Add the copy"
      failureTitle="The copy was not added."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const pathProblem = storagePathProblem(path.trim());
        setProblem(pathProblem);
        if (pathProblem !== null) return;
        if (
          await action.run(
            () =>
              callFunction(addStorageRefContract, {
                datasetKey,
                endpointKey,
                role,
                path: path.trim(),
                viewerSupport: electroTag ? ["electroTag"] : [],
                note: note.trim(),
              }),
            "The copy has been added.",
            "The copy could not be added. Try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="Storage server">
        {(control) => (
          <Select {...control} value={endpointKey} onChange={(event) => setEndpointKey(event.target.value)}>
            {open.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name} ({PROTOCOL_LABELS[endpoint.protocol]})
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label="Role">
        {(control) => (
          <Select {...control} value={role} onChange={(event) => setRole(event.target.value as Role)}>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField
        label="Path on the server"
        hint="Below the server's base path, inside the folder of your replication or laboratory."
      >
        {(control) => (
          <Input {...control} value={path} maxLength={1_024} onChange={(event) => setPath(event.target.value)} />
        )}
      </FormField>
      <FormField label="Note" hint="Optional.">
        {(control) => <Textarea {...control} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />}
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={electroTag} onChange={(event) => setElectroTag(event.target.checked)} />
        This copy can be opened in ElectroTag (optional)
      </label>
    </FormDialog>
  );
}

function ChangeCopyDialog({
  datasetKey,
  copy,
  endpoints,
  mode,
  onClose,
}: {
  datasetKey: string;
  copy: Ref;
  endpoints: readonly Endpoint[];
  mode: "update" | "retire" | "relocate";
  onClose: () => void;
}) {
  const action = useAction();
  const open = endpoints.filter((endpoint) => endpoint.status !== "retired" && endpoint.archivedAt === null);
  const [role, setRole] = useState<Role>(copy.role);
  const [electroTag, setElectroTag] = useState(copy.viewerSupport.includes("electroTag"));
  const [note, setNote] = useState(copy.note ?? "");
  const [endpointKey, setEndpointKey] = useState(copy.endpointKey);
  const [path, setPath] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const titles = { update: "Change this copy", retire: "Retire this copy", relocate: "Record a relocation" } as const;
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title={titles[mode]}
      {...(mode === "relocate"
        ? {
            description:
              "The copy is closed and a new one opens at the new place, so the move stays in the history. Nothing is moved by the portal.",
          }
        : mode === "retire"
          ? { description: "The copy stays in the history with the time it was closed." }
          : {})}
      submitLabel={mode === "update" ? "Save" : mode === "retire" ? "Retire the copy" : "Record the relocation"}
      failureTitle="Nothing was changed."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const pathProblem = mode === "relocate" ? storagePathProblem(path.trim()) : null;
        setProblem(pathProblem);
        if (pathProblem !== null) return;
        const call = () =>
          callFunction(
            changeStorageRefContract,
            mode === "update"
              ? {
                  action: "update",
                  datasetKey,
                  storageRefId: copy.id,
                  role,
                  viewerSupport: electroTag ? ["electroTag"] : [],
                  note: note.trim(),
                }
              : mode === "retire"
                ? { action: "retire", datasetKey, storageRefId: copy.id, reason: reason.trim() }
                : {
                    action: "relocate",
                    datasetKey,
                    storageRefId: copy.id,
                    endpointKey,
                    path: path.trim(),
                    reason: reason.trim(),
                  },
          );
        if (await action.run(call, "The copy has been changed.", "The copy could not be changed. Try again."))
          onClose();
      }}
    >
      {mode === "update" ? (
        <>
          <FormField label="Role">
            {(control) => (
              <Select {...control} value={role} onChange={(event) => setRole(event.target.value as Role)}>
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={electroTag} onChange={(event) => setElectroTag(event.target.checked)} />
            This copy can be opened in ElectroTag (optional)
          </label>
          <FormField label="Note" hint="Optional.">
            {(control) => (
              <Textarea {...control} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </FormField>
        </>
      ) : (
        <>
          {mode === "relocate" ? (
            <>
              <FormField label="New storage server">
                {(control) => (
                  <Select {...control} value={endpointKey} onChange={(event) => setEndpointKey(event.target.value)}>
                    {open.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField
                label="New path on the server"
                hint="Below the server's base path, inside the folder of your replication or laboratory."
              >
                {(control) => (
                  <Input
                    {...control}
                    value={path}
                    maxLength={1_024}
                    onChange={(event) => setPath(event.target.value)}
                  />
                )}
              </FormField>
            </>
          ) : null}
          <FormField label="Reason">
            {(control) => (
              <Textarea {...control} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
            )}
          </FormField>
        </>
      )}
    </FormDialog>
  );
}

function ViewerLinkDialog({ datasetKey, copy, onClose }: { datasetKey: string; copy: Ref; onClose: () => void }) {
  const action = useAction();
  const [url, setUrl] = useState("");
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Link this copy to ElectroTag"
      description="ElectroTag is optional. The link is shown only to those who may read where the copy is, and each use is recorded."
      submitLabel="Save the link"
      failureTitle="The link was not saved."
      busy={action.busy}
      failure={action.failure}
      onSubmit={async () => {
        if (
          await action.run(
            () =>
              callFunction(saveViewerLinkContract, {
                datasetKey,
                storageRefId: copy.id,
                tool: "electroTag",
                url: url.trim(),
              }),
            "The link has been saved.",
            "The link could not be saved. Check the address and try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="Address in ElectroTag">
        {(control) => (
          <Input {...control} type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

type Dialogs =
  | { readonly kind: "add" }
  | { readonly kind: "location"; readonly refId: string }
  | { readonly kind: "change"; readonly copy: Ref; readonly mode: "update" | "retire" | "relocate" }
  | { readonly kind: "viewer"; readonly copy: Ref }
  | { readonly kind: "listing"; readonly copy: Ref };

export function StorageSection({
  datasetKey,
  refs,
  endpoints,
  manages,
  readsPaths,
}: {
  datasetKey: string;
  refs: readonly Ref[];
  endpoints: readonly Endpoint[];
  manages: boolean;
  readsPaths: boolean;
}) {
  const scan = useAction();
  const viewer = useAction();
  const [dialog, setDialog] = useState<Dialogs | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const endpointOf = (key: string) => endpoints.find((endpoint) => endpoint.id === key);
  const ordered = [...refs].sort(
    (a, b) =>
      (a.validTo === null ? 0 : 1) - (b.validTo === null ? 0 : 1) || b.validFrom.toMillis() - a.validFrom.toMillis(),
  );
  const runScan = async (copy: Ref) => {
    let message = "";
    await scan.run(
      async () => {
        const result = await callFunction(
          scanStorageRefContract,
          { datasetKey, storageRefId: copy.id },
          { timeoutMs: 60_000 },
        );
        message = result.status === "ok" ? `${result.message} ${countsText(result.counts)}.` : result.message;
      },
      null,
      "The scan could not be started. Try again.",
    );
    setScanned(message === "" ? null : message);
  };
  const openViewer = (copy: Ref) =>
    viewer.run(
      async () => {
        const { url } = await callFunction(openViewerLinkContract, {
          datasetKey,
          storageRefId: copy.id,
          tool: "electroTag",
        });
        window.open(url, "_blank", "noopener,noreferrer");
      },
      null,
      "The viewer link could not be opened.",
    );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-fg-secondary">
          Each copy is held on its own server. When a server is down, the copy is marked unavailable and keeps its last
          listing.
        </p>
        {manages ? (
          <Button variant="primary" onClick={() => setDialog({ kind: "add" })}>
            Add a copy
          </Button>
        ) : null}
      </div>
      {scanned === null ? null : (
        <p role="status" className="text-sm" data-testid="scan-result">
          {scanned}
        </p>
      )}
      {scan.failure === null && viewer.failure === null ? null : (
        <p role="alert" className="text-sm text-fg-accent">
          {scan.failure ?? viewer.failure}
        </p>
      )}
      {ordered.length === 0 ? (
        <EmptyState
          title="No copy registered"
          description="Central storage is optional: register a copy wherever the data is held, such as an institutional server."
        />
      ) : (
        <Table caption="Copies of the dataset" data-testid="storage-refs">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Server</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Availability</TableHeaderCell>
              <TableHeaderCell>Last seen</TableHeaderCell>
              <TableHeaderCell>Last scan</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((copy) => {
              const endpoint = endpointOf(copy.endpointKey);
              const current = copy.validTo === null && copy.archivedAt === null;
              const scans = current && manages && endpoint?.scanMode === "remote";
              return (
                <TableRow key={copy.id} data-testid={`storage-ref-${copy.id}`}>
                  <TableCell>
                    <span className="grid">
                      <span>{endpoint?.name ?? copy.endpointKey}</span>
                      {current && endpoint !== undefined && endpoint.status !== "active" ? (
                        <span className="text-xs text-fg-accent">
                          Server {ENDPOINT_STATUS_LABELS[endpoint.status].toLowerCase()}
                          {endpoint.statusReason === undefined ? "" : `: ${endpoint.statusReason}`}
                        </span>
                      ) : null}
                      <span className="text-xs text-fg-muted">
                        {endpoint === undefined ? "" : PROTOCOL_LABELS[endpoint.protocol]}
                        {current ? "" : `, closed ${formatDateTime(copy.validTo?.toDate() ?? new Date())}`}
                        {copy.relocatedFromRefId === null ? "" : ", relocated from an earlier copy"}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[copy.role]}</TableCell>
                  <TableCell>
                    {copy.availability === "unavailable" ? (
                      <Badge tone="accent">{REF_AVAILABILITY_LABELS.unavailable}</Badge>
                    ) : (
                      REF_AVAILABILITY_LABELS[copy.availability]
                    )}
                    {copy.verifiedAt === null ? null : (
                      <span className="block text-xs text-fg-muted">Matches the expected files</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {copy.lastSeenAt === null ? <Unknown>Never</Unknown> : formatDateTime(copy.lastSeenAt.toDate())}
                  </TableCell>
                  <TableCell>
                    {endpoint?.scanMode === "uploadedManifest" && copy.lastScanStatus === "never" ? (
                      "Listings are uploaded from the institution"
                    ) : (
                      <>
                        {SCAN_STATUS_LABELS[copy.lastScanStatus]}
                        {copy.lastScanAt === null ? null : (
                          <span className="block text-xs text-fg-muted">
                            {formatDateTime(copy.lastScanAt.toDate())}
                          </span>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      {scans ? (
                        <Button size="sm" disabled={scan.busy} onClick={() => runScan(copy)}>
                          Scan now
                        </Button>
                      ) : null}
                      {current && manages && endpoint?.scanMode === "uploadedManifest" ? (
                        <Button size="sm" onClick={() => setDialog({ kind: "listing", copy })}>
                          Upload a listing
                        </Button>
                      ) : null}
                      {readsPaths ? (
                        <Button size="sm" onClick={() => setDialog({ kind: "location", refId: copy.id })}>
                          Show the location
                        </Button>
                      ) : null}
                      {readsPaths &&
                      copy.viewerSupport.includes("electroTag") &&
                      copy.viewerLinkTools.includes("electroTag") ? (
                        <Button size="sm" disabled={viewer.busy} onClick={() => openViewer(copy)}>
                          Open in ElectroTag
                        </Button>
                      ) : null}
                      {current &&
                      manages &&
                      copy.viewerSupport.includes("electroTag") &&
                      !copy.viewerLinkTools.includes("electroTag") ? (
                        <Button size="sm" onClick={() => setDialog({ kind: "viewer", copy })}>
                          Add an ElectroTag link
                        </Button>
                      ) : null}
                      {current && manages ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: "change", copy, mode: "update" })}
                          >
                            Change
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: "change", copy, mode: "relocate" })}
                          >
                            Relocate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDialog({ kind: "change", copy, mode: "retire" })}
                          >
                            Retire
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {dialog?.kind === "add" ? (
        <AddCopyDialog datasetKey={datasetKey} endpoints={endpoints} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "location" ? (
        <LocationDialog datasetKey={datasetKey} refId={dialog.refId} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "change" ? (
        <ChangeCopyDialog
          datasetKey={datasetKey}
          copy={dialog.copy}
          endpoints={endpoints}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "listing" ? (
        <UploadManifestDialog
          datasetKey={datasetKey}
          refs={refs}
          endpointName={(key) => endpointOf(key)?.name ?? key}
          listingOf={dialog.copy.id}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "viewer" ? (
        <ViewerLinkDialog datasetKey={datasetKey} copy={dialog.copy} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
