// BIDS for a dataset (docs/DATA_MODEL.md, section 10): how far its conversion has come, the
// result of the last validation, what metadata is still missing and how the laboratory's names
// map to BIDS names. The validator runs next to the data, never in the portal: its JSON output
// is imported here. The report and the naming map can name participant labels, so they are shown
// only to those who may read paths.
import { importBidsReportContract, updateDatasetContract } from "@eegml/shared";
import { useState } from "react";
import { formatDateTime } from "@/app/labels";
import { Detail, Details } from "@/components/registry/details";
import { Unknown } from "@/components/registry/unknown";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { callFunction, type RecordOf } from "@/data";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import { FormDialog, useAction } from "./dataset-actions";
import { BIDS_CONVERSION_LABELS, BIDS_STATUS_LABELS } from "./dataset-format";

type Dataset = RecordOf<"datasets">;
type DetailDoc = RecordOf<"datasetDetail">;
type Conversion = Dataset["bidsConversionStatus"];

function ImportDialog({ datasetKey, onClose }: { datasetKey: string; onClose: () => void }) {
  const action = useAction();
  const [report, setReport] = useState("");
  const [version, setVersion] = useState("");
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="Import a validation report"
      description="Run the bids-validator next to the data with the option --json, and load what it writes. The portal reads the issues and the counts."
      submitLabel="Import the report"
      failureTitle="The report was not imported."
      busy={action.busy}
      failure={action.failure}
      onSubmit={async () => {
        if (
          await action.run(
            () =>
              callFunction(
                importBidsReportContract,
                { datasetKey, report, validatorVersion: version.trim() },
                { timeoutMs: 60_000 },
              ),
            "The validation report has been imported.",
            "The report could not be imported. Try again.",
          )
        )
          onClose();
      }}
    >
      <FormField label="Report file">
        {(control) => (
          <input
            {...control}
            type="file"
            accept=".json,application/json"
            className="text-sm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) setReport(await file.text());
            }}
          />
        )}
      </FormField>
      <FormField label="Or paste the report">
        {(control) => (
          <Textarea
            {...control}
            rows={5}
            className="font-mono text-xs"
            value={report}
            onChange={(event) => setReport(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Version of the validator" hint="As the validator prints it, for example 1.14.0.">
        {(control) => (
          <Input {...control} value={version} maxLength={64} onChange={(event) => setVersion(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

function ConversionDialog({
  dataset,
  detail,
  onClose,
}: {
  dataset: Dataset;
  detail: DetailDoc | null;
  onClose: () => void;
}) {
  const action = useAction();
  const [status, setStatus] = useState<Conversion>(dataset.bidsConversionStatus);
  const [version, setVersion] = useState(dataset.bidsVersion ?? "");
  const [mapping, setMapping] = useState(
    (detail?.bidsNamingMap ?? []).map((entry) => `${entry.source} => ${entry.bids}`).join("\n"),
  );
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? null : onClose())}
      title="BIDS conversion"
      submitLabel="Save"
      failureTitle="Nothing was saved."
      busy={action.busy}
      failure={problem ?? action.failure}
      onSubmit={async () => {
        const lines = mapping
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "");
        const entries = lines.map((line) => line.split("=>").map((part) => part.trim()));
        if (entries.some((parts) => parts.length !== 2 || parts[0] === "" || parts[1] === "")) {
          setProblem("Write each mapping as a name used at the laboratory, =>, and its BIDS name.");
          return;
        }
        setProblem(null);
        if (
          await action.run(
            () =>
              callFunction(updateDatasetContract, {
                datasetKey: dataset.id,
                bidsConversionStatus: status,
                bidsVersion: version.trim() === "" ? null : version.trim(),
                ...(detail === null && lines.length === 0
                  ? {}
                  : { bidsNamingMap: entries.map(([source = "", bids = ""]) => ({ source, bids })) }),
              }),
            "The BIDS conversion has been saved.",
            "The conversion could not be saved. Try again.",
          )
        )
          onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Conversion">
          {(control) => (
            <Select {...control} value={status} onChange={(event) => setStatus(event.target.value as Conversion)}>
              {(Object.keys(BIDS_CONVERSION_LABELS) as Conversion[]).map((value) => (
                <option key={value} value={value}>
                  {BIDS_CONVERSION_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="BIDS version">
          {(control) => (
            <Input {...control} value={version} maxLength={32} onChange={(event) => setVersion(event.target.value)} />
          )}
        </FormField>
      </div>
      {detail === null ? null : (
        <FormField label="Naming mappings" hint="One a line: the name at the laboratory, =>, the BIDS name.">
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              className="font-mono text-xs"
              value={mapping}
              onChange={(event) => setMapping(event.target.value)}
            />
          )}
        </FormField>
      )}
    </FormDialog>
  );
}

interface Issue {
  readonly code: string;
  readonly severity: string;
  readonly count: number;
  readonly message: string;
}

/** The issues of a stored condensed report, read without trusting its shape. */
function issuesOf(report: Readonly<Record<string, unknown>> | undefined): Issue[] {
  const issues = report?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue): Issue[] => {
    if (typeof issue !== "object" || issue === null) return [];
    const { code, severity, count, message } = issue as Record<string, unknown>;
    return typeof code === "string" &&
      typeof severity === "string" &&
      typeof count === "number" &&
      typeof message === "string"
      ? [{ code, severity, count, message }]
      : [];
  });
}

export function BidsSection({
  dataset,
  detail,
  manages,
  readsPaths,
}: {
  dataset: Dataset;
  detail: DetailDoc | null;
  manages: boolean;
  readsPaths: boolean;
}) {
  const [dialog, setDialog] = useState<"import" | "conversion" | null>(null);
  const summary = dataset.bidsSummary;
  const issues = issuesOf(detail?.bidsReport);
  return (
    <div className="grid gap-4">
      {manages ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setDialog("import")}>
            Import a validation report
          </Button>
          <Button onClick={() => setDialog("conversion")}>Record the conversion</Button>
        </div>
      ) : null}
      <Section title="Status">
        <Details>
          <Detail term="Conversion">{BIDS_CONVERSION_LABELS[dataset.bidsConversionStatus]}</Detail>
          <Detail term="BIDS version">{dataset.bidsVersion ?? <Unknown />}</Detail>
          <Detail term="Validation">{BIDS_STATUS_LABELS[dataset.bidsStatus]}</Detail>
          <Detail term="Errors and warnings">
            {summary === undefined ? (
              <Unknown>No report imported</Unknown>
            ) : (
              `${summary.errorCount} errors, ${summary.warningCount} warnings`
            )}
          </Detail>
          <Detail term="Missing metadata">
            {summary?.missingMetadataCount === undefined ? <Unknown /> : `${summary.missingMetadataCount} items`}
          </Detail>
          <Detail term="Validated">
            {summary === undefined ? (
              <Unknown />
            ) : (
              `${formatDateTime(summary.validatedAt.toDate())} with version ${summary.validatorVersion}`
            )}
          </Detail>
        </Details>
      </Section>
      {readsPaths && detail !== null ? (
        <>
          <Section title="Issues of the last report">
            {issues.length === 0 ? (
              <p className="text-sm text-fg-secondary">No issue was reported.</p>
            ) : (
              <ul className="grid gap-1 text-sm" data-testid="bids-issues">
                {issues.map((issue) => (
                  <li key={`${issue.severity}:${issue.code}`}>
                    <span className="font-medium">{issue.severity === "error" ? "Error" : "Warning"}</span> {issue.code}
                    , {issue.count} {issue.count === 1 ? "time" : "times"}: {issue.message}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Missing metadata">
            {(detail.bidsMissingMetadata ?? []).length === 0 ? (
              <p className="text-sm text-fg-secondary">Nothing is recorded as missing.</p>
            ) : (
              <ul className="grid gap-1 font-mono text-xs">
                {(detail.bidsMissingMetadata ?? []).map((item) => (
                  <li key={item} className="break-all">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Naming mappings">
            {(detail.bidsNamingMap ?? []).length === 0 ? (
              <p className="text-sm text-fg-secondary">No mapping is recorded.</p>
            ) : (
              <ul className="grid gap-1 font-mono text-xs">
                {(detail.bidsNamingMap ?? []).map((entry) => (
                  <li key={entry.source} className="break-all">
                    {entry.source} to {entry.bids}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
      {dialog === "import" ? <ImportDialog datasetKey={dataset.id} onClose={() => setDialog(null)} /> : null}
      {dialog === "conversion" ? (
        <ConversionDialog dataset={dataset} detail={readsPaths ? detail : null} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
