// Compatibility of a laboratory's equipment with the requirements of a replication
// (docs/DATA_MODEL.md, section 4). Pure: the laboratory page, the replication page and the
// readiness matrix all decide with this function, from the current configuration of the
// laboratory and the requirements stored beneath the replication.
//
// | Outcome   | Meaning                                                                           |
// |-----------|-----------------------------------------------------------------------------------|
// | `met`     | The configuration states the capability, and it satisfies the requirement         |
// | `missing` | The configuration states the capability, and it falls short: the check says how   |
// | `unknown` | The configuration does not state the capability, or the portal cannot compare it   |
//
// An unknown is never counted as met or as missing. A requirement that is not mandatory is
// reported and never makes a laboratory incompatible.
import { fold } from "./ids";
import type { LaboratoryEquipmentDoc } from "./schemas/programme";
import type { ReplicationEquipmentRequirementDoc } from "./schemas/replications";

/** How a capability of a configuration is stored, which decides how it is compared. */
type CapabilityKind = "number" | "numberList" | "text" | "textList";

interface CapabilityDefinition {
  /** The field of the configuration that states the capability. */
  readonly field: keyof LaboratoryEquipmentDoc;
  readonly kind: CapabilityKind;
  /** What the capability is called, in sentence case. */
  readonly label: string;
  /** The unit of a number, where it has one. */
  readonly unit?: string;
}

/**
 * The capabilities a requirement can name, by requirement key. The key is the name of the field
 * of the configuration, except `eegSystem`, which compares the system as the source wrote it.
 */
export const EQUIPMENT_CAPABILITIES = {
  eegSystem: { field: "eegSystemSource", kind: "text", label: "EEG system" },
  amplifierManufacturer: { field: "amplifierManufacturer", kind: "text", label: "Amplifier manufacturer" },
  amplifierModel: { field: "amplifierModel", kind: "text", label: "Amplifier model" },
  capType: { field: "capType", kind: "text", label: "Cap" },
  electrodeType: { field: "electrodeType", kind: "text", label: "Electrode type" },
  channelCount: { field: "channelCount", kind: "number", label: "EEG channels", unit: "channels" },
  samplingRatesHz: { field: "samplingRatesHz", kind: "numberList", label: "Sampling rate", unit: "Hz" },
  referenceScheme: { field: "referenceScheme", kind: "text", label: "Reference scheme" },
  triggerMethod: { field: "triggerMethod", kind: "text", label: "Trigger method" },
  presentationSoftware: { field: "presentationSoftware", kind: "text", label: "Presentation software" },
  stimulusComputer: { field: "stimulusComputer", kind: "text", label: "Stimulus computer" },
  displayRefreshHz: { field: "displayRefreshHz", kind: "number", label: "Display refresh rate", unit: "Hz" },
  eyeTracker: { field: "eyeTracker", kind: "text", label: "Eye tracker" },
  responseDevices: { field: "responseDevices", kind: "textList", label: "Response devices" },
} as const satisfies Record<string, CapabilityDefinition>;

export type EquipmentCapabilityKey = keyof typeof EQUIPMENT_CAPABILITIES;

export type RequirementOutcome = "met" | "missing" | "unknown";

/** What a requirement asks, in the terms of its stored document. */
export type EquipmentRequirement = Pick<
  ReplicationEquipmentRequirementDoc,
  "requirementKey" | "operator" | "value" | "isMandatory"
> & { readonly note?: string | undefined };

/** The capabilities a configuration states. Any field may be absent, which means it does not say. */
export type EquipmentCapabilities = Partial<
  Pick<LaboratoryEquipmentDoc, (typeof EQUIPMENT_CAPABILITIES)[EquipmentCapabilityKey]["field"]>
>;

export interface RequirementCheck {
  readonly requirementKey: string;
  /** The name of the capability, or the requirement key where the portal does not know it. */
  readonly label: string;
  readonly isMandatory: boolean;
  readonly outcome: RequirementOutcome;
  /** One sentence that says what was required and what the configuration states. */
  readonly explanation: string;
}

/**
 * | Overall          | Meaning                                                                    |
 * |------------------|----------------------------------------------------------------------------|
 * | `compatible`     | Every mandatory requirement is met                                         |
 * | `incompatible`   | At least one mandatory requirement is missing                              |
 * | `unknown`        | None is missing, and at least one mandatory requirement cannot be decided  |
 * | `noRequirements` | The replication states no equipment requirement                            |
 * | `noConfiguration`| The laboratory has no current configuration, so nothing can be decided      |
 */
export type CompatibilityOverall = "compatible" | "incompatible" | "unknown" | "noRequirements" | "noConfiguration";

export interface CompatibilityReport {
  readonly overall: CompatibilityOverall;
  readonly checks: readonly RequirementCheck[];
}

const NONE_WORDS = new Set(["none", "no", "notavailable", "na", "n-a"]);

function isCapabilityKey(key: string): key is EquipmentCapabilityKey {
  return Object.hasOwn(EQUIPMENT_CAPABILITIES, key);
}

