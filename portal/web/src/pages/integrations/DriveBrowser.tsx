// Browsing a linked Drive folder and the details of its files, as the portal's Google account
// sees them: the functions answer only what the reader of the link may see, never the content of
// a file, and an item opens at Google's own address, where Google applies the reader's own
// permissions.
import {
  browseDriveFolderContract,
  type CallableOutput,
  type DriveItem,
  previewDriveFileContract,
} from "@eegml/shared";
import { ChevronRight, ExternalLink, File as FileIcon, FileSpreadsheet, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CallableError, callFunction, useCallResult } from "@/data";
import { OPEN_ITEM_LABEL, SyntheticGoogleNotice } from "./synthetic-google";

type Listing = CallableOutput<typeof browseDriveFolderContract>;

const KIND_ICONS = { folder: Folder, document: FileText, spreadsheet: FileSpreadsheet, file: FileIcon } as const;
const KIND_LABELS = { folder: "Folder", document: "Google Doc", spreadsheet: "Google Sheet", file: "File" } as const;

function OpenInGoogle({ item }: { item: DriveItem }) {
  if (item.url === null) return null;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-fg-accent underline"
    >
      {OPEN_ITEM_LABEL}
      <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function ItemFacts({ item }: { item: DriveItem }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <dt className="text-fg-muted">Kind</dt>
      <dd>{KIND_LABELS[item.kind]}</dd>
      <dt className="text-fg-muted">Owner</dt>
      <dd>{item.ownerName ?? <Unknown>A shared drive, with no single owner</Unknown>}</dd>
      <dt className="text-fg-muted">Last modified</dt>
      <dd>
        {item.modifiedAt === null ? <Unknown /> : formatDateTime(item.modifiedAt)}
        {item.lastModifiedBy === null ? null : `, by ${item.lastModifiedBy}`}
      </dd>
    </dl>
  );
}

/**
 * The details of one file: what Drive says about it, and Google's own address for it. The portal
 * never shows the content of a file: Google applies the reader's own permissions when it opens.
 */
export function FilePreview({ linkId, fileId }: { linkId: string; fileId?: string }) {
  const input = fileId === undefined ? { linkId } : { linkId, fileId };
  const { live, reload } = useCallResult(previewDriveFileContract, input, `${linkId}:${fileId ?? ""}`);
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the details"
      errorTitle="The details could not be loaded."
      onRetry={reload}
      fromCallable
    >
      {(preview) => (
        <section aria-label={`Details of ${preview.file.name}`} className="grid gap-3" data-testid="drive-preview">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-md font-medium text-fg-strong">{preview.file.name}</h3>
            <OpenInGoogle item={preview.file} />
          </div>
          <ItemFacts item={preview.file} />
          <p className="text-fg-secondary">
            The portal never shows the content of a file. Open it at its own address, where your own permissions apply.
          </p>
        </section>
      )}
    </LiveView>
  );
}

function FolderListing({
  linkId,
  folderId,
  onFolder,
  onFile,
}: {
  linkId: string;
  folderId: string | undefined;
  onFolder: (id: string) => void;
  onFile: (item: DriveItem) => void;
}) {
  const input = folderId === undefined ? { linkId } : { linkId, folderId };
  const { live, reload } = useCallResult(browseDriveFolderContract, input, `${linkId}:${folderId ?? ""}`);
  const [more, setMore] = useState<{ readonly items: readonly DriveItem[]; readonly next: string | null } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const loadMore = async (listing: Listing) => {
    const token = more?.next ?? listing.nextPageToken;
    if (token === null) return;
    try {
      const page = await callFunction(browseDriveFolderContract, { ...input, pageToken: token });
      setMore({ items: [...(more?.items ?? []), ...page.items], next: page.nextPageToken });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The next items could not be loaded.");
    }
  };
  return (
    <LiveView
      live={live}
      loadingLabel="Loading the folder"
      errorTitle="The folder could not be opened."
      onRetry={reload}
      fromCallable
    >
      {(listing) => {
        const items = [...listing.items, ...(more?.items ?? [])];
        const next = more === null ? listing.nextPageToken : more.next;
        return (
          <div className="grid gap-3">
            <nav aria-label="Folders">
              <ol className="flex flex-wrap items-center gap-1 text-sm">
                {listing.path.map((folder, index) => (
                  <li key={folder.id} className="flex items-center gap-1">
                    {index === 0 ? null : <ChevronRight aria-hidden="true" className="size-3.5 text-fg-muted" />}
                    {index === listing.path.length - 1 ? (
                      <span aria-current="location" className="font-medium text-fg-strong">
                        {folder.name}
                      </span>
                    ) : (
                      <button type="button" className="text-fg-accent underline" onClick={() => onFolder(folder.id)}>
                        {folder.name}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            {items.length === 0 ? (
              <EmptyState
                title="This folder is empty"
                description="Or nothing in it is shared with the portal's account."
              />
            ) : (
              <ul
                className="grid divide-y divide-border rounded-control border border-border"
                data-testid="drive-items"
              >
                {items.map((item) => {
                  const Icon = KIND_ICONS[item.kind];
                  return (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 text-left text-fg-strong hover:text-fg-accent"
                        onClick={() => (item.kind === "folder" ? onFolder(item.id) : onFile(item))}
                      >
                        <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                        <span className="break-all">{item.name}</span>
                        <span className="sr-only">
                          , {KIND_LABELS[item.kind]},{" "}
                          {item.kind === "folder" ? "open the folder" : "see the details of the file"}
                        </span>
                      </button>
                      <span className="text-xs text-fg-muted">
                        {item.modifiedAt === null ? "" : formatDateTime(item.modifiedAt)}
                        {item.ownerName === null ? "" : `, ${item.ownerName}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {failure === null ? null : <p className="text-fg-accent">{failure}</p>}
            {next === null ? null : (
              <div>
                <Button size="sm" onClick={() => void loadMore(listing)}>
                  Show more items
                </Button>
              </div>
            )}
          </div>
        );
      }}
    </LiveView>
  );
}

/** The dialog in which a reader browses a linked folder and sees the details of its files. */
export function DriveBrowserDialog({
  linkId,
  title,
  folder,
  open,
  onOpenChange,
  returnFocus,
}: {
  linkId: string;
  title: string;
  /** Whether the link is to a folder. A link to a file opens straight on its details. */
  folder: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened the dialog, which focus returns to. */
  returnFocus: () => HTMLElement | null;
}) {
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [file, setFile] = useState<DriveItem | null>(null);
  const close = (next: boolean) => {
    if (!next) {
      setFolderId(undefined);
      setFile(null);
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={title}
        description="The names of what the portal's Google account can see here, shown to you because you read this link. Files open in Google with your own permissions."
        className="max-w-4xl"
        returnFocus={returnFocus}
      >
        <div className="mt-4 grid gap-4">
          <SyntheticGoogleNotice />
          {!folder ? (
            <FilePreview linkId={linkId} />
          ) : file === null ? (
            <FolderListing linkId={linkId} folderId={folderId} onFolder={setFolderId} onFile={setFile} />
          ) : (
            <div className="grid gap-3">
              <div>
                <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                  Back to the folder
                </Button>
              </div>
              <FilePreview linkId={linkId} fileId={file.id} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
