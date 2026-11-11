// The tab Recruitment of a replication: its figures as of a date, the table of its laboratories,
// which its leads edit in place to file one report for each changed row, its rollup by
// laboratory, its forecast and the categories that extend it.
import {
  fileRecruitmentReportsContract,
  RECRUITMENT_MODALITIES,
  RECRUITMENT_MODALITY_LABELS,
  type RecruitmentModality,
  type RecruitmentReportInput,
  resolveAll,
  resolvedValue,
  rollupBy,
} from "@eegml/shared";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, retryFailedLiveData } from "@/data";
import { PARTICIPATION_STATUS_LABELS } from "@/registry/labels";
import { COUNT_CATEGORIES_PATH, forecastPath, participationRecruitmentPath } from "@/registry/paths";
import { currentCategories } from "@/registry/recruitment-data";
import type { Viewer } from "@/registry/viewer";
import { formatDay, today } from "./dates";
import { figureName, ValueCell } from "./figures";
import { RecruitmentControls, RollupTable, SummaryTiles, TrendTable, useRecruitmentSettings } from "./RecruitmentPage";
import { type RecruitmentWorld, useRecruitmentWorld } from "./world";

/** The statuses in which a laboratory files reports. */
const REPORTING: ReadonlySet<string> = new Set([
  "confirmed",
  "onboarding",
  "ready",
  "collecting",
  "collectionComplete",
  "withdrawn",
]);

const WHOLE = /^\d{1,7}$/;

/** What a lead has typed into the table: participation to modality to text. */
type Edits = Readonly<Record<string, Partial<Record<RecruitmentModality, string>>>>;

