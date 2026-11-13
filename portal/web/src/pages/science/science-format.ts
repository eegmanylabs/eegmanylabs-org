// Words for the values of the scientific workflows, shared by their tabs.
import type { FindingProvenance, FindingSource, ManuscriptEventKind, ManuscriptMilestone } from "@eegml/shared";

export const FINDING_SOURCE_LABELS: Readonly<Record<FindingSource, string>> = {
  originalArticle: "Original article",
  supplementaryMaterial: "Supplementary material",
  authorCorrespondence: "Correspondence with the original authors",
  reanalysis: "Reanalysis of the original data",
  analysisRun: "Analysis run of the replication",
  manuscript: "Output of the replication",
};

export const ANALYSIS_STATUS_LABELS = {
  notStarted: "Not started",
  inProgress: "In progress",
  completed: "Completed",
} as const;

export const RUN_KIND_LABELS = {
  preprocessing: "Preprocessing",
  analysis: "Analysis",
  qualityControl: "Quality control",
  other: "Other",
} as const;

export const RUN_STATUS_LABELS = {
  planned: "Planned",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export const RUN_QC_LABELS = {
  notAssessed: "Not assessed",
  passed: "Passed",
  flagged: "Flagged",
  failed: "Failed",
} as const;

export const REPRODUCIBILITY_LABELS = {
  notAttempted: "Not attempted",
  reproduced: "Reproduced",
  partiallyReproduced: "Partly reproduced",
  notReproduced: "Not reproduced",
} as const;

export const OUTPUT_KIND_LABELS = {
  statistics: "Statistics",
  figure: "Figure",
  table: "Table",
  derivedData: "Derived data",
  report: "Report",
  other: "Other",
} as const;

export const DECISION_STATUS_LABELS = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
} as const;

export const INCIDENT_STATUS_LABELS = { open: "Open", investigating: "Investigating", resolved: "Resolved" } as const;
export const SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;
export const DEVIATION_SEVERITY_LABELS = { minor: "Minor", major: "Major", critical: "Critical" } as const;
export const DEVIATION_STATUS_LABELS = { open: "Open", underReview: "Under review", resolved: "Resolved" } as const;

export const INCIDENT_ACTION_LABELS = {
  correctiveAction: "Corrective action",
  statusChange: "Change of status",
  correction: "Correction",
  note: "Note",
} as const;

export const EVENT_KIND_LABELS: Readonly<Record<ManuscriptEventKind, string>> = {
  submission: "Submission",
  reviewRound: "Review round",
  decision: "Decision",
  revision: "Revision",
  acceptance: "Acceptance",
  publication: "Publication",
  other: "Other step",
};

export const DECISION_OUTCOME_LABELS = {
  accept: "Accept",
  inPrincipleAcceptance: "In-principle acceptance",
  minorRevision: "Minor revision",
  majorRevision: "Major revision",
  reject: "Reject",
} as const;

export const MILESTONE_NAMES: Readonly<Record<ManuscriptMilestone, string>> = {
  submission: "Submission",
  acceptance: "Acceptance",
  publication: "Publication",
};

export const CONFIRMATION_LABELS = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  changesRequested: "Change requested",
} as const;

/** A date of a calendar as people read it, for example 3 March 2026. */
export function readableDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** An instant as people read it. */
export function readableInstant(instant: { toDate(): Date }): string {
  return instant.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** Where a finding comes from, in one sentence. The audit trail names who recorded it. */
export function provenanceText(provenance: FindingProvenance): string {
  return `${FINDING_SOURCE_LABELS[provenance.source]}, ${provenance.locator}. Recorded on ${readableInstant(
    provenance.recordedAt,
  )}.`;
}

/** Today's date of the reader's calendar, as ISO text. */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Lines of `name: value` read into a map, or null where a line has no name. Numbers and true or false keep their type. */
export function parseNamedValues(text: string): Record<string, string | number | boolean> | null {
  const values: Record<string, string | number | boolean> = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const at = line.indexOf(":");
    if (at <= 0) return null;
    const name = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    if (name === "" || name.includes(".") || name.includes("/")) return null;
    values[name] =
      raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return values;
}

/** A map of named values as the lines `parseNamedValues` reads. */
export function namedValuesText(values: Readonly<Record<string, unknown>> | undefined): string {
  return Object.entries(values ?? {})
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join("\n");
}
