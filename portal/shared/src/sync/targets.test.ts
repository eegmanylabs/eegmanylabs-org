// The fields a sheet may hold, and the checks on a mapping's columns.
import { describe, expect, it } from "vitest";
import { allowedDirections, equipmentRowKey, mappingProblems, SYNC_TARGETS, syncTargetField } from "./targets";

describe("synchronisation targets", () => {
  it("accept a valid mapping", () => {
    expect(
      mappingProblems("core:equipment", "Configuration key", [
        { field: "laboratoryName", column: "Laboratory", direction: "generated" },
        { field: "channelCount", column: "EEG channels", direction: "bidirectional" },
      ]),
    ).toEqual([]);
  });

  it("refuse a collection, a field or a direction they do not offer, and names given twice", () => {
    expect(mappingProblems("core:persons", "Key", [])).toEqual(["The portal cannot synchronise core:persons."]);
    expect(mappingProblems("core:laboratories", "Key", [])).toEqual(["A mapping names at least one field."]);
    expect(
      mappingProblems("core:laboratories", "Key", [
        { field: "gender", column: "Gender", direction: "bidirectional" },
        { field: "city", column: "City", direction: "bidirectional" },
        { field: "city", column: "key", direction: "bidirectional" },
      ]),
    ).toEqual([
      "Laboratories have no field gender that a sheet may hold.",
      "City is mapped twice.",
      'The column "key" is named twice.',
    ]);
    expect(
      mappingProblems("core:equipment", "Key", [
        { field: "laboratoryName", column: "Laboratory", direction: "bidirectional" },
      ]),
    ).toEqual(["Laboratory is computed by the portal, so a sheet cannot change it."]);
  });

  it("never take a name that every object inherits for a field of the target", () => {
    for (const name of ["constructor", "toString", "__proto__", "valueOf", "hasOwnProperty"]) {
      expect(syncTargetField("core:laboratories", name), name).toBeUndefined();
      expect(
        mappingProblems("core:laboratories", "Key", [{ field: name, column: "Column", direction: "appAuthoritative" }]),
        name,
      ).toEqual([`Laboratories have no field ${name} that a sheet may hold.`]);
    }
    expect(syncTargetField("core:laboratories", "city")?.label).toBe("City");
  });

  it("let a computed field only be written to the sheet", () => {
    expect(allowedDirections(SYNC_TARGETS["core:equipment"].fields.laboratoryName)).toEqual([
      "appAuthoritative",
      "generated",
    ]);
    expect(equipmentRowKey("lab-memory", "root1")).toBe("lab-memory:root1");
  });
});
