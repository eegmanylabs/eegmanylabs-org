import { describe, expect, it } from "vitest";
import {
  checkRequirement,
  type EquipmentCapabilities,
  type EquipmentRequirement,
  equipmentCompatibility,
} from "./equipment";

const requirement = (
  requirementKey: string,
  operator: EquipmentRequirement["operator"],
  value?: string | number | boolean,
  isMandatory = true,
): EquipmentRequirement => ({ requirementKey, operator, ...(value === undefined ? {} : { value }), isMandatory });

const CONFIGURATION: EquipmentCapabilities = {
  amplifierManufacturer: "Example Amplifiers",
  channelCount: 64,
  samplingRatesHz: [250, 500, 1000],
  displayRefreshHz: 60,
  eyeTracker: "None",
  responseDevices: ["Keyboard", "Button box"],
  triggerMethod: "Parallel port",
};

describe("checkRequirement", () => {
  it.each([
    ["at least as many channels", requirement("channelCount", "atLeast", 64), "met"],
    ["more channels than recorded", requirement("channelCount", "atLeast", 128), "missing"],
    ["a sampling rate the amplifier reaches", requirement("samplingRatesHz", "atLeast", 1000), "met"],
    ["a sampling rate above the highest", requirement("samplingRatesHz", "atLeast", 2000), "missing"],
    ["a refresh rate at most", requirement("displayRefreshHz", "atMost", 60), "met"],
    ["a refresh rate below what is recorded", requirement("displayRefreshHz", "atMost", 50), "missing"],
    ["a sampling rate among those listed", requirement("samplingRatesHz", "includes", 500), "met"],
    ["a sampling rate not listed", requirement("samplingRatesHz", "includes", 512), "missing"],
    ["a manufacturer, compared folded", requirement("amplifierManufacturer", "equals", "example  AMPLIFIERS"), "met"],
    ["another manufacturer", requirement("amplifierManufacturer", "equals", "Other Make"), "missing"],
    ["a response device in the list", requirement("responseDevices", "includes", "button box"), "met"],
    ["a response device not in the list", requirement("responseDevices", "includes", "Touch screen"), "missing"],
    ["a trigger method that contains the word", requirement("triggerMethod", "includes", "parallel"), "met"],
    ["a capability that is present", requirement("channelCount", "present"), "met"],
    ["a capability stated as none", requirement("eyeTracker", "present"), "missing"],
  ] as const)("decides %s", (_label, asked, outcome) => {
    expect(checkRequirement(asked, CONFIGURATION).outcome).toBe(outcome);
  });

  it("names the specific capability and both values when a requirement is missing", () => {
    const check = checkRequirement(requirement("channelCount", "atLeast", 128), CONFIGURATION);
    expect(check).toMatchObject({ label: "EEG channels", outcome: "missing" });
    expect(check.explanation).toBe("EEG channels: needs at least 128 channels; the configuration states 64 channels.");
  });

  it("is unknown, and never missing, when the configuration does not state the capability", () => {
    const check = checkRequirement(requirement("capType", "equals", "Gel cap"), CONFIGURATION);
    expect(check.outcome).toBe("unknown");
    expect(check.explanation).toBe("Cap: the configuration does not say.");
    expect(checkRequirement(requirement("responseDevices", "present"), { responseDevices: [] }).outcome).toBe(
      "unknown",
    );
  });

  it("is unknown when there is no configuration or the portal does not record the capability", () => {
    expect(checkRequirement(requirement("channelCount", "atLeast", 32), null).outcome).toBe("unknown");
    expect(checkRequirement(requirement("questionnaireLanguage", "equals", "en"), CONFIGURATION)).toMatchObject({
      label: "questionnaireLanguage",
      outcome: "unknown",
    });
  });

  it("is unknown when the requirement cannot be compared with the stated value", () => {
    expect(checkRequirement(requirement("channelCount", "atLeast", "many"), CONFIGURATION).outcome).toBe("unknown");
    expect(checkRequirement(requirement("amplifierManufacturer", "atLeast", 3), CONFIGURATION).outcome).toBe("unknown");
    expect(checkRequirement(requirement("channelCount", "equals", true), CONFIGURATION).outcome).toBe("unknown");
  });
});

describe("equipmentCompatibility", () => {
  it("is compatible when every mandatory requirement is met, whatever the optional ones say", () => {
    const report = equipmentCompatibility(
      [requirement("channelCount", "atLeast", 32), requirement("eyeTracker", "present", undefined, false)],
      CONFIGURATION,
    );
    expect(report.overall).toBe("compatible");
    expect(report.checks.map((check) => [check.requirementKey, check.outcome])).toEqual([
      ["channelCount", "met"],
      ["eyeTracker", "missing"],
    ]);
  });

  it("is incompatible when a mandatory requirement is missing, even beside an unknown", () => {
    const report = equipmentCompatibility(
      [requirement("capType", "equals", "Gel cap"), requirement("channelCount", "atLeast", 128)],
      CONFIGURATION,
    );
    expect(report.overall).toBe("incompatible");
  });

  it("is unknown when nothing is missing and a mandatory requirement cannot be decided", () => {
    expect(
      equipmentCompatibility(
        [requirement("capType", "equals", "Gel cap"), requirement("channelCount", "atLeast", 32)],
        CONFIGURATION,
      ).overall,
    ).toBe("unknown");
  });

  it("says when there are no requirements or no configuration", () => {
    expect(equipmentCompatibility([], CONFIGURATION)).toEqual({ overall: "noRequirements", checks: [] });
    const report = equipmentCompatibility([requirement("channelCount", "atLeast", 32)], null);
    expect(report.overall).toBe("noConfiguration");
    expect(report.checks[0]?.outcome).toBe("unknown");
  });
});
