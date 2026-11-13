// The files of a dataset, for those who may read paths: the expected manifest and the listings
// of each copy, compared with it file by file, with what is missing, unexpected, duplicated or
// different. A listing of a server the portal cannot reach is made inside the institution and
// uploaded here, as a checksum file or comma-separated values; nothing in it is a recording.
import { parseManifestText, recordManifestContract } from "@eegml/shared";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { type RecordColumn, RecordTable } from "@/components/record-table";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { fileChunksOf, type PathsUnit } from "@/registry/dataset-queries";
import { FormDialog, useAction } from "./dataset-actions";
import { countsText, FILE_STATUS_LABELS, formatBytes, ROLE_LABELS } from "./dataset-format";

type Manifest = RecordOf<"datasetManifests">;
type File = RecordOf<"datasetManifestFileChunks">["files"][number];
type FileStatus = File["status"];

const FILE_COLUMNS: readonly RecordColumn<File & { readonly key: string }, "path">[] = [
  {
    id: "path",
    header: "Path",
    sortKey: "path",
    className: "min-w-64",
    cell: (file) => <span className="break-all tabular-nums text-xs">{file.relativePath}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: (file) =>
      file.status === "present" || file.status === "expected" ? (
        FILE_STATUS_LABELS[file.status]
      ) : (
        <Badge tone="accent">{FILE_STATUS_LABELS[file.status]}</Badge>
      ),
  },
  {
    id: "size",
    header: "Size",
    cell: (file) => (file.sizeBytes === undefined ? <Unknown /> : formatBytes(file.sizeBytes)),
  },
  {
    id: "checksum",
    header: "Checksum",
    cell: (file) =>
      file.checksum === undefined ? (
        <Unknown>None held</Unknown>
      ) : (
        <span className="tabular-nums text-xs" title={file.checksum}>
          {file.checksumAlgorithm} {file.checksum.slice(0, 12)}
        </span>
      ),
  },
];

