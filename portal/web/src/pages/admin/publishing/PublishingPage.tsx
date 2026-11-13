// The publishing log and the start of a new export (requirements R14.1 to R14.5). An export is
// prepared from the approved public fields of the outputs chosen, previewed against the
// website's files, built in a scratch copy, approved with a second factor and proposed to the
// website as a pull request. This page lists every export with its state.
import { PUBLIC_OUTPUT_KEYS, type PublicOutput, preparePublicationContract } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { formatDateTime } from "@/app/labels";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { CallableError, callFunction, type LiveQuery, retryFailedLiveData, useLiveQuery } from "@/data";
import { AdminPage } from "../AdminPage";
import { isFakePullRequest, OUTPUT_LABELS, STATUS_LABELS } from "./publishing-format";

const BATCHES: LiveQuery<"publicationBatches"> = {
  collection: "publicationBatches",
  within: [],
  orderBy: [["requestedAt", "desc"]],
  limit: 50,
};

function PrepareForm() {
  const navigate = useNavigate();
  const [outputs, setOutputs] = useState<PublicOutput[]>(["members"]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (outputs.length === 0) return;
    setBusy(true);
    setFailure(null);
    callFunction(preparePublicationContract, { outputs })
      .then(({ batchId }) => navigate(`/admin/publishing/${batchId}`))
      .catch((error: unknown) => {
        setFailure(error instanceof CallableError ? error.message : "The export could not be prepared. Try again.");
        setBusy(false);
      });
  };
  return (
    <section
      className="grid gap-3 rounded-tile border border-border bg-surface px-4 py-3"
      aria-label="Prepare an export"
    >
      <h2 className="text-md font-medium text-fg-strong">Prepare an export</h2>
      <p className="text-sm text-fg-secondary">
        Only fields on the allow-list of public fields are read. Contact details, demographics, private notes,
        credentials and participant data are never read, and an export in which anything shaped like an email address
        appears is refused. Preparing writes nothing outside the portal.
      </p>
      <form className="grid gap-3" onSubmit={submit} noValidate>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium text-fg-strong">Outputs</legend>
          {PUBLIC_OUTPUT_KEYS.map((output) => (
            <label key={output} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={outputs.includes(output)}
                onChange={(event) =>
                  setOutputs((list) =>
                    event.target.checked ? [...list, output] : list.filter((candidate) => candidate !== output),
                  )
                }
              />
              {OUTPUT_LABELS[output]}
            </label>
          ))}
        </fieldset>
        {failure === null ? null : <ErrorState title="The export was not prepared." description={failure} />}
        <div>
          <Button type="submit" variant="primary" disabled={busy || outputs.length === 0}>
            {busy ? "Preparing the preview…" : "Prepare and preview"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function BatchList() {
  const batches = useLiveQuery(BATCHES);
  return (
    <LiveView
      live={batches}
      loadingLabel="Loading the publishing log"
      errorTitle="The publishing log could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) =>
        list.length === 0 ? (
          <EmptyState
            title="Nothing has been exported yet"
            description="Each export you prepare is kept here with its preview, its checks, its approval and its pull request."
          />
        ) : (
          <div className="relative overflow-x-auto">
            <Table caption="The publishing log">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Prepared</TableHeaderCell>
                  <TableHeaderCell>Outputs</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell>Pull request</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map((batch) => (
                  <TableRow key={batch.id} data-testid="publication-row">
                    <TableCell>
                      <Link className="text-fg-accent underline" to={`/admin/publishing/${batch.id}`}>
                        {formatDateTime(batch.requestedAt.toDate())}
                      </Link>
                    </TableCell>
                    <TableCell>{batch.outputs.map((output) => OUTPUT_LABELS[output]).join(", ")}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={batch.status === "failed" ? "accent" : "neutral"}>
                          {STATUS_LABELS[batch.status]}
                        </Badge>
                        {batch.syntheticData ? <Badge tone="outline">Demonstration data</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {batch.pullRequestUrl === undefined ? (
                        <span className="text-fg-muted">None yet</span>
                      ) : isFakePullRequest(batch.pullRequestUrl) ? (
                        <span>Pull request {batch.pullRequestNumber} on the fake repository (not on GitHub)</span>
                      ) : (
                        <a
                          className="text-fg-accent underline"
                          href={batch.pullRequestUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Pull request {batch.pullRequestNumber}
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      }
    </LiveView>
  );
}

/** The publishing log, for holders of `publishing.prepare`. */
export function PublishingPage() {
  return (
    <AdminPage
      entryId="admin-publishing"
      description="Exports of approved public fields to the eegmanylabs.org website: each is previewed against the website's files, built in a scratch copy, approved with a second factor and proposed as a pull request that a maintainer merges."
    >
      <PrepareForm />
      <BatchList />
    </AdminPage>
  );
}
