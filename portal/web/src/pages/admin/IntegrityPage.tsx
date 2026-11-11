import { INTEGRITY_CHECKS, type IntegrityCheck } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { type LiveQuery, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { AdminPage } from "./AdminPage";

const CHECK_LABELS: Readonly<Record<IntegrityCheck, string>> = {
  danglingReference: "References that name no record",
  identifierMismatch: "Identifiers that disagree with their fields",
  personLinkedToSeveralUsers: "Persons linked to more than one account",
  derivedValueDisagrees: "Derived values that disagree with their source",
  equipmentChainCurrent: "Equipment chains with more than one current configuration",
  dependencyCycle: "Tasks whose dependencies form a cycle",
};

const LATEST: LiveQuery<"integrityReports"> = {
  collection: "integrityReports",
  within: [],
  orderBy: [["startedAt", "desc"]],
  limit: 1,
};
const PAGE = 25;

function Findings({ runId }: { runId: string }) {
  const findings = useLiveQuery({ collection: "integrityReportFindings", within: [runId], limit: 1_000 });
  const [check, setCheck] = useState("");
  const [offset, setOffset] = useState(0);
  return (
    <LiveView
      live={findings}
      loadingLabel="Loading the findings"
      errorTitle="The findings could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) => {
        const shown = list
          .filter((finding) => check === "" || finding.check === check)
          .sort((a, b) => a.id.localeCompare(b.id));
        if (list.length === 0) return <p className="text-fg-secondary">The check found nothing to correct.</p>;
        return (
          <div className="grid gap-3">
            <FormField label="Check" className="max-w-sm">
              {(control) => (
                <Select
                  {...control}
                  value={check}
                  onChange={(event) => {
                    setCheck(event.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">Every check</option>
                  {INTEGRITY_CHECKS.map((key) => (
                    <option key={key} value={key}>
                      {CHECK_LABELS[key]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <div className="relative overflow-x-auto">
              <Table caption="Findings of the latest check">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Check</TableHeaderCell>
                    <TableHeaderCell>Document</TableHeaderCell>
                    <TableHeaderCell>Field</TableHeaderCell>
                    <TableHeaderCell>What was found</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.slice(offset, offset + PAGE).map((finding) => (
                    <TableRow key={finding.id} className="align-top" data-testid="integrity-finding">
                      <TableCell>{CHECK_LABELS[finding.check as IntegrityCheck] ?? finding.check}</TableCell>
                      <TableCell className="break-all">{finding.documentPath}</TableCell>
                      <TableCell>{finding.field ?? <Unknown>Whole document</Unknown>}</TableCell>
                      <TableCell>{finding.detail ?? <Unknown>No detail</Unknown>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Pagination offset={offset} pageSize={PAGE} total={shown.length} label="findings" onChange={setOffset} />
          </div>
        );
      }}
    </LiveView>
  );
}

function Report({ report }: { report: RecordOf<"integrityReports"> }) {
  const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0);
  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3" aria-label="Latest check">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-md font-medium text-fg-strong">Latest check</h2>
          <Badge tone={total === 0 ? "neutral" : "accent"} data-testid="integrity-total">
            {total === 0 ? "Nothing found" : `${total} ${total === 1 ? "finding" : "findings"}`}
          </Badge>
        </div>
        <Details>
          <Detail term="Started">{formatDateTime(report.startedAt.toDate())}</Detail>
          <Detail term="Finished">
            {report.finishedAt === null ? <Unknown>Still running</Unknown> : formatDateTime(report.finishedAt.toDate())}
          </Detail>
          {INTEGRITY_CHECKS.map((check) => (
            <Detail key={check} term={CHECK_LABELS[check]}>
              {report.counts[check] === undefined ? <Unknown>Not checked in this run</Unknown> : report.counts[check]}
            </Detail>
          ))}
        </Details>
      </section>
      <Findings runId={report.id} />
    </div>
  );
}

function LatestReport() {
  const reports = useLiveQuery(LATEST);
  return (
    <LiveView
      live={reports}
      loadingLabel="Loading the latest check"
      errorTitle="The integrity report could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(list) =>
        list[0] === undefined ? (
          <EmptyState
            title="No check has run yet"
            description="The integrity check runs every night and can be run from a trusted machine with the command integrity:check of the tools. Its report appears here."
          />
        ) : (
          <Report report={list[0]} />
        )
      }
    </LiveView>
  );
}

/** The latest report of the referential-integrity checker, for holders of `audit.read`. */
export function IntegrityPage() {
  return (
    <AdminPage
      entryId="admin-integrity"
      description="What the nightly check found: references to records that do not exist, identifiers that disagree with their fields, accounts linked twice and derived values that are out of step. It reports and changes nothing."
    >
      <LatestReport />
    </AdminPage>
  );
}