function ManifestFiles({ datasetKey, manifest, unit }: { datasetKey: string; manifest: Manifest; unit: PathsUnit }) {
  const chunks = useLiveQuery(fileChunksOf(datasetKey, manifest.id, unit));
  const [status, setStatus] = useState<FileStatus | "">("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<string | null>(null);
  return (
    <LiveView
      live={chunks}
      loadingLabel="Loading the files"
      errorTitle="The files could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const files = [...list]
          .sort((a, b) => a.index - b.index)
          .flatMap((chunk) => chunk.files)
          .map((file, index) => ({ ...file, key: `${index}:${file.relativePath}` }));
        const shown = files
          .filter((file) => status === "" || file.status === status)
          .sort((a, b) => (direction === "asc" ? 1 : -1) * a.relativePath.localeCompare(b.relativePath, "en"));
        return (
          <div className="grid gap-2">
            <FormField label="Show files">
              {(control) => (
                <Select
                  {...control}
                  className="max-w-64"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as FileStatus | "")}
                >
                  <option value="">Every file</option>
                  {(Object.keys(FILE_STATUS_LABELS) as FileStatus[]).map((value) => (
                    <option key={value} value={value}>
                      {FILE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {shown.length === 0 ? (
              <p className="text-sm text-fg-secondary">No file has this status.</p>
            ) : (
              <RecordTable
                caption="Files of the manifest"
                rows={shown}
                columns={FILE_COLUMNS}
                rowKey={(file) => file.key}
                rowLabel={(file) => file.relativePath}
                sortKey="path"
                direction={direction}
                onSort={() => setDirection(direction === "asc" ? "desc" : "asc")}
                onOpen={(file) => setOpen(file.key)}
                openKey={open}
                virtualise={shown.length > 40 ? { rowHeight: 40, viewportHeight: 480 } : undefined}
                data-testid="manifest-files"
              />
            )}
          </div>
        );
      }}
    </LiveView>
  );
}

/** The dialog that records a manifest: the expected files, or a listing of one copy, which `listingOf` presets. */
export function UploadManifestDialog({
  datasetKey,
  refs,
  endpointName,
  listingOf,
  onClose,
}: {
  datasetKey: string;
  refs: readonly RecordOf<"datasetStorageRefs">[];
  endpointName: (key: string) => string;
  listingOf?: string;
  onClose: () => void;
}) {
  const action = useAction();
  const current = refs.filter((ref) => ref.validTo === null && ref.archivedAt === null);
  const [kind, setKind] = useState<"expected" | "listing">(listingOf === undefined ? "expected" : "listing");
  const [refId, setRefId] = useState(listingOf ?? current[0]?.id ?? "");
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() === "" ? null : parseManifestText(text)), [text]);
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Record a manifest"
      description="Paste the output of sha256sum or md5sum, or comma-separated values with a header that names path, size, checksum and algorithm. Only names, sizes and checksums are recorded."
      submitLabel="Record the manifest"
      failureTitle="Nothing was recorded."
      busy={action.busy}
      failure={
        action.failure ??
        (parsed !== null && parsed.problems.length > 0
          ? `Line ${parsed.problems[0]?.position}: ${parsed.problems[0]?.message}`
          : null)
      }
      onSubmit={async () => {
        if (parsed === null || parsed.problems.length > 0 || parsed.files.length === 0) return;
        const recorded = await action.run(
          () =>
            callFunction(
              recordManifestContract,
              {
                datasetKey,
                kind,
                storageRefId: kind === "listing" ? refId : null,
                origin: "upload",
                files: parsed.files.map((file) => ({ ...file })),
              },
              { timeoutMs: 60_000 },
            ),
          kind === "expected"
            ? "The expected files have been recorded."
            : "The listing has been recorded and compared.",
          "The manifest could not be recorded. Try again.",
        );
        if (recorded) onClose();
      }}
    >
      <FormField label="What the manifest states">
        {(control) => (
          <Select {...control} value={kind} onChange={(event) => setKind(event.target.value as "expected" | "listing")}>
            <option value="expected">The files the dataset should hold</option>
            {current.length === 0 ? null : (
              <option value="listing">What one copy holds, listed inside the institution</option>
            )}
          </Select>
        )}
      </FormField>
      {kind === "listing" ? (
        <FormField label="Copy">
          {(control) => (
            <Select {...control} value={refId} onChange={(event) => setRefId(event.target.value)}>
              {current.map((ref) => (
                <option key={ref.id} value={ref.id}>
                  {ROLE_LABELS[ref.role]} copy on {endpointName(ref.endpointKey)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}
      <FormField
        label="Manifest"
        hint={parsed === null ? "Paste the text, or load a file below." : `${parsed.files.length} files read.`}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={8}
            className="tabular-nums text-xs"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Or load a file">
        {(control) => (
          <input
            {...control}
            type="file"
            accept=".txt,.csv,.sha256,.md5,text/plain,text/csv"
            className="text-sm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) setText(await file.text());
            }}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

export function FilesSection({
  datasetKey,
  manifests,
  refs,
  expectedManifestId,
  unit,
  manages,
  endpointName,
}: {
  datasetKey: string;
  manifests: readonly Manifest[];
  refs: readonly RecordOf<"datasetStorageRefs">[];
  /** The name of a storage server, by its key. */
  endpointName: (key: string) => string;
  expectedManifestId: string | null;
  unit: PathsUnit;
  manages: boolean;
}) {
  const ordered = [...manifests].sort((a, b) => b.listedAt.toMillis() - a.listedAt.toMillis());
  const latest = ordered.find((manifest) => manifest.kind === "listing") ?? ordered[0];
  const [selected, setSelected] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const shown = ordered.find((manifest) => manifest.id === selected) ?? latest;
  const refName = (id: string | null) => {
    const ref = refs.find((candidate) => candidate.id === id);
    return ref === undefined
      ? "the expected files"
      : `${ROLE_LABELS[ref.role].toLowerCase()} copy on ${endpointName(ref.endpointKey)}`;
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-sm text-fg-secondary">
          Missing means that a listing which succeeded lacked the file. A server that could not be reached produces no
          listing, so nothing is reported missing because of an outage.
        </p>
        {manages ? (
          <Button variant="primary" onClick={() => setUploading(true)}>
            Record a manifest
          </Button>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <EmptyState
          title="No manifest yet"
          description="Record the expected files, then scan a copy or upload a listing made inside the institution to compare them."
        />
      ) : (
        <>
          <ul className="grid gap-1" aria-label="Manifests">
            {ordered.map((manifest) => (
              <li key={manifest.id}>
                <button
                  type="button"
                  aria-pressed={manifest.id === shown?.id}
                  onClick={() => setSelected(manifest.id)}
                  className="w-full rounded-control border border-border px-3 py-2 text-left text-sm hover:border-accent-strong aria-pressed:border-accent-strong"
                >
                  <span className="font-medium">
                    {manifest.kind === "expected"
                      ? "Expected files"
                      : `Listing of the ${refName(manifest.storageRefId)}`}
                  </span>
                  {manifest.id === expectedManifestId ? <Badge className="ml-2">Current expectation</Badge> : null}
                  <span className="block text-xs text-fg-secondary">
                    {formatDateTime(manifest.listedAt.toDate())}, {manifest.origin === "scan" ? "scanned" : "uploaded"},{" "}
                    {countsText(manifest.counts)}, {manifest.checksumCount} with a checksum
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown === undefined ? null : (
            <ManifestFiles key={shown.id} datasetKey={datasetKey} manifest={shown} unit={unit} />
          )}
        </>
      )}
      {uploading ? (
        <UploadManifestDialog
          datasetKey={datasetKey}
          refs={refs}
          endpointName={endpointName}
          onClose={() => setUploading(false)}
        />
      ) : null}
    </div>
  );
}
