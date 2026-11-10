import { describe, expect, it } from "vitest";
import { actionLabel, fieldLabel, recordTypeLabel, shortPath, shownValue, valueLabel } from "./audit-format";

describe("shownValue", () => {
  it("shows a withheld field as withheld on both sides, whatever else it carries", () => {
    expect(shownValue({ field: "reason", withheld: true }, "before")).toEqual({ kind: "withheld" });
    expect(shownValue({ field: "reason", withheld: true }, "after")).toEqual({ kind: "withheld" });
  });

  it("tells a side that did not exist from one that held null", () => {
    expect(shownValue({ field: "status", after: "active" }, "before")).toEqual({ kind: "absent" });
    expect(shownValue({ field: "status", before: null, after: "active" }, "before")).toEqual({
      kind: "value",
      text: "null",
      multiline: false,
    });
  });

  it("shows codes in words, other text as it is and everything else as JSON", () => {
    expect(shownValue({ field: "status", after: "active" }, "after")).toMatchObject({ text: "Active" });
    expect(shownValue({ field: "status", after: "pendingApproval" }, "after")).toMatchObject({
      text: "Waiting for approval",
    });
    expect(shownValue({ field: "role", after: "programme_admin" }, "after")).toMatchObject({
      text: "Programme administrator",
    });
    expect(shownValue({ field: "reason", after: "Left the programme." }, "after")).toMatchObject({
      text: "Left the programme.",
    });
    expect(shownValue({ field: "name", after: "" }, "after")).toMatchObject({ text: '""' });
    expect(shownValue({ field: "ids", after: ["a", "b"] }, "after")).toEqual({
      kind: "value",
      text: '[\n  "a",\n  "b"\n]',
      multiline: true,
    });
  });
});

describe("words for the registry's identifiers", () => {
  it("name kinds of record, fields and values in sentence case", () => {
    expect(recordTypeLabel("equipmentConfiguration")).toBe("Equipment configuration");
    expect(recordTypeLabel("storageEndpoint")).toBe("Storage endpoint");
    expect(fieldLabel("scopeType")).toBe("Kind of scope");
    expect(fieldLabel("userId")).toBe("Linked account");
    expect(fieldLabel("sessionsValidAfter")).toBe("Sessions valid from");
    expect(fieldLabel("familyName")).toBe("Family name");
    expect(valueLabel("lab_coordinator")).toBe("Laboratory coordinator");
    expect(valueLabel("Synthetic text")).toBe("Synthetic text");
  });
});

describe("labels", () => {
  it("writes actions in sentence case and shortens paths", () => {
    expect(actionLabel("role.granted")).toBe("Role granted");
    expect(actionLabel("account.secondFactorChanged")).toBe("Account second factor changed");
    expect(shortPath("persons/p1/private/contact")).toBe("private/contact");
    expect(shortPath("persons/p1")).toBe("persons/p1");
  });
});