const withUnit = (value: number, unit: string | undefined) => (unit === undefined ? String(value) : `${value} ${unit}`);

function describe(value: unknown, definition: CapabilityDefinition): string {
  if (typeof value === "number") return withUnit(value, definition.unit);
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "number" ? withUnit(item, definition.unit) : String(item))).join(", ");
  }
  return String(value);
}

/** Whether a configuration says nothing about a capability. An empty list or text says nothing. */
function unstated(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Decides one requirement against what the configuration states. */
function decide(
  requirement: EquipmentRequirement,
  definition: CapabilityDefinition,
  stated: unknown,
): { outcome: RequirementOutcome; reason: string } {
  const required = requirement.value;
  const statedText = describe(stated, definition);
  const unreadable = {
    outcome: "unknown" as const,
    reason: `The requirement cannot be compared with what the configuration states (${statedText}).`,
  };
  switch (requirement.operator) {
    case "present": {
      const said = Array.isArray(stated) ? stated : [stated];
      const none = said.every((item) => typeof item === "string" && NONE_WORDS.has(fold(item)));
      // A check that is not mandatory asks for the capability where the laboratory has it.
      const wanted = requirement.isMandatory ? "needed" : "wanted if available";
      return none
        ? { outcome: "missing", reason: `${definition.label}: ${wanted}; the configuration states none.` }
        : { outcome: "met", reason: `${definition.label}: ${wanted}; the configuration states ${statedText}.` };
    }
    case "atLeast":
    case "atMost": {
      if (typeof required !== "number") return unreadable;
      const numbers = Array.isArray(stated) ? stated : [stated];
      if (!numbers.every((item): item is number => typeof item === "number")) return unreadable;
      const best = requirement.operator === "atLeast" ? Math.max(...numbers) : Math.min(...numbers);
      const met = requirement.operator === "atLeast" ? best >= required : best <= required;
      const bound = `${requirement.operator === "atLeast" ? "at least" : "at most"} ${withUnit(required, definition.unit)}`;
      return {
        outcome: met ? "met" : "missing",
        reason: `${definition.label}: needs ${bound}; the configuration states ${statedText}.`,
      };
    }
    case "equals":
    case "includes": {
      if (required === undefined || typeof required === "boolean") return unreadable;
      const items = Array.isArray(stated) ? stated : [stated];
      const matches = (item: unknown) => {
        if (typeof required === "number") return item === required;
        if (typeof item !== "string") return false;
        return requirement.operator === "equals" || Array.isArray(stated)
          ? fold(item) === fold(required)
          : fold(item).includes(fold(required));
      };
      const met = requirement.operator === "equals" && !Array.isArray(stated) ? matches(stated) : items.some(matches);
      const wanted = typeof required === "number" ? withUnit(required, definition.unit) : required;
      const among = requirement.operator === "equals" ? "" : " among others";
      return {
        outcome: met ? "met" : "missing",
        reason: `${definition.label}: needs ${wanted}${among}; the configuration states ${statedText}.`,
      };
    }
  }
}

/** Checks one requirement against a configuration, or against none. */
export function checkRequirement(
  requirement: EquipmentRequirement,
  configuration: EquipmentCapabilities | null,
): RequirementCheck {
  const base = { requirementKey: requirement.requirementKey, isMandatory: requirement.isMandatory };
  if (!isCapabilityKey(requirement.requirementKey)) {
    return {
      ...base,
      label: requirement.requirementKey,
      outcome: "unknown",
      explanation: "The portal does not record this capability for a laboratory, so a person has to check it.",
    };
  }
  const definition: CapabilityDefinition = EQUIPMENT_CAPABILITIES[requirement.requirementKey];
  if (configuration === null) {
    return {
      ...base,
      label: definition.label,
      outcome: "unknown",
      explanation: "The laboratory has no current equipment configuration.",
    };
  }
  const stated: unknown = configuration[definition.field as keyof EquipmentCapabilities];
  if (unstated(stated)) {
    return {
      ...base,
      label: definition.label,
      outcome: "unknown",
      explanation: `${definition.label}: the configuration does not say.`,
    };
  }
  const { outcome, reason } = decide(requirement, definition, stated);
  return { ...base, label: definition.label, outcome, explanation: reason };
}

/** Compares the requirements of a replication with the current configuration of a laboratory. */
export function equipmentCompatibility(
  requirements: readonly EquipmentRequirement[],
  configuration: EquipmentCapabilities | null,
): CompatibilityReport {
  const checks = [...requirements]
    .sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory) || a.requirementKey.localeCompare(b.requirementKey))
    .map((requirement) => checkRequirement(requirement, configuration));
  if (checks.length === 0) return { overall: "noRequirements", checks };
  if (configuration === null) return { overall: "noConfiguration", checks };
  const mandatory = checks.filter((check) => check.isMandatory);
  if (mandatory.some((check) => check.outcome === "missing")) return { overall: "incompatible", checks };
  if (mandatory.some((check) => check.outcome === "unknown")) return { overall: "unknown", checks };
  return { overall: "compatible", checks };
}
