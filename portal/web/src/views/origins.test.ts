// Fixtures are synthetic.
import type { ViewRecord } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { originNote } from "./origins";

const record = (id: string, dataOrigin?: string): ViewRecord => ({
  id,
  reference: { entityType: "participation", entityId: id },
  values: dataOrigin === undefined ? {} : { dataOrigin },
  createdAt: null,
  updatedAt: null,
  createdBy: null,
  updatedBy: null,
});

describe("originNote", () => {
  it("says nothing of live records or of records without an origin", () => {
    expect(originNote([record("a", "live"), record("b")])).toBeNull();
  });

  it("names a single origin and counts mixed ones", () => {
    expect(originNote([record("a", "demo"), record("b", "demo")])).toBe("From demonstration data");
    expect(originNote([record("a", "importedHistorical"), record("b", "demo"), record("c", "live")])).toBe(
      "Mixed origins: 1 entered in the portal, 1 imported historical, 1 demonstration data",
    );
  });
});
