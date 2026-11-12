// The documents linked to a replication or a laboratory: Drive files and folders with their owner,
// their last change and an open link, a way to browse and preview what the portal's account can
// see, and the linking of a new item by those who manage the record. Whether an account may
// link, browse or check is decided by the functions and the rules; the page only spares a reader
// a control that would be refused.
import { checkDriveLinkContract, type DriveLinkTarget, linkDriveResourceContract } from "@eegml/shared";
import { ExternalLink } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf } from "@/data";
import { DOCUMENT_ACCESS_LABELS, DOCUMENT_KIND_LABELS } from "@/registry/labels";
import { DriveBrowserDialog } from "./DriveBrowser";
import { SyntheticGoogleNotice } from "./synthetic-google";

type Link = RecordOf<"documentLinks">;

/** A record that a Drive item can be linked to, as the dialog offers it. */
export interface LinkTargetOption {
  readonly value: string;
  readonly label: string;
  readonly entityType: DriveLinkTarget;
  readonly entityId: string;
}

const TARGET_LABELS: Readonly<Record<string, string>> = {
  replication: "Replication",
  laboratory: "Laboratory",
  manuscript: "Manuscript",
  dataset: "Dataset",
  participation: "Participation",
  hypothesis: "Hypothesis",
  protocol: "Protocol",
  protocolVersion: "Protocol version",
};

/** The address Google gives an item, or a link that is not to Drive, with an external marker. */
/** Whether a link is to an Excel workbook kept in Drive, which the portal does not import yet (docs/INTEGRATIONS.md, section 3.4). */
function isWorkbook(link: Link): boolean {
  return /\.xlsx?$/i.test(link.title ?? "");
}

