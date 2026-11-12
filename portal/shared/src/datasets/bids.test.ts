// Fixtures are synthetic: reports shaped like the output of the bids-validator, written by hand
// for these tests, about invented participants of no real dataset.
import { describe, expect, it } from "vitest";
import { BIDS_REPORT_MAX_LOCATIONS, readBidsReport } from "./bids";

/** The shape of the 1.x validator's `--json` output. */
const LEGACY = {
  issues: {
    errors: [
      {
        key: "EEG_SAMPLING_FREQUENCY_MISSING",
        code: 99,
        reason: "Synthetic: SamplingFrequency is required.",
        severity: "error",
        files: [
          { file: { relativePath: "/sub-01/eeg/sub-01_task-oddball_eeg.json" }, reason: "missing" },
          { file: { relativePath: "/sub-02/eeg/sub-02_task-oddball_eeg.json" }, reason: "missing" },
        ],
      },
    ],
    warnings: [
      { key: "README_FILE_MISSING", code: 101, reason: "Synthetic: no README.", severity: "warning", files: [] },
      {
        key: "TOO_FEW_AUTHORS",
        code: 113,
        reason: "Synthetic: few authors.",
        severity: "warning",
        files: [{ reason: "dataset_description.json" }],
      },
    ],
    ignored: [],
  },
  summary: {
    sessions: [],
    subjects: ["01", "02"],
    tasks: ["oddball"],
    modalities: ["EEG"],
    totalFiles: 14,
    size: 2048,
    schemaVersion: "1.9.0",
  },
};

/** The shape of the schema-based 2.x validator's `--json` output. */
const SCHEMA = {
  issues: {
    issues: [
      {
        code: "SIDECAR_KEY_REQUIRED",
        subCode: "PowerLineFrequency",
        location: "/sub-01/eeg/sub-01_task-rest_eeg.json",
        severity: "error",
      },
      {
        code: "SIDECAR_KEY_REQUIRED",
        subCode: "PowerLineFrequency",
        location: "/sub-02/eeg/sub-02_task-rest_eeg.json",
        severity: "error",
      },
      {
        code: "JSON_KEY_RECOMMENDED",
        location: "/dataset_description.json",
        severity: "warning",
        issueMessage: "Synthetic: add a licence.",
      },
      { code: "IGNORED_THING", location: "/x", severity: "ignore" },
    ],
    codeMessages: { SIDECAR_KEY_REQUIRED: "Synthetic: a required key is missing from a sidecar." },
  },
  summary: {
    sessions: ["1", "2"],
    subjects: ["01", "02", "03"],
    tasks: ["rest"],
    modalities: ["EEG"],
    totalFiles: 30,
    size: 4096,
    schemaVersion: "0.11.3",
  },
};

describe("readBidsReport", () => {
  it("reads the output of the 1.x validator, counting each file of an issue", () => {
    const result = readBidsReport(JSON.stringify(LEGACY));
    if (!result.ok) throw new Error(result.message);
    expect(result.report.format).toBe("legacy");
    expect(result.report.errorCount).toBe(2);
    expect(result.report.warningCount).toBe(2);
    expect(result.report.issues[0]).toEqual({
      code: "EEG_SAMPLING_FREQUENCY_MISSING",
      severity: "error",
      count: 2,
      message: "Synthetic: SamplingFrequency is required.",
      locations: ["/sub-01/eeg/sub-01_task-oddball_eeg.json", "/sub-02/eeg/sub-02_task-oddball_eeg.json"],
    });
    expect(result.report.missingMetadata).toEqual([
      "EEG_SAMPLING_FREQUENCY_MISSING: /sub-01/eeg/sub-01_task-oddball_eeg.json",
      "EEG_SAMPLING_FREQUENCY_MISSING: /sub-02/eeg/sub-02_task-oddball_eeg.json",
      "README_FILE_MISSING: Synthetic: no README.",
    ]);
    expect(result.report.summary).toEqual({
      subjectCount: 2,
      sessionCount: 0,
      taskCount: 1,
      totalFiles: 14,
      sizeBytes: 2048,
      schemaVersion: "1.9.0",
      modalities: ["EEG"],
    });
  });

  it("reads the output of the schema-based validator, keeping counts and never the subject labels", () => {
    const result = readBidsReport(JSON.stringify(SCHEMA));
    if (!result.ok) throw new Error(result.message);
    expect(result.report.format).toBe("schema");
    expect(result.report.errorCount).toBe(2);
    expect(result.report.warningCount).toBe(1);
    expect(result.report.issues.map((issue) => [issue.code, issue.count, issue.message])).toEqual([
      ["SIDECAR_KEY_REQUIRED.PowerLineFrequency", 2, "Synthetic: a required key is missing from a sidecar."],
      ["JSON_KEY_RECOMMENDED", 1, "Synthetic: add a licence."],
    ]);
    expect(result.report.missingMetadata).toHaveLength(2);
    expect(result.report.summary.subjectCount).toBe(3);
    expect(result.report.summary.sessionCount).toBe(2);
    expect(JSON.stringify(result.report.summary)).not.toContain('"01"');
  });

  it("keeps the first few locations of a frequent issue", () => {
    const many = {
      issues: {
        issues: Array.from({ length: 12 }, (_, index) => ({
          code: "NOT_INCLUDED",
          location: `/sub-${index}/eeg/file.edf`,
          severity: "error",
        })),
      },
    };
    const result = readBidsReport(JSON.stringify(many));
    if (!result.ok) throw new Error(result.message);
    expect(result.report.issues[0]?.count).toBe(12);
    expect(result.report.issues[0]?.locations).toHaveLength(BIDS_REPORT_MAX_LOCATIONS);
    expect(result.report.summary.totalFiles).toBeNull();
  });

  it("refuses what is not a report, with a message in words", () => {
    expect(readBidsReport("not json")).toMatchObject({ ok: false });
    expect(readBidsReport("[]")).toMatchObject({ ok: false });
    expect(readBidsReport(JSON.stringify({ issues: { other: [] } }))).toMatchObject({ ok: false });
  });

  it("reads a clean report as one with no issue", () => {
    const result = readBidsReport(JSON.stringify({ issues: { errors: [], warnings: [] }, summary: {} }));
    expect(result).toMatchObject({ ok: true, report: { errorCount: 0, warningCount: 0, missingMetadata: [] } });
  });
});
