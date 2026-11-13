// One export of the publishing log: its preview against the website's files, field by field, the
// report of its staging build, its approval and its pull request, and what may be done next.
import {
  approvePublicationContract,
  proposePublicationRollbackContract,
  refreshPublicationContract,
  WEBSITE_FILES,
  type WebsiteFileKey,
  withdrawPublicationContract,
} from "@eegml/shared";
import { useState } from "react";
import { useParams } from "react-router";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Detail, Details } from "@/components/registry/details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveDocument, useLiveQuery } from "@/data";
import { useViewer } from "@/registry/viewer";
import { AdminPage } from "../AdminPage";
import { ReasonDialog } from "../ReasonDialog";
import {
  FAKE_STAGED_STEP,
  isFakePullRequest,
  NEXT_STEP,
  OUTPUT_LABELS,
  STATUS_LABELS,
  verifyCommand,
} from "./publishing-format";

const KIND_LABELS = { added: "Added", removed: "Removed", changed: "Changed" } as const;

function FileDiff({ file }: { file: RecordOf<"publicationFiles"> }) {
  const { counts } = file.diff;
  return (
    <section className="grid gap-2" aria-label={`Changes to ${file.path}`} data-testid="publication-file">
      <h3 className="text-md font-medium text-fg-strong">
        <code>{file.path}</code>
        {file.diff.created ? (
          <Badge tone="outline" className="ml-2">
            New file
          </Badge>
        ) : null}
      </h3>
      <p className="text-sm text-fg-secondary">
        {counts.added} added, {counts.changed} changed and {counts.removed} removed rows; {counts.unchanged} unchanged.
        {file.diff.bytesChanged ? "" : " The file is unchanged."}
        {file.diff.rowsOmitted > 0 ? ` ${file.diff.rowsOmitted} more changed rows are in the files themselves.` : ""}
      </p>
      {file.diff.rows.length === 0 ? null : file.diff.bytesChanged ? (
        <Changes file={file} />
      ) : (
        <details>
          <summary className="cursor-pointer text-sm">Show the rows of the unchanged file</summary>
          <Changes file={file} />
        </details>
      )}
    </section>
  );
}

/**
 * The rows of a file that change, field by field: a table from the small breakpoint up, and below
 * it a stacked list, so that on a phone each value can be read without scrolling sideways. A
 * value an added row did not have before is not shown as an empty column.
 */
