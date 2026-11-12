import { GOOGLE_SYSTEMS, SYNC_REVIEW_KINDS, syncRunStatusSchema } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import {
  labelOf,
  REVIEW_KIND_LABELS,
  RUN_STATUS_LABELS,
  SYSTEM_LABELS,
  statLines,
  valueText,
} from "./integration-format";

describe("the words of the integration pages", () => {
  it("label every system, run status and kind of review item", () => {
    for (const system of GOOGLE_SYSTEMS) expect(SYSTEM_LABELS[system]).toBeDefined();
    for (const status of syncRunStatusSchema.options) expect(RUN_STATUS_LABELS[status]).toBeDefined();
    for (const kind of SYNC_REVIEW_KINDS) expect(REVIEW_KIND_LABELS[kind]).toBeDefined();
  });

  it("say no value in words, and lists with commas", () => {
    expect(valueText(null)).toBe("No value");
    expect(valueText(undefined)).toBe("No value");
    expect(valueText("500\u001f1000")).toBe("500, 1000");
  });

  it("show only the counts above zero, and a code they do not know as it is", () => {
    expect(statLines({ cellsToSheet: 2, fieldsToApp: 0, newCount: 1 })).toEqual([
      "Cells written to the sheet: 2",
      "newCount: 1",
    ]);
    expect(labelOf(RUN_STATUS_LABELS, "someNewStatus")).toBe("someNewStatus");
  });
});
