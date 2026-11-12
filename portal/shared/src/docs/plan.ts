// What the engine does to one managed section of a generated document (docs/INTEGRATIONS.md,
// section 3.5). Pure: the functions read the document, describe what they found, and act on
// the plan. The guard is strict: a section is rewritten only while its range is one piece,
// overlaps no pending suggestion and holds exactly the text last generated. Anything else is a
// hand edit, which is never overwritten and goes to a person.
import { shortHash } from "../ids";
import type { Canonical } from "../sync/values";
import { normaliseText } from "../sync/values";
import { withoutProvenance } from "./templates";

/**
 * | Status     | Meaning                                                                   |
 * |------------|---------------------------------------------------------------------------|
 * | `current`  | The section holds the text last generated                                 |
 * | `edited`   | A person changed the section. Nothing is written until a reviewer decides  |
 * | `detached` | A reviewer kept the human text, and the section is generated no more      |
 * | `missing`  | The range has gone from the document. Nothing is written                  |
 */
export const MANAGED_SECTION_STATUSES = ["current", "edited", "detached", "missing"] as const;
export type ManagedSectionStatus = (typeof MANAGED_SECTION_STATUSES)[number];

/** The hash by which a section's text is recognised as the text last generated. */
export function sectionTextHash(text: string): string {
  return shortHash(text.replace(/\r\n?/g, "\n"));
}

/** What the generated document record keeps of one section. */
export interface StoredSection {
  readonly status: ManagedSectionStatus;
  readonly textHash: string;
  /** For a section bound to a designated field: the field value it was last generated from. */
  readonly base?: Canonical;
}

/** What a read of the document found for one section. */
export interface ObservedSection {
  /** Whether a named range of the section exists. */
  readonly found: boolean;
  /** How many pieces the range is in. Certain edits split a range. */
  readonly pieces: number;
  /** The text of the range, its pieces joined, or null where it was not found. */
  readonly text: string | null;
  readonly overlapsSuggestion: boolean;
}

export type SectionPlan =
  /** The section is new to this document and its tag is present: replace the tag and anchor the text. */
  | { readonly kind: "adopt"; readonly text: string }
  /** The template has no tag for the section, so nothing can be adopted. */
  | { readonly kind: "noTag" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "replace"; readonly text: string }
  /** A person changed the section. Nothing is written, and a reviewer decides. */
  | {
      readonly kind: "handEdited";
      readonly documentText: string;
      /** For a designated field: the value the person wrote, the value the record holds and the base. */
      readonly designated: {
        readonly field: string;
        readonly documentValue: Canonical;
        readonly appValue: Canonical;
        readonly base: Canonical | undefined;
      } | null;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "detached" };

export interface SectionPlanInput {
  readonly generatedText: string;
  readonly stored: StoredSection | undefined;
  readonly observed: ObservedSection;
  readonly tagPresent: boolean;
  /** Set for a section bound to a designated field: the field and its current value. */
  readonly designated: { readonly field: string; readonly appValue: Canonical } | null;
}

export function planSection(input: SectionPlanInput): SectionPlan {
  const { generatedText, stored, observed, tagPresent, designated } = input;
  if (stored === undefined) return tagPresent ? { kind: "adopt", text: generatedText } : { kind: "noTag" };
  if (stored.status === "detached") return { kind: "detached" };
  if (!observed.found || observed.text === null) return { kind: "missing" };
  const intact =
    observed.pieces === 1 && !observed.overlapsSuggestion && sectionTextHash(observed.text) === stored.textHash;
  if (!intact || stored.status === "edited") {
    return {
      kind: "handEdited",
      documentText: observed.text,
      designated:
        designated === null
          ? null
          : {
              field: designated.field,
              documentValue: normaliseText(withoutProvenance(observed.text)),
              appValue: designated.appValue,
              base: stored.base,
            },
    };
  }
  return sectionTextHash(generatedText) === stored.textHash
    ? { kind: "unchanged" }
    : { kind: "replace", text: generatedText };
}
