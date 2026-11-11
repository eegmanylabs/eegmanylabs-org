// The entry form of a laboratory: one report of a participation, cumulative or for a period,
// with the main experiment, the resting state and unique participants in columns of their own
// that are never added together. The same form files a correction, a withdrawal or a central
// verification of an earlier report, each as a new report that names the one it concerns
// (D-009, D-019). A field left empty is unknown and stays out of the report.
import {
  fileRecruitmentReportsContract,
  RECRUITMENT_MODALITIES,
  RECRUITMENT_MODALITY_LABELS,
  type RecruitmentModality,
  type RecruitmentReportInput,
  recruitmentReportInputSchema,
} from "@eegml/shared";
import { type FormEvent, useId, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction } from "@/data";
import type { CategoryRecord, ReasonRecord, ReportRecord } from "@/registry/recruitment-data";
import { formatDay, today } from "./dates";

export type ReportMode = "new" | "correction" | "void" | "verify";

const TITLES: Readonly<Record<ReportMode, string>> = {
  new: "File a report",
  correction: "Correct a report",
  void: "Withdraw a report",
  verify: "Verify a report",
};

const SUBMIT: Readonly<Record<ReportMode, string>> = {
  new: "File report",
  correction: "File correction",
  void: "Withdraw report",
  verify: "File verification",
};

/** The counts of a form: modality to category key to the text typed, which may be empty. */
type CountTexts = Partial<Record<RecruitmentModality, Record<string, string>>>;

interface ExclusionRow {
  readonly key: number;
  readonly modality: RecruitmentModality;
  readonly reasonTermId: string;
  readonly count: string;
}

const textsOf = (report: ReportRecord | undefined): CountTexts => {
  const texts: CountTexts = {};
  if (report === undefined) return texts;
  for (const modality of RECRUITMENT_MODALITIES) {
    const counts = report.counts[modality];
    if (counts === undefined) continue;
    texts[modality] = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)]));
  }
  return texts;
};

const WHOLE = /^\d{1,7}$/;

/** The exclusions of a report as rows of the form, which a correction and a verification start from. */
const exclusionsOf = (report: ReportRecord | undefined): ExclusionRow[] =>
  (report?.exclusions ?? []).map((exclusion, index) => ({
    key: index,
    modality: exclusion.modality,
    reasonTermId: exclusion.reasonTermId ?? "",
    count: String(exclusion.count),
  }));

export interface ReportDialogProps {
  readonly participationId: string;
  /** What the participation is called, for example its replication and laboratory. */
  readonly participationLabel: string;
  readonly mode: ReportMode;
  /** The report that a correction, a withdrawal or a verification concerns. */
  readonly target?: ReportRecord;
  readonly categories: readonly CategoryRecord[];
  readonly reasons: readonly ReasonRecord[];
  /** The label of the button that opens the dialog, where it differs from its title. */
  readonly triggerLabel?: string;
  readonly triggerVariant?: "primary" | "outline" | "ghost";
}