function Changes({ file }: { file: RecordOf<"publicationFiles"> }) {
  return (
    <>
      <ol className="grid gap-2 sm:hidden" aria-label={`Changes to the rows of ${file.path}`}>
        {file.diff.rows.map((row) => (
          <li key={row.key} className="grid gap-1 rounded-control border border-border px-3 py-2 text-sm">
            <p>
              <span className="font-medium break-all">{row.key}</span>: {KIND_LABELS[row.kind].toLowerCase()}
            </p>
            <dl className="grid gap-1">
              {row.fields.map((field) => (
                <div key={field.column}>
                  <dt className="text-fg-secondary">{field.column}</dt>
                  <dd className="break-all">
                    {row.kind === "added" || field.before === "" ? (
                      field.after
                    ) : row.kind === "removed" ? (
                      <span className="text-fg-secondary">{field.before}</span>
                    ) : (
                      <>
                        <span className="text-fg-secondary">{field.before}</span> <span aria-hidden="true">→</span>
                        <span className="sr-only"> becomes </span> {field.after}
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      <div className="relative hidden overflow-x-auto sm:block">
        <Table caption={`Row by row changes to ${file.path}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Row</TableHeaderCell>
              <TableHeaderCell>Change</TableHeaderCell>
              <TableHeaderCell>Field</TableHeaderCell>
              <TableHeaderCell>Before</TableHeaderCell>
              <TableHeaderCell>After</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {file.diff.rows.flatMap((row) =>
              row.fields.map((field, index) => (
                <TableRow key={`${row.key}/${field.column}`} className="align-top" data-testid="diff-field">
                  <TableCell>{index === 0 ? row.key : ""}</TableCell>
                  <TableCell>{index === 0 ? KIND_LABELS[row.kind] : ""}</TableCell>
                  <TableCell>{field.column}</TableCell>
                  <TableCell className="break-all text-fg-secondary">{field.before}</TableCell>
                  <TableCell className="break-all">{field.after}</TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Verification({ batch }: { batch: RecordOf<"publicationBatches"> }) {
  if (batch.verification === null) {
    return batch.status !== "previewed" ? null : (
      <section className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3" aria-label="Staging build">
        <h2 className="text-md font-medium text-fg-strong">Staging build</h2>
        <p className="text-sm text-fg-secondary">
          The site is built from these files in a scratch copy of the website's repository, outside it, with the site's
          own build command, and the result is checked. Run this from the portal directory on a trusted machine:
        </p>
        <pre
          className="whitespace-pre-wrap break-all rounded-control border border-border bg-surface-muted px-3 py-2 text-sm"
          data-testid="verify-command"
        >
          {verifyCommand(batch.id)}
        </pre>
      </section>
    );
  }
  const { verification } = batch;
  return (
    <section className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3" aria-label="Staging build">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-md font-medium text-fg-strong">Staging build</h2>
        <Badge tone={verification.passed ? "neutral" : "accent"} data-testid="verification-result">
          {verification.passed ? "Passed" : "Failed"}
        </Badge>
      </div>
      <p className="text-sm text-fg-secondary">
        Built {formatDateTime(verification.checkedAt.toDate())} with the command{" "}
        <code className="break-all">{verification.buildCommand}</code>
      </p>
      <ul className="grid gap-1 text-sm">
        {verification.checks.map((check) => (
          <li key={check.key}>
            <span className="font-medium">{check.passed ? "Passed" : "Failed"}:</span> {check.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApproveDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: RecordOf<"publicationBatches">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const approve = () => {
    setBusy(true);
    setFailure(null);
    callFunction(approvePublicationContract, { batchId: batch.id, payloadSha256: batch.payloadSha256 })
      .then(() => onOpenChange(false))
      .catch((error: unknown) =>
        setFailure(error instanceof CallableError ? error.message : "The export was not approved. Try again."),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Approve the live write"
        description="A branch is created in the website's repository, these files are committed to it and a pull request is opened, which deploys the shared staging site. Nothing is merged: a maintainer checks the staging site and merges."
      >
        <div className="mt-5 grid gap-4">
          {batch.syntheticData ? (
            <p className="text-sm text-fg-accent">
              This export holds demonstration data and is made in the emulator. Its pull request goes to the fake of the
              website repository and says it must never be merged.
            </p>
          ) : null}
          <p className="text-sm">
            You approve exactly the files that were built, whose hash is{" "}
            <code className="break-all">{batch.payloadSha256}</code>.
          </p>
          {failure === null ? null : <ErrorState title="Nothing was published." description={failure} />}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={approve} disabled={busy}>
              {busy ? "Opening the pull request…" : "Approve and open the pull request"}
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Actions({ batch }: { batch: RecordOf<"publicationBatches"> }) {
  const viewer = useViewer();
  const [approving, setApproving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mayApprove = viewer?.can("publishing.approve", "programme") === true;
  const refresh = () => {
    setRefreshing(true);
    setFailure(null);
    callFunction(refreshPublicationContract, { batchId: batch.id })
      .catch((error: unknown) =>
        setFailure(error instanceof CallableError ? error.message : "The pull request could not be read. Try again."),
      )
      .finally(() => setRefreshing(false));
  };
  const waiting =
    batch.status === "staged" || (batch.status === "published" && batch.rollbackPullRequestNumber !== undefined);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {batch.status === "verified" && mayApprove ? (
          <Button variant="primary" onClick={() => setApproving(true)}>
            Approve the live write
          </Button>
        ) : null}
        {waiting ? (
          <Button onClick={refresh} disabled={refreshing}>
            {refreshing ? "Reading the pull request…" : "Check the pull request again"}
          </Button>
        ) : null}
        {["previewed", "verified", "staged"].includes(batch.status) ? (
          <Button onClick={() => setWithdrawing(true)}>Withdraw the export</Button>
        ) : null}
        {batch.status === "published" && batch.rollbackPullRequestNumber === undefined && mayApprove ? (
          <Button onClick={() => setRollingBack(true)}>Propose a rollback</Button>
        ) : null}
      </div>
      {batch.status === "verified" && !mayApprove ? (
        <p className="text-sm text-fg-secondary">
          An administrator who holds the right to approve publications approves it.
        </p>
      ) : null}
      {failure === null ? null : <ErrorState title="Nothing was changed." description={failure} />}
      <ApproveDialog batch={batch} open={approving} onOpenChange={setApproving} />
      <ReasonDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title="Withdraw the export"
        description="The export stays in the log with your reason, and an open pull request of it is closed without being merged."
        label="Reason"
        maxLength={500}
        confirmLabel="Withdraw"
        onConfirm={async (reason) => {
          await callFunction(withdrawPublicationContract, { batchId: batch.id, reason });
        }}
      />
      <ReasonDialog
        open={rollingBack}
        onOpenChange={setRollingBack}
        title="Propose a rollback"
        description="A pull request is opened that restores every file this export replaced, as the log kept it. A maintainer merges it."
        label="Reason"
        maxLength={500}
        confirmLabel="Open the rollback pull request"
        onConfirm={async (reason) => {
          await callFunction(proposePublicationRollbackContract, { batchId: batch.id, reason });
        }}
      />
    </div>
  );
}

function Batch({ batch }: { batch: RecordOf<"publicationBatches"> }) {
  const files = useLiveQuery({ collection: "publicationFiles", within: [batch.id], limit: 20 });
  const order = Object.keys(WEBSITE_FILES) as WebsiteFileKey[];
  return (
    <div className="grid gap-6">
      <section className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3" aria-label="Export">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={batch.status === "failed" ? "accent" : "solid"} data-testid="publication-status">
            {STATUS_LABELS[batch.status]}
          </Badge>
          {batch.syntheticData ? <Badge tone="outline">Demonstration data</Badge> : null}
        </div>
        <p className="text-sm">
          {batch.status === "staged" && batch.pullRequestUrl !== undefined && isFakePullRequest(batch.pullRequestUrl)
            ? FAKE_STAGED_STEP
            : NEXT_STEP[batch.status]}
        </p>
        {batch.statusReason === undefined ? null : <p className="text-sm text-fg-accent">{batch.statusReason}</p>}
        <Details>
          <Detail term="Outputs">{batch.outputs.map((output) => OUTPUT_LABELS[output]).join(", ")}</Detail>
          <Detail term="Prepared">{formatDateTime(batch.requestedAt.toDate())}</Detail>
          <Detail term="Compared with commit">
            <code className="break-all">{batch.baseCommit}</code>
          </Detail>
          {batch.approvedAt === null ? null : (
            <Detail term="Approved">{formatDateTime(batch.approvedAt.toDate())}</Detail>
          )}
          {batch.pullRequestUrl === undefined ? null : (
            <Detail term="Pull request">
              {isFakePullRequest(batch.pullRequestUrl) ? (
                <span data-testid="pull-request-link" data-href={batch.pullRequestUrl}>
                  Pull request {batch.pullRequestNumber} on the fake website repository (not on GitHub)
                </span>
              ) : (
                <a
                  className="text-fg-accent underline"
                  href={batch.pullRequestUrl}
                  rel="noreferrer"
                  target="_blank"
                  data-testid="pull-request-link"
                >
                  Pull request {batch.pullRequestNumber}
                </a>
              )}
            </Detail>
          )}
          {batch.publishedAt === null ? null : (
            <Detail term="Published">{formatDateTime(batch.publishedAt.toDate())}</Detail>
          )}
          {batch.rollbackPullRequestUrl === undefined ? null : (
            <Detail term="Rollback">
              {isFakePullRequest(batch.rollbackPullRequestUrl) ? (
                <span>
                  Pull request {batch.rollbackPullRequestNumber} on the fake website repository (not on GitHub)
                </span>
              ) : (
                <a
                  className="text-fg-accent underline"
                  href={batch.rollbackPullRequestUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Pull request {batch.rollbackPullRequestNumber}
                </a>
              )}
            </Detail>
          )}
        </Details>
        <Actions batch={batch} />
      </section>
      <Verification batch={batch} />
      {batch.notes.length === 0 ? null : (
        <section className="grid gap-1" aria-label="What was left out">
          <h2 className="text-md font-medium text-fg-strong">What was left out</h2>
          <ul className="list-disc pl-5 text-sm">
            {batch.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="grid gap-4" aria-label="Preview">
        <h2 className="text-lg">Preview against the website's files</h2>
        <LiveView
          live={files}
          loadingLabel="Loading the files"
          errorTitle="The files could not be loaded."
          onRetry={retryFailedLiveData}
        >
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                title="This export holds no file"
                description="An export that failed before its files were written has nothing to preview."
              />
            ) : (
              [...list]
                .sort((a, b) => order.indexOf(a.fileKey as WebsiteFileKey) - order.indexOf(b.fileKey as WebsiteFileKey))
                .map((file) => <FileDiff key={file.id} file={file} />)
            )
          }
        </LiveView>
      </section>
    </div>
  );
}

/** One export of the publishing log, for holders of `publishing.prepare`. */
export function PublicationPage() {
  const { batchId = "" } = useParams();
  const batch = useLiveDocument("publicationBatches", [batchId]);
  return (
    <AdminPage
      entryId="admin-publishing"
      title="Export"
      description="The files an export would commit to the website, compared row by row and field by field with what the website holds now."
    >
      <LiveView
        live={batch}
        loadingLabel="Loading the export"
        errorTitle="The export could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(data) =>
          data === null ? (
            <ErrorState title="This export does not exist." description="It may have been named wrongly." />
          ) : (
            <Batch batch={data} />
          )
        }
      </LiveView>
    </AdminPage>
  );
}
