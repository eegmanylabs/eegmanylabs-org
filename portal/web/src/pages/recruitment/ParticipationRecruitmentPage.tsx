// The recruitment of one participation: the values that held on a date, lab-reported and
// centrally verified side by side, every report in the order it was filed with what replaced it,
// the forms that file a report, a correction, a withdrawal or a verification, and the planned
// pauses of the laboratory (docs/DATA_MODEL.md, section 7).
import {
  RECRUITMENT_MODALITIES,
  RECRUITMENT_MODALITY_LABELS,
  type RecruitmentModality,
  reportStanding,
  resolvedValue,
  resolveParticipation,
} from "@eegml/shared";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { LoadingState } from "@/components/feedback/loading-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { type RecordOf, retryFailedLiveData } from "@/data";
import { formatCount, PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import { laboratoryPath, RECRUITMENT_PATH, replicationPath } from "@/registry/paths";
import { currentCategories, type ReportRecord } from "@/registry/recruitment-data";
import { useViewer, type Viewer } from "@/registry/viewer";
import { dateOr, endOfLastMonth, formatDay, today } from "./dates";
import { ValueCell } from "./figures";
import { PausesSection } from "./PausesSection";
import { ReportDialog } from "./ReportDialog";
import { reportHistoryOrder } from "./report-order";
import { type RecruitmentWorld, useRecruitmentWorld } from "./world";

const ENTRY_LABELS = { new: "New", correction: "Correction", void: "Withdrawal" } as const;

/** The counts of a report in words: each modality apart, never added. */
function countsText(report: ReportRecord, label: (key: string) => string): string {
  const parts = RECRUITMENT_MODALITIES.flatMap((modality) => {
    const counts = report.counts[modality];
    if (counts === undefined || Object.keys(counts).length === 0) return [];
    const values = Object.entries(counts)
      .map(([key, value]) => `${label(key).toLowerCase()} ${formatCount(value)}`)
      .join(", ");
    return [`${RECRUITMENT_MODALITY_LABELS[modality]}: ${values}`];
  });
  return parts.length === 0 ? "No counts" : parts.join("; ");
}

function ParticipationRecruitment({
  viewer,
  world,
  participation,
}: {
  readonly viewer: Viewer;
  readonly world: RecruitmentWorld;
  readonly participation: RecordOf<"participations">;
}) {
  const [params, setParams] = useSearchParams();
  const asOf = dateOr(params.get("asOf"), today());
  const [draft, setDraft] = useState(asOf);
  const setAsOf = (date: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("asOf", date);
        return next;
      },
      { replace: true },
    );
  const scope = { replicationId: participation.replicationId, laboratoryId: participation.laboratoryId };
  const reports = useMemo(
    () => world.data.reports.filter((report) => report.participationId === participation.id),
    [world.data.reports, participation.id],
  );
  const facts = useMemo(
    () => world.data.facts.filter((fact) => fact.participationId === participation.id),
    [world.data.facts, participation.id],
  );
  const state = useMemo(
    () => resolveParticipation(participation.id, facts, { date: asOf }),
    [participation.id, facts, asOf],
  );
  const categories = currentCategories(world.data.categories, new Set([participation.replicationId]));
  const label = (key: string) => world.data.categories.find((category) => category.key === key)?.label ?? key;
  const reasonName = (id: string | undefined) =>
    id === undefined ? "No reason given" : (world.data.reasons.find((reason) => reason.id === id)?.name ?? id);
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  // Newest first, in the order the reports were filed.
  const history = reportHistoryOrder(
    reports.map((report) => ({
      report,
      id: report.id,
      asOfDate: report.asOfDate,
      createdAtMillis: factsById.get(report.id)?.createdAtMillis ?? 0,
      correctsReportId: report.correctsReportId,
    })),
  ).map((entry) => entry.report);
  const reporter = viewer.access.member && viewer.can("recruitment.report", scope);
  const verifier = viewer.access.member && viewer.can("recruitment.verify", "programme");
  const managesPauses = viewer.access.member && viewer.can("participations.manage", scope);
  const name = world.participationLabel(participation.id);
  const shared = {
    participationId: participation.id,
    participationLabel: name,
    categories,
    reasons: world.data.reasons,
  };
  const reportable = !["invited", "interested", "declined"].includes(participation.status);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Recruitment: ${name}`}
        description={`Status: ${PARTICIPATION_STATUS_LABELS[participation.status]}. Each report is kept as it was filed; a correction or a withdrawal is a new report that names the one it replaces.`}
        actions={reporter && reportable ? <ReportDialog {...shared} mode="new" triggerVariant="primary" /> : null}
      />
      <nav aria-label="Related pages" className="flex flex-wrap gap-3 text-sm">
        <Link className="text-fg-accent underline" to={replicationPath(participation.replicationId)}>
          Replication {participation.replicationId}
        </Link>
        <Link className="text-fg-accent underline" to={laboratoryPath(participation.laboratoryId)}>
          {world.laboratoryName(participation.laboratoryId)}
        </Link>
        <Link className="text-fg-accent underline" to={RECRUITMENT_PATH}>
          Recruitment of the programme
        </Link>
      </nav>
      {reportable ? null : (
        <p className="text-sm text-fg-secondary">
          This laboratory has not confirmed its participation, so it has nothing to report yet.
        </p>
      )}

      <section aria-labelledby="values" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="values" className="text-lg text-fg" data-testid="as-of-heading">
            Values as of {formatDay(asOf)}
          </h2>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setAsOf(dateOr(draft, asOf));
            }}
          >
            <FormField label="As of">
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today()}
                  value={draft}
                  data-testid="participation-as-of"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (event.target.value !== "") setAsOf(dateOr(event.target.value, asOf));
                  }}
                />
              )}
            </FormField>
            <Button
              size="sm"
              onClick={() => {
                setDraft(endOfLastMonth());
                setAsOf(endOfLastMonth());
              }}
            >
              End of last month
            </Button>
          </form>
        </div>
        <p className="max-w-reading text-sm text-fg-secondary">
          Each value is the latest that a report on or before that day states. Lab-reported and centrally verified
          values stand side by side, and a value no report states is unknown.
        </p>
        <Table caption={`Values of ${name} as of ${formatDay(asOf)}`} data-testid="values-table">
          <TableHead>
            <TableRow>
              <TableHeaderCell rowSpan={2}>Category</TableHeaderCell>
              {RECRUITMENT_MODALITIES.map((modality) => (
                <TableHeaderCell key={modality} colSpan={2} scope="colgroup">
                  {RECRUITMENT_MODALITY_LABELS[modality]}
                </TableHeaderCell>
              ))}
            </TableRow>
            <TableRow>
              {RECRUITMENT_MODALITIES.flatMap((modality) => [
                <TableHeaderCell key={`${modality}-reported`}>Reported</TableHeaderCell>,
                <TableHeaderCell key={`${modality}-verified`}>Verified</TableHeaderCell>,
              ])}
            </TableRow>
          </TableHead>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.key}>
                <TableHeaderCell scope="row" className="font-normal">
                  {category.label}
                </TableHeaderCell>
                {RECRUITMENT_MODALITIES.flatMap((modality: RecruitmentModality) => [
                  <TableCell key={`${modality}-reported`}>
                    <ValueCell
                      value={resolvedValue(state.reported, modality, category.key)}
                      testId={`reported-${modality}-${category.key}`}
                    />
                  </TableCell>,
                  <TableCell key={`${modality}-verified`}>
                    <ValueCell
                      value={resolvedValue(state.verified, modality, category.key)}
                      testId={`verified-${modality}-${category.key}`}
                    />
                  </TableCell>,
                ])}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {(["labReported", "centrallyVerified"] as const).map((basis) => {
          const exclusions = state.exclusions[basis];
          if (exclusions === null) return null;
          return (
            <div key={basis} className="grid gap-1 text-sm">
              <h3 className="font-medium text-fg-strong">
                Exclusions, {basis === "labReported" ? "reported" : "verified"}, as of {formatDay(exclusions.asOfDate)}
              </h3>
              <ul className="grid gap-0.5">
                {exclusions.exclusions.map((exclusion) => (
                  <li key={`${exclusion.modality}-${exclusion.reasonTermId ?? exclusion.reasonSource ?? ""}`}>
                    {RECRUITMENT_MODALITY_LABELS[exclusion.modality]}: {formatCount(exclusion.count)},{" "}
                    {exclusion.reasonTermId === undefined && exclusion.reasonSource !== undefined
                      ? exclusion.reasonSource
                      : reasonName(exclusion.reasonTermId)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="history" className="grid gap-3">
        <h2 id="history" className="text-lg text-fg">
          Reports
        </h2>
        {history.length === 0 ? (
          <EmptyState
            title="No reports yet"
            description={
              reporter
                ? "File the first report with the button at the top of the page."
                : "The laboratory has filed none."
            }
          />
        ) : (
          <ol className="grid gap-2" data-testid="report-history">
            {history.map((report) => {
              const fact = factsById.get(report.id);
              const standing = fact === undefined ? { kind: "live" as const } : reportStanding(fact, facts);
              const live = standing.kind === "live" && report.entryKind !== "void";
              const mayReplace =
                live && (report.basis === "centrallyVerified" ? verifier : reporter) && report.entryKind !== "void";
              return (
                <li
                  key={report.id}
                  className="grid gap-2 rounded-tile border border-border bg-surface p-3"
                  data-report={report.id}
                  data-standing={standing.kind}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">
                      {report.reportKind === "period" && report.periodStart !== undefined
                        ? `${formatDay(report.periodStart)} to ${formatDay(report.asOfDate)}`
                        : `As of ${formatDay(report.asOfDate)}`}
                    </span>
                    <Badge tone="outline">{report.basis === "labReported" ? "Reported" : "Verified"}</Badge>
                    <Badge tone="neutral">{ENTRY_LABELS[report.entryKind]}</Badge>
                    <Badge tone="neutral">{report.reportKind === "period" ? "For a period" : "Cumulative"}</Badge>
                    {report.dataOrigin === "live" ? null : (
                      <Badge tone="outline">{report.dataOrigin === "demo" ? "Demonstration" : "Imported"}</Badge>
                    )}
                    {standing.kind === "corrected" ? <Badge tone="accent">Corrected by a later report</Badge> : null}
                    {standing.kind === "voided" ? <Badge tone="accent">Withdrawn</Badge> : null}
                  </div>
                  <p className="text-sm text-fg">
                    {report.entryKind === "void" ? "Withdraws an earlier report." : countsText(report, label)}
                  </p>
                  {report.note === undefined ? null : <p className="text-sm text-fg-secondary">{report.note}</p>}
                  {mayReplace || (verifier && live && report.basis === "labReported") ? (
                    <div className="flex flex-wrap gap-2">
                      {mayReplace ? (
                        <ReportDialog {...shared} mode="correction" target={report} triggerLabel="Correct" />
                      ) : null}
                      {mayReplace ? (
                        <ReportDialog {...shared} mode="void" target={report} triggerLabel="Withdraw" />
                      ) : null}
                      {verifier && live && report.basis === "labReported" ? (
                        <ReportDialog {...shared} mode="verify" target={report} triggerLabel="Verify" />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <PausesSection
        viewer={viewer}
        participation={participation}
        pauses={world.data.pauses}
        canManage={managesPauses}
      />
    </div>
  );
}

export function ParticipationRecruitmentPage() {
  const { participationId = "" } = useParams();
  const viewer = useViewer();
  const world = useRecruitmentWorld(viewer);
  if (viewer === null) return <LoadingState label="Checking your access" />;
  return (
    <LiveView
      live={world}
      loadingLabel="Loading the recruitment"
      errorTitle="The recruitment could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(loaded) => {
        const participation = loaded.participations.find((item) => item.id === participationId);
        if (participation === undefined) {
          return (
            <EmptyState
              title="This participation does not exist"
              description={`No participation has the identifier ${participationId}.`}
              action={
                <Button asChild>
                  <Link to={RECRUITMENT_PATH}>Go to recruitment</Link>
                </Button>
              }
            />
          );
        }
        if (viewer.participationScope(participation) === null) {
          return (
            <EmptyState
              title="You cannot read these reports"
              description="Reports are read by the laboratory, the team of the replication and the programme. The latest totals of every replication are on the recruitment page."
              action={
                <Button asChild>
                  <Link to={RECRUITMENT_PATH}>Go to recruitment</Link>
                </Button>
              }
            />
          );
        }
        return <ParticipationRecruitment viewer={viewer} world={loaded} participation={participation} />;
      }}
    </LiveView>
  );
}