export function ReportDialog({
  participationId,
  participationLabel,
  mode,
  target,
  categories,
  reasons,
  triggerLabel,
  triggerVariant = "outline",
}: ReportDialogProps) {
  const toast = useToast();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reportKind, setReportKind] = useState<"cumulative" | "period">(target?.reportKind ?? "cumulative");
  const [asOfDate, setAsOfDate] = useState(target?.asOfDate ?? today());
  const [periodStart, setPeriodStart] = useState(target?.periodStart ?? "");
  // A verification starts empty, with the lab's values beside each cell, so that only what the
  // verifier entered or confirmed is filed as verified.
  const startingCounts = (): CountTexts => (mode === "verify" ? {} : textsOf(target));
  const labValues = mode === "verify" ? textsOf(target) : {};
  const [counts, setCounts] = useState<CountTexts>(startingCounts);
  const [exclusions, setExclusions] = useState<readonly ExclusionRow[]>(() =>
    mode === "verify" ? [] : exclusionsOf(target),
  );
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A verification and a correction keep the date and the kind of what they concern.
  const fixedFrame = mode === "verify" || mode === "correction";

  const reset = () => {
    setReportKind(target?.reportKind ?? "cumulative");
    setAsOfDate(target?.asOfDate ?? today());
    setPeriodStart(target?.periodStart ?? "");
    setCounts(startingCounts());
    setExclusions(mode === "verify" ? [] : exclusionsOf(target));
    setNote("");
    setErrors({});
    setFailure(null);
  };

  const setCount = (modality: RecruitmentModality, key: string, value: string) =>
    setCounts((current) => ({ ...current, [modality]: { ...(current[modality] ?? {}), [key]: value } }));

  const build = (): { report: RecruitmentReportInput | null; problems: Record<string, string> } => {
    const problems: Record<string, string> = {};
    const stated: Partial<Record<RecruitmentModality, Record<string, number>>> = {};
    if (mode !== "void") {
      for (const modality of RECRUITMENT_MODALITIES) {
        for (const [key, text] of Object.entries(counts[modality] ?? {})) {
          const trimmed = text.trim();
          if (trimmed === "") continue;
          if (!WHOLE.test(trimmed)) {
            problems[`${modality}.${key}`] = "Enter a whole number from 0, or leave it empty where it is not known.";
            continue;
          }
          stated[modality] = { ...(stated[modality] ?? {}), [key]: Number(trimmed) };
        }
      }
      if (Object.keys(stated).length === 0 && Object.keys(problems).length === 0) {
        problems.counts = "Enter at least one count. Leave empty what you do not know.";
      }
    }
    // Every exclusion row that was added is filed or refused: none is dropped without a word.
    const parsedExclusions = mode === "void" ? [] : exclusions;
    for (const row of parsedExclusions) {
      if (row.reasonTermId === "" && row.count.trim() === "") {
        problems[`exclusion.${row.key}`] = "Choose the reason and enter how many, or remove this exclusion.";
      } else if (row.reasonTermId === "") problems[`exclusion.${row.key}`] = "Choose the reason.";
      else if (!WHOLE.test(row.count.trim()) || Number(row.count) < 1) {
        problems[`exclusion.${row.key}`] = "Enter how many were excluded for this reason.";
      }
    }
    const trimmedNote = note.trim();
    if ((mode === "correction" || mode === "void") && trimmedNote === "") {
      problems.note = mode === "void" ? "Say why the report is withdrawn." : "Say what the correction changes.";
    }
    if (reportKind === "period" && periodStart === "") problems.periodStart = "Enter the first day of the period.";
    if (reportKind === "period" && periodStart !== "" && periodStart > asOfDate) {
      problems.periodStart = "The period starts on or before its last day.";
    }
    if (asOfDate === "" || asOfDate > today()) problems.asOfDate = "Choose today or an earlier date.";
    if (Object.keys(problems).length > 0) return { report: null, problems };
    const input = {
      participationId,
      asOfDate,
      reportKind,
      ...(reportKind === "period" ? { periodStart, periodEnd: asOfDate } : {}),
      basis: mode === "verify" || target?.basis === "centrallyVerified" ? "centrallyVerified" : "labReported",
      entryKind: mode === "correction" ? "correction" : mode === "void" ? "void" : "new",
      ...((mode === "correction" || mode === "void") && target !== undefined ? { correctsReportId: target.id } : {}),
      ...(mode === "verify" && target !== undefined ? { verifiesReportId: target.id } : {}),
      counts: stated,
      exclusions: parsedExclusions.map((row) => ({
        modality: row.modality,
        reasonTermId: row.reasonTermId,
        count: Number(row.count),
      })),
      ...(trimmedNote === "" ? {} : { note: trimmedNote }),
    };
    const parsed = recruitmentReportInputSchema.safeParse(input);
    if (!parsed.success) return { report: null, problems: { form: "The report is not complete. Check every field." } };
    return { report: parsed.data, problems };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { report, problems } = build();
    setErrors(problems);
    if (report === null) return;
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(fileRecruitmentReportsContract, { reports: [report] });
      setOpen(false);
      reset();
      toast.show({
        title:
          mode === "void"
            ? "The report has been withdrawn."
            : mode === "verify"
              ? "The verification has been filed."
              : mode === "correction"
                ? "The correction has been filed."
                : "The report has been filed.",
        description: "It stands beside the earlier reports, which are kept as they were.",
      });
    } catch (error) {
      setFailure(
        error instanceof CallableError ? error.message : "The report could not be filed. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          {triggerLabel ?? TITLES[mode]}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`${TITLES[mode]}: ${participationLabel}`}
        description={
          mode === "void"
            ? "The report stays in the history, marked as withdrawn, and no longer counts."
            : mode === "verify"
              ? "Your figures are kept beside the laboratory's, which do not change."
              : "Leave a field empty where the number is not known. Main experiment, resting state and unique participants are counted apart and never added together."
        }
        className="max-w-[56rem]"
      >
        <form id={formId} noValidate onSubmit={submit} className="mt-5 grid gap-5" data-testid="report-form">
          {failure === null ? null : <ErrorState title="Nothing was filed." description={failure} />}
          {errors.form === undefined ? null : <ErrorState title="Nothing was filed." description={errors.form} />}
          {target === undefined ? null : (
            <p className="text-sm text-fg-secondary">
              {mode === "verify" ? "Verifies" : "Replaces"} the report as of {formatDay(target.asOfDate)}.
            </p>
          )}
          {mode === "void" ? null : (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Kind of report">
                {(control) => (
                  <Select
                    {...control}
                    value={reportKind}
                    disabled={fixedFrame}
                    onChange={(event) => setReportKind(event.target.value === "period" ? "period" : "cumulative")}
                  >
                    <option value="cumulative">Cumulative, everything so far</option>
                    <option value="period">For a period only</option>
                  </Select>
                )}
              </FormField>
              {reportKind === "period" ? (
                <FormField label="First day of the period" error={errors.periodStart ?? null}>
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      value={periodStart}
                      disabled={fixedFrame}
                      onChange={(event) => setPeriodStart(event.target.value)}
                    />
                  )}
                </FormField>
              ) : null}
              <FormField
                label={reportKind === "period" ? "Last day of the period" : "As of"}
                hint="The day for which the numbers hold."
                error={errors.asOfDate ?? null}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    max={today()}
                    value={asOfDate}
                    disabled={fixedFrame}
                    onChange={(event) => setAsOfDate(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          )}
          {mode === "void" ? null : (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium text-fg-secondary">Counts</legend>
              <div className="overflow-x-auto rounded-tile border border-border">
                <table className="w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Counts by category and modality</caption>
                  <thead className="bg-surface-muted text-micro text-fg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Category
                      </th>
                      {RECRUITMENT_MODALITIES.map((modality) => (
                        <th key={modality} scope="col" className="px-3 py-2 font-medium">
                          {RECRUITMENT_MODALITY_LABELS[modality]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <tr key={category.key} className="border-t border-border">
                        <th scope="row" className="px-3 py-1.5 align-top font-normal">
                          <span className="grid">
                            <span className="text-fg">{category.label}</span>
                            <span className="max-w-[18rem] text-xs text-fg-muted">{category.definition}</span>
                          </span>
                        </th>
                        {RECRUITMENT_MODALITIES.map((modality) => {
                          const error = errors[`${modality}.${category.key}`];
                          const reported = labValues[modality]?.[category.key] ?? "";
                          const cellLabel = `${category.label}, ${RECRUITMENT_MODALITY_LABELS[modality].toLowerCase()}`;
                          return (
                            <td key={modality} className="px-3 py-1.5 align-top">
                              <Input
                                inputMode="numeric"
                                className="w-24"
                                aria-label={cellLabel}
                                aria-invalid={error === undefined ? undefined : true}
                                data-testid={`count-${modality}-${category.key}`}
                                placeholder="Unknown"
                                value={counts[modality]?.[category.key] ?? ""}
                                onChange={(event) => setCount(modality, category.key, event.target.value)}
                              />
                              {reported === "" ? null : (
                                <span
                                  className="mt-1 flex items-center gap-1 text-xs text-fg-muted"
                                  data-testid={`lab-${modality}-${category.key}`}
                                >
                                  Lab: {reported}
                                  {counts[modality]?.[category.key] === reported ? null : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1"
                                      aria-label={`Confirm the lab's value of ${cellLabel}, ${reported}`}
                                      onClick={() => setCount(modality, category.key, reported)}
                                    >
                                      Confirm
                                    </Button>
                                  )}
                                </span>
                              )}
                              {error === undefined ? null : <p className="mt-1 text-xs text-fg-accent">{error}</p>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errors.counts === undefined ? null : (
                <p className="text-xs text-fg-accent" role="alert">
                  {errors.counts}
                </p>
              )}
            </fieldset>
          )}
          {mode === "void" ? null : (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium text-fg-secondary">Exclusions</legend>
              {exclusions.length === 0 ? <p className="text-sm text-fg-muted">No exclusions are stated.</p> : null}
              {RECRUITMENT_MODALITIES.map((modality) => {
                const excluded = counts[modality]?.excluded?.trim() ?? "";
                if (!WHOLE.test(excluded)) return null;
                const reasoned = exclusions
                  .filter((row) => row.modality === modality && WHOLE.test(row.count.trim()))
                  .reduce((sum, row) => sum + Number(row.count), 0);
                return Number(excluded) === reasoned ? null : (
                  <p key={modality} className="text-xs text-fg-secondary" data-testid={`exclusions-differ-${modality}`}>
                    {RECRUITMENT_MODALITY_LABELS[modality]}: {excluded} excluded, and the reasons below account for{" "}
                    {reasoned}. Add the reasons you know; a report may file fewer.
                  </p>
                );
              })}
              {exclusions.map((row, index) => (
                <div key={row.key} className="grid gap-2 sm:grid-cols-[10rem_1fr_7rem_auto] sm:items-end">
                  <FormField label={`Modality of exclusion ${index + 1}`}>
                    {(control) => (
                      <Select
                        {...control}
                        value={row.modality}
                        onChange={(event) =>
                          setExclusions((current) =>
                            current.map((item) =>
                              item.key === row.key
                                ? { ...item, modality: event.target.value as RecruitmentModality }
                                : item,
                            ),
                          )
                        }
                      >
                        {RECRUITMENT_MODALITIES.map((modality) => (
                          <option key={modality} value={modality}>
                            {RECRUITMENT_MODALITY_LABELS[modality]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label={`Reason of exclusion ${index + 1}`} error={errors[`exclusion.${row.key}`] ?? null}>
                    {(control) => (
                      <Select
                        {...control}
                        value={row.reasonTermId}
                        onChange={(event) =>
                          setExclusions((current) =>
                            current.map((item) =>
                              item.key === row.key ? { ...item, reasonTermId: event.target.value } : item,
                            ),
                          )
                        }
                      >
                        <option value="">Choose a reason</option>
                        {reasons.map((reason) => (
                          <option key={reason.id} value={reason.id}>
                            {reason.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField label={`Excluded, exclusion ${index + 1}`}>
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="numeric"
                        value={row.count}
                        onChange={(event) =>
                          setExclusions((current) =>
                            current.map((item) =>
                              item.key === row.key ? { ...item, count: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    )}
                  </FormField>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExclusions((current) => current.filter((item) => item.key !== row.key))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  disabled={reasons.length === 0}
                  onClick={() =>
                    setExclusions((current) => [
                      ...current,
                      {
                        key: Math.max(-1, ...current.map((item) => item.key)) + 1,
                        modality: "main",
                        reasonTermId: "",
                        count: "",
                      },
                    ])
                  }
                >
                  Add an exclusion
                </Button>
              </div>
            </fieldset>
          )}
          <FormField
            label={mode === "new" || mode === "verify" ? "Note (optional)" : "Reason"}
            error={errors.note ?? null}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={2_000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Filing…" : SUBMIT[mode]}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