function ExternalAddress({ link }: { link: Link }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-fg-accent underline"
    >
      {link.title ?? link.url}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function LinkDriveDialog({
  open,
  onOpenChange,
  targets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: readonly LinkTargetOption[];
}) {
  const toast = useToast();
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const [address, setAddress] = useState("");
  const [restricted, setRestricted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shareWith, setShareWith] = useState<string | null>(null);
  const chosen = targets.find((option) => option.value === target);

  const close = (next: boolean) => {
    if (!next) {
      setAddress("");
      setFailure(null);
      setShareWith(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (address.trim() === "" || chosen === undefined) {
      setFailure("Enter the address of the item and say what it belongs to.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await callFunction(linkDriveResourceContract, {
        entityType: chosen.entityType,
        entityId: chosen.entityId,
        address: address.trim(),
        restricted,
      });
      if (result.accessStatus === "shared") {
        toast.show({ title: `${result.title ?? "The item"} is linked.` });
        close(false);
      } else {
        setShareWith(result.shareWith);
      }
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The item could not be linked. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Link a Google Drive file or folder"
        description="Paste the address of a file or folder you own or may edit in Google Drive. Everyone who reads this link sees the names of the files in a linked folder, never their content."
      >
        {shareWith === null ? (
          <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
            {failure ? <ErrorState title="Nothing was linked." description={failure} /> : null}
            <FormField label="Address in Google Drive">
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  inputMode="url"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="https://drive.google.com/drive/folders/…"
                />
              )}
            </FormField>
            <FormField label="It belongs to">
              {(control) => (
                <Select {...control} value={target} onChange={(event) => setTarget(event.target.value)}>
                  {targets.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} />
              For the team of the record only. Clear this to show the link to every member.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Working on it…" : "Link the item"}
              </Button>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
            </div>
          </form>
        ) : (
          <div className="mt-5 grid gap-3" data-testid="share-step">
            <p>The link is kept, and the portal cannot open the item yet.</p>
            <p>
              Ask its owner to share it with <strong className="break-all">{shareWith}</strong> as a viewer, then use
              Check again on the link.
            </p>
            <div>
              <DialogClose asChild>
                <Button variant="primary">Done</Button>
              </DialogClose>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The linked documents of a record, with the actions the reader may take on them. */
export function DriveLinks({
  links,
  canLink,
  targets,
  caption,
}: {
  links: readonly Link[];
  /** Whether the reader manages the record, and so may link and check items. */
  canLink: boolean;
  targets: readonly LinkTargetOption[];
  caption: string;
}) {
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [browsing, setBrowsing] = useState<Link | null>(null);
  // The control that opened the browser, which focus returns to when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const shown = [...links]
    .filter((link) => link.archivedAt === null)
    .sort((a, b) => (a.title ?? a.url).localeCompare(b.title ?? b.url));
  const check = async (link: Link) => {
    setChecking(link.id);
    try {
      const result = await callFunction(checkDriveLinkContract, { linkId: link.id });
      toast.show(
        result.accessStatus === "shared"
          ? { title: "The portal can open the item." }
          : {
              title: "The portal cannot open the item.",
              description: `Ask its owner to share it with ${result.shareWith ?? "the portal's account"}.`,
            },
      );
    } catch (error) {
      toast.show({
        title: "The link could not be checked.",
        description: error instanceof CallableError ? error.message : "",
      });
    } finally {
      setChecking(null);
    }
  };
  return (
    <section aria-labelledby="linked-documents" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="linked-documents" className="text-lg text-fg-strong">
          Linked documents
        </h2>
        {canLink ? (
          <Button size="sm" onClick={() => setLinking(true)}>
            Link a Drive file or folder
          </Button>
        ) : null}
      </div>
      <SyntheticGoogleNotice />
      {shown.length === 0 ? (
        <EmptyState
          title="No document is linked"
          description={
            canLink
              ? "Link a folder or file of Google Drive to keep it with the record."
              : "Those who manage the record link its documents."
          }
        />
      ) : (
        <div className="relative overflow-x-auto">
          <Table caption={caption}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Belongs to</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Last modified</TableHeaderCell>
                <TableHeaderCell>Access</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((link) => {
                const drive = link.externalId !== undefined;
                return (
                  <TableRow key={link.id} className="align-top" data-testid="document-link">
                    <TableCell>
                      <ExternalAddress link={link} />
                      <span className="block text-xs text-fg-muted">
                        {isWorkbook(link) ? "Excel workbook" : DOCUMENT_KIND_LABELS[link.kind]}
                      </span>
                    </TableCell>
                    <TableCell>
                      {TARGET_LABELS[link.entityType] ?? link.entityType}
                      <span className="block break-all text-xs text-fg-muted">{link.entityId}</span>
                    </TableCell>
                    <TableCell>{link.ownerName ?? <Unknown />}</TableCell>
                    <TableCell>
                      {link.modifiedAt === undefined ? <Unknown /> : formatDateTime(link.modifiedAt.toDate())}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {DOCUMENT_ACCESS_LABELS[link.accessStatus]}
                        {link.restricted ? <Badge tone="outline">Team only</Badge> : null}
                      </span>
                      {drive && link.accessStatus === "restricted" ? (
                        <span className="mt-1 block max-w-64 text-xs text-fg-secondary">
                          The portal cannot open it. Ask its owner to share it with the portal's Google account, then
                          check it again.
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {drive && link.accessStatus === "shared" && isWorkbook(link) ? (
                          <span className="text-xs text-fg-secondary">Excel workbooks are not imported yet</span>
                        ) : drive && link.accessStatus === "shared" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(event) => {
                              opener.current = event.currentTarget;
                              setBrowsing(link);
                            }}
                          >
                            {link.kind === "driveFolder" ? "Browse" : "Details"}
                            <span className="sr-only"> {link.title ?? link.url}</span>
                          </Button>
                        ) : null}
                        {drive && canLink ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={checking === link.id}
                            onClick={() => void check(link)}
                          >
                            {checking === link.id ? "Checking…" : "Check again"}
                            <span className="sr-only"> {link.title ?? link.url}</span>
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
      )}
      {canLink ? <LinkDriveDialog open={linking} onOpenChange={setLinking} targets={targets} /> : null}
      {browsing === null ? null : (
        <DriveBrowserDialog
          linkId={browsing.id}
          title={browsing.title ?? "Linked item"}
          folder={browsing.kind === "driveFolder"}
          open
          onOpenChange={(open) => (open ? null : setBrowsing(null))}
          returnFocus={() => opener.current}
        />
      )}
    </section>
  );
}