function ReplicationRecruitment({
  viewer,
  world,
  studyKey,
}: {
  readonly viewer: Viewer;
  readonly world: RecruitmentWorld;
  readonly studyKey: string;
}) {
  const toast = useToast();
  const [settings, change] = useRecruitmentSettings();
  const [edits, setEdits] = useState<Edits>({});
  const [reportDate, setReportDate] = useState(today());
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const categories = currentCategories(world.data.categories, new Set([studyKey]));
  const label = (key: string) => categories.find((category) => category.key === key)?.label ?? key;
  const facts = useMemo(() => world.facts.filter((fact) => fact.replicationId === studyKey), [world.facts, studyKey]);
  const reads = viewer.staff || facts.some((fact) => viewer.participationScope(fact) !== null);
  const readable = useMemo(
    () => (viewer.staff ? facts : facts.filter((fact) => viewer.participationScope(fact) !== null)),
    [viewer, facts],
  );
  const states = useMemo(
    () =>
      resolveAll(
        readable.map((fact) => fact.id),
        world.data.facts,
        { date: settings.asOf },
      ),
    [readable, world.data.facts, settings.asOf],
  );
  const groups = rollupBy("laboratory", readable, states, settings.lens, settings.modality, settings.category);
  const editor = viewer.access.member && viewer.can("recruitment.report", { replicationId: studyKey });
  const canForecast = viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey });
  const name = figureName(label(settings.category), settings.modality);
  // A row counts as changed when it states a value and every value it states is a whole number;
  // a cell that holds anything else is marked and its row waits until it is put right.
  const invalidCell = (text: string | undefined) =>
    text !== undefined && text.trim() !== "" && !WHOLE.test(text.trim());
  const changedRows = Object.entries(edits).filter(
    ([, row]) =>
      Object.values(row).some((value) => value !== undefined && value.trim() !== "") &&
      !Object.values(row).some(invalidCell),
  );
  const invalidRows = Object.values(edits).filter((row) => Object.values(row).some(invalidCell)).length;

  const file = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const reports: RecruitmentReportInput[] = [];
    for (const [participationId, row] of changedRows) {
      const counts: Partial<Record<RecruitmentModality, Record<string, number>>> = {};
      for (const modality of RECRUITMENT_MODALITIES) {
        const text = row[modality]?.trim() ?? "";
        if (text === "") continue;
        if (!WHOLE.test(text)) {
          setProblem(
            `Enter whole numbers from 0 for ${world.participationLabel(participationId)}, or leave a cell empty.`,
          );
          return;
        }
        counts[modality] = { [settings.category]: Number(text) };
      }
      reports.push({
        participationId,
        asOfDate: reportDate,
        reportKind: "cumulative",
        basis: "labReported",
        entryKind: "new",
        counts,
        exclusions: [],
      });
    }
    if (reportDate === "" || reportDate > today()) {
      setProblem("Choose today or an earlier date for the reports.");
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      const { reportIds } = await callFunction(fileRecruitmentReportsContract, { reports });
      setEdits({});
      toast.show({
        title: reportIds.length === 1 ? "One report has been filed." : `${reportIds.length} reports have been filed.`,
        description: "One report for each row you changed, as of the date you chose.",
      });
    } catch (error) {
      setFailure(
        error instanceof CallableError ? error.message : "The reports could not be filed. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!reads) {
    return (
      <p className="max-w-reading text-sm text-fg-secondary">
        Reports are read by the laboratories, the team of the replication and the programme. The latest totals of this
        replication are on the{" "}
        <Link className="text-fg-accent underline" to="/recruitment">
          recruitment page
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="grid gap-5" data-testid="replication-recruitment">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={forecastPath(studyKey)}>{canForecast ? "Forecast and assumptions" : "Forecast"}</Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`${COUNT_CATEGORIES_PATH}?replication=${encodeURIComponent(studyKey)}`}>
            Categories of this replication
          </Link>
        </Button>
      </div>
      <RecruitmentControls settings={settings} onChange={change} categories={categories} showGrouping={false} />
      <h3 className="text-md text-fg">As of {formatDay(settings.asOf)}</h3>
      <SummaryTiles facts={readable} world={world} settings={settings} categoryLabel={label} />

      <form onSubmit={file} className="grid gap-3" aria-label="Laboratories of the replication">
        <h3 className="text-md text-fg">Laboratories</h3>
        <p className="max-w-reading text-sm text-fg-secondary">
          {editor
            ? `Type the new cumulative counts of ${label(settings.category).toLowerCase()} in the rows that changed. Each changed row is filed as one report; the empty cells stay unknown. Verified values are shown beside and never change here.`
            : "Lab-reported and centrally verified values side by side."}
        </p>
        {failure === null ? null : <ErrorState title="Nothing was filed." description={failure} />}
        <Table caption={`Laboratories, ${label(settings.category).toLowerCase()}`} data-testid="inline-table">
          <TableHead>
            <TableRow>
              <TableHeaderCell rowSpan={2}>Laboratory</TableHeaderCell>
              <TableHeaderCell rowSpan={2}>Status</TableHeaderCell>
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
            {readable.map((fact) => {
              const state = states.get(fact.id);
              const laboratory = world.laboratoryName(fact.laboratoryId);
              const editable = editor && REPORTING.has(fact.status);
              return (
                <TableRow key={fact.id} data-participation={fact.id}>
                  <TableHeaderCell scope="row" className="font-normal">
                    <Link className="text-fg-accent underline" to={participationRecruitmentPath(fact.id)}>
                      {laboratory}
                    </Link>
                  </TableHeaderCell>
                  <TableCell>
                    {PARTICIPATION_STATUS_LABELS[fact.status as keyof typeof PARTICIPATION_STATUS_LABELS] ??
                      fact.status}
                  </TableCell>
                  {RECRUITMENT_MODALITIES.flatMap((modality) => {
                    const reported =
                      state === undefined ? undefined : resolvedValue(state.reported, modality, settings.category);
                    const verified =
                      state === undefined ? undefined : resolvedValue(state.verified, modality, settings.category);
                    return [
                      <TableCell key={`${modality}-reported`}>
                        <span className="grid gap-1">
                          <ValueCell value={reported} testId={`inline-reported-${fact.laboratoryId}-${modality}`} />
                          {editable ? (
                            <Input
                              inputMode="numeric"
                              className="w-20"
                              aria-label={`New ${figureName(label(settings.category), modality).toLowerCase()} at ${laboratory}`}
                              data-testid={`inline-input-${fact.laboratoryId}-${modality}`}
                              placeholder="New"
                              aria-invalid={invalidCell(edits[fact.id]?.[modality])}
                              value={edits[fact.id]?.[modality] ?? ""}
                              onChange={(event) =>
                                setEdits((current) => ({
                                  ...current,
                                  [fact.id]: { ...(current[fact.id] ?? {}), [modality]: event.target.value },
                                }))
                              }
                            />
                          ) : null}
                        </span>
                      </TableCell>,
                      <TableCell key={`${modality}-verified`}>
                        <ValueCell value={verified} testId={`inline-verified-${fact.laboratoryId}-${modality}`} />
                      </TableCell>,
                    ];
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {editor ? (
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="The reports hold as of" error={problem}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today()}
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
                />
              )}
            </FormField>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || changedRows.length === 0}
              data-testid="file-changed-rows"
            >
              {busy
                ? "Filing…"
                : changedRows.length === 0
                  ? "No changes to file"
                  : changedRows.length === 1
                    ? "File 1 report"
                    : `File ${changedRows.length} reports`}
            </Button>
            {invalidRows === 0 ? null : (
              <p className="text-xs text-fg-accent" role="alert">
                Enter whole numbers from 0 in the marked cells, or empty them.
              </p>
            )}
            {Object.keys(edits).length === 0 ? null : (
              <Button variant="ghost" onClick={() => setEdits({})}>
                Discard changes
              </Button>
            )}
          </div>
        ) : null}
      </form>

      <h3 className="text-md text-fg">By laboratory</h3>
      <RollupTable groups={groups} world={world} dimension="laboratory" name={name} />
      <h3 className="text-md text-fg">Trend</h3>
      <TrendTable facts={readable} world={world} settings={settings} name={name} />
    </div>
  );
}

export function RecruitmentTab({ viewer, studyKey }: { readonly viewer: Viewer; readonly studyKey: string }) {
  const world = useRecruitmentWorld(viewer);
  return (
    <LiveView
      live={world}
      loadingLabel="Loading recruitment"
      errorTitle="Recruitment could not be loaded."
      onRetry={retryFailedLiveData}
    >
      {(loaded) => <ReplicationRecruitment viewer={viewer} world={loaded} studyKey={studyKey} />}
    </LiveView>
  );
}
