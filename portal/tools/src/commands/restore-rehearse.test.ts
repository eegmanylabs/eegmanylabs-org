import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MANIFEST_FORMAT } from "../backup/manifest";
import { ToolRefusal } from "../environment";
import { REHEARSAL_DIRECTORY_VARIABLE, rehearsalDirectory, rehearsalReport } from "./restore-rehearse";

const temporary = mkdtempSync(path.join(os.tmpdir(), "eegml-rehearsal-test-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("the rehearsal directory", () => {
  it("is accepted in the temporary directory", () => {
    expect(rehearsalDirectory({ [REHEARSAL_DIRECTORY_VARIABLE]: temporary })).toBe(temporary);
  });

  it("is refused when absent, relative or among the sources", () => {
    expect(() => rehearsalDirectory({})).toThrow(ToolRefusal);
    expect(() => rehearsalDirectory({ [REHEARSAL_DIRECTORY_VARIABLE]: "relative" })).toThrow(ToolRefusal);
    expect(() => rehearsalDirectory({ [REHEARSAL_DIRECTORY_VARIABLE]: path.resolve(import.meta.dirname) })).toThrow(
      /log directory/,
    );
  });
});

describe("the rehearsal report", () => {
  const manifest = {
    format: MANIFEST_FORMAT,
    projectId: "demo-eegml",
    takenAt: "2026-11-13T00:00:00.000Z",
    documents: [],
    accounts: [],
    objects: [],
  } as const;

  it("is dated, says it is emulator evidence and fails when one check fails", () => {
    const report = rehearsalReport(
      manifest,
      [
        { name: "One", passed: true, detail: "fine" },
        { name: "Two", passed: false, detail: "broken" },
      ],
      new Date("2026-11-13T10:00:00.000Z"),
    );
    expect(report).toMatch(/^# Restore rehearsal of 2026-11-13/);
    expect(report).toContain("Emulator evidence only");
    expect(report).toContain("- Result: failed");
    expect(report).toContain("| Two | failed | broken |");
  });
});
