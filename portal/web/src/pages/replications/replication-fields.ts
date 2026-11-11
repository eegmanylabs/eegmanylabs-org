// The descriptive fields of a replication that its leads, the core team and programme
// administrators edit where they are shown, with how each is entered and what is said when a
// value does not fit. The schema of each comes from the shared package, so the page checks what
// the security rules check.
import { replicationDocSchema } from "@eegml/shared";
import type { EditableFieldProps, FieldKind } from "@/components/registry/editable-field";

export interface ReplicationFieldSpec {
  readonly field: keyof typeof replicationDocSchema.shape;
  readonly label: string;
  readonly kind: FieldKind;
  readonly invalidMessage: string;
}

const text = (field: ReplicationFieldSpec["field"], label: string, limit: string): ReplicationFieldSpec => ({
  field,
  label,
  kind: "text",
  invalidMessage: `Enter at most ${limit} characters.`,
});
const longText = (field: ReplicationFieldSpec["field"], label: string, limit: string): ReplicationFieldSpec => ({
  field,
  label,
  kind: "longText",
  invalidMessage: `Enter at most ${limit} characters.`,
});

const RICH_TEXT_MESSAGE = "Shorten the text: this field holds up to 100 KB, about 100,000 characters.";

/** The original study, in the order the page shows it. */
export const ORIGINAL_STUDY_FIELDS: readonly ReplicationFieldSpec[] = [
  longText("originalAuthors", "Authors", "10,000"),
  { field: "originalYear", label: "Year", kind: "year", invalidMessage: "Enter a year from 1800 to 2200." },
  longText("originalTitle", "Title of the original study", "10,000"),
  longText("originalReference", "Reference", "10,000"),
  {
    field: "originalDoi",
    label: "DOI",
    kind: "doi",
    invalidMessage: "Enter a DOI such as 10.1234/abcd, without https://doi.org/.",
  },
];

/** The description of the replication. */
export const DESCRIPTION_FIELDS: readonly ReplicationFieldSpec[] = [
  text("shortTitle", "Short title", "300"),
  { field: "abstract", label: "Abstract", kind: "longText", invalidMessage: RICH_TEXT_MESSAGE },
  longText("effectOfInterest", "Effect of interest", "10,000"),
  {
    field: "plainLanguageDescription",
    label: "Plain-language description",
    kind: "longText",
    invalidMessage: RICH_TEXT_MESSAGE,
  },
  text("theme", "Theme", "300"),
  text("psychConstruct", "Construct", "300"),
];

/** How a laboratory signs up. */
export const SIGN_UP_FIELDS: readonly ReplicationFieldSpec[] = [
  {
    field: "signupUrl",
    label: "Sign-up link",
    kind: "url",
    invalidMessage: "Enter a web address that starts with https://.",
  },
  { field: "signupActive", label: "Sign-up open", kind: "yesNo", invalidMessage: "Choose yes or no." },
];

/** The schema of a field, for `EditableField`. */
export function schemaOf(spec: ReplicationFieldSpec): EditableFieldProps["schema"] {
  return replicationDocSchema.shape[spec.field];
}

/**
 * The extraction fields of a replication, verbatim as a source states them. They are shown as
 * recorded and never edited here: a correction goes through a correction request.
 */
export const EXTRACTION_FIELDS = [
  ["originalNSource", "Sample size of the original study"],
  ["originalEffectSizeSource", "Effect size of the original study"],
  ["originalBayesFactorSource", "Bayes factor of the original study"],
  ["powerBasedNSource", "Sample size from the power analysis"],
  ["durationSource", "Duration of a session"],
  ["minEegChannelsSource", "Minimum number of EEG channels"],
] as const satisfies readonly (readonly [keyof typeof replicationDocSchema.shape, string])[];
