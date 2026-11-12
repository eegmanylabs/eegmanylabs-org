// The reader of a bids-validator report (docs/DATA_MODEL.md, section 10). A laboratory or a lead
// runs the validator on its own machine, next to the data, with `--json`, and uploads the output.
// The portal never runs the validator and never sees the recordings. Two shapes of output are
// read: that of the validator of the 1.x series (issues grouped into `errors` and `warnings`,
// each with `files`), and that of the schema-based validator of the 2.x series (a flat list of
// `issues`, each with its `severity` and `location`, and `codeMessages`). Both were written from
// the validator's documentation and its published output, and the fixtures in the tests are
// synthetic.
//
// The condensed report keeps each issue code once, with its severity, its number of occurrences,
// its message and its first few locations. A location can name a participant label, so the
// condensed report is stored in the restricted detail of the dataset, and the registry document
// keeps the counts alone. Subject and session labels of the summary are never kept: only how
// many there are.

/** The issue codes that say required metadata or a required file is absent. */
const MISSING_METADATA_CODE = /(MISSING|REQUIRED|NOT_INCLUDED|EMPTY_FILE|NOT_FOUND)/;

/** The most issue codes a condensed report keeps, and the most locations of one code. */
export const BIDS_REPORT_MAX_CODES = 200;
export const BIDS_REPORT_MAX_LOCATIONS = 5;

export interface BidsIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly count: number;
  readonly message: string;
  readonly locations: readonly string[];
}

export interface BidsReport {
  readonly format: "legacy" | "schema";
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issues: readonly BidsIssue[];
  /** One line for each missing field or file: the code and where it was found. */
  readonly missingMetadata: readonly string[];
  readonly summary: {
    readonly subjectCount: number | null;
    readonly sessionCount: number | null;
    readonly taskCount: number | null;
    readonly totalFiles: number | null;
    readonly sizeBytes: number | null;
    readonly schemaVersion: string | null;
    readonly modalities: readonly string[];
  };
}

export type BidsReportResult =
  | { readonly ok: true; readonly report: BidsReport }
  | { readonly ok: false; readonly message: string };

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const countOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const lengthOf = (value: unknown): number | null => (Array.isArray(value) ? value.length : null);
const clip = (text: string, length: number) => (text.length <= length ? text : `${text.slice(0, length - 1)}…`);

/** Adds the occurrences of one code to the issues gathered so far. */
function gather(
  issues: Map<string, { severity: "error" | "warning"; count: number; message: string; locations: string[] }>,
  code: string,
  severity: "error" | "warning",
  message: string,
  locations: readonly string[],
  occurrences: number,
): void {
  const key = `${severity}:${code}`;
  const current = issues.get(key) ?? { severity, count: 0, message: clip(message, 280), locations: [] };
  current.count += occurrences;
  for (const location of locations) {
    if (current.locations.length < BIDS_REPORT_MAX_LOCATIONS && !current.locations.includes(location)) {
      current.locations.push(clip(location, 280));
    }
  }
  issues.set(key, current);
}

function legacyIssues(issues: Json, gathered: Parameters<typeof gather>[0]): void {
  for (const severity of ["error", "warning"] as const) {
    const list = issues[severity === "error" ? "errors" : "warnings"];
    if (!Array.isArray(list)) continue;
    for (const issue of list) {
      if (!isObject(issue)) continue;
      const code = textOf(issue.key) ?? (countOf(issue.code) === null ? "UNKNOWN" : `CODE_${issue.code}`);
      const files = Array.isArray(issue.files) ? issue.files.filter(isObject) : [];
      const locations = files
        .map((entry) => (isObject(entry.file) ? textOf(entry.file.relativePath) : null) ?? textOf(entry.reason))
        .filter((location): location is string => location !== null);
      gather(gathered, code, severity, textOf(issue.reason) ?? code, locations, Math.max(1, files.length));
    }
  }
}

function schemaIssues(issues: Json, gathered: Parameters<typeof gather>[0]): void {
  const messages = isObject(issues.codeMessages) ? issues.codeMessages : {};
  const list = Array.isArray(issues.issues) ? issues.issues : [];
  for (const issue of list) {
    if (!isObject(issue)) continue;
    const severity = issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : null;
    if (severity === null) continue;
    const code = textOf(issue.code) ?? "UNKNOWN";
    const subCode = textOf(issue.subCode);
    const fullCode = subCode === null ? code : `${code}.${subCode}`;
    const message = textOf(issue.issueMessage) ?? textOf(messages[code]) ?? code;
    const location = textOf(issue.location);
    gather(gathered, fullCode, severity, message, location === null ? [] : [location], 1);
  }
}

/**
 * Reads the JSON output of the bids-validator. Gives a message in words, and no report, for text
 * that is not JSON or not a report of either shape.
 */
export function readBidsReport(text: string): BidsReportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: "The file is not JSON. Run the validator with the option --json and upload what it writes.",
    };
  }
  if (!isObject(parsed) || !isObject(parsed.issues)) {
    return { ok: false, message: "The file is JSON but not the output of the bids-validator: it has no issues." };
  }
  const issues = parsed.issues;
  const format = Array.isArray(issues.issues)
    ? "schema"
    : Array.isArray(issues.errors) || Array.isArray(issues.warnings)
      ? "legacy"
      : null;
  if (format === null) {
    return { ok: false, message: "The issues of the report are in a shape the portal does not know." };
  }
  const gathered = new Map<
    string,
    { severity: "error" | "warning"; count: number; message: string; locations: string[] }
  >();
  if (format === "legacy") legacyIssues(issues, gathered);
  else schemaIssues(issues, gathered);
  const all = [...gathered.entries()]
    .map(([key, issue]) => ({ code: key.slice(key.indexOf(":") + 1), ...issue }))
    .sort((a, b) =>
      a.severity === b.severity ? b.count - a.count || a.code.localeCompare(b.code) : a.severity === "error" ? -1 : 1,
    );
  const errorCount = all.filter((issue) => issue.severity === "error").reduce((sum, issue) => sum + issue.count, 0);
  const warningCount = all.filter((issue) => issue.severity === "warning").reduce((sum, issue) => sum + issue.count, 0);
  const missingMetadata = all
    .filter((issue) => MISSING_METADATA_CODE.test(issue.code))
    .flatMap((issue) =>
      issue.locations.length === 0
        ? [`${issue.code}: ${issue.message}`]
        : issue.locations.map((location) => `${issue.code}: ${location}`),
    )
    .slice(0, 500)
    .map((line) => clip(line, 300));
  const summary = isObject(parsed.summary) ? parsed.summary : {};
  const modalities = Array.isArray(summary.modalities)
    ? summary.modalities.filter((entry): entry is string => typeof entry === "string").slice(0, 20)
    : [];
  return {
    ok: true,
    report: {
      format,
      errorCount,
      warningCount,
      issues: all.slice(0, BIDS_REPORT_MAX_CODES),
      missingMetadata,
      summary: {
        subjectCount: lengthOf(summary.subjects),
        sessionCount: lengthOf(summary.sessions),
        taskCount: lengthOf(summary.tasks),
        totalFiles: countOf(summary.totalFiles),
        sizeBytes: countOf(summary.size),
        schemaVersion: textOf(summary.schemaVersion),
        modalities,
      },
    },
  };
}
