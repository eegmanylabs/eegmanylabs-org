// Builders of reconciliation items (docs/MIGRATION_PLAN.md, section 7).
//
// The identifier of an item is its fingerprint: a hash of its kind, its subject and the sorted
// keys of its candidates, where a key joins the source of a claim to the hash of its normalised
// value. Row numbers, batch identifiers and times are no part of it, so the same disagreement
// gives the same fingerprint on every run and is raised once, and a changed value gives a new
// one. The hash is keyed wherever a candidate value is personal.
import {
  type EntityRef,
  keyedShortHash,
  LIMITS,
  type ReconciliationKind,
  reconciliationFingerprint,
  shortHash,
} from "@eegml/shared";
import type { ItemCandidate, PlannedItem } from "./model";

/**
 * | Kind                  | Raised when                                                                    | Candidate values are personal |
 * |-----------------------|--------------------------------------------------------------------------------|-------------------------------|
 * | `unmatchedIdentifier` | A study identifier, tab title or DOI resolves to nothing or to several studies | no  |
 * | `aliasConfirmation`   | A spelling differs from the canonical identifier, or two studies share an alias | no  |
 * | `conflictingLead`     | Two lead claims differ, a former lead is recorded, or a second lead is named   | yes |
 * | `valueConflict`       | Two sources, two tabs or two cells give different values for one field         | no  |
 * | `statusQuestion`      | A source signals a change of status                                            | no  |
 * | `unverifiedLabel`     | An outcome label arrives with no evidence, date or author                      | no  |
 * | `duplicatePerson`     | A person could be matched only by name, or two records may be one person       | yes |
 * | `ambiguousEmail`      | One address or ORCID iD would attach to two people                             | yes |
 * | `identifierDefect`    | An address or ORCID iD is malformed or fails its check digit                   | yes |
 * | `ambiguousLaboratory` | A row may belong to one of several laboratories                                | yes |
 * | `institutionMatch`    | An affiliation string awaits mapping, or two strings may name one institution  | no  |
 * | `candidateLink`       | A source suggests a participation or a lead that only a reviewer may create    | yes |
 * | `structureChange`     | A tab or header is missing, renamed or new, or data sits under a blank header  | no  |
 * | `unparsedValue`       | A cell cannot be read mechanically                                             | no  |
 * | `formattingSignal`    | Meaning exists only as colour, strike-through, a highlight or a hidden state   | no  |
 * | `annotationReview`    | A note, footnote, footer or stray cell needs its meaning confirmed             | no  |
 * | `vocabularyReview`    | A value lies outside a known list, or a new term appears                       | no  |
 * | `linkDefect`          | A link is an editor address, has a malformed target or carries a token         | no  |
 * | `privacyReview`       | A cell holds correspondence, a recipient list or a remark about a person       | yes |
 * | `missingFromSource`   | A record imported earlier is absent from the latest snapshot                   | no  |
 */
export const PERSONAL_KINDS: Readonly<Record<ReconciliationKind, boolean>> = {
  unmatchedIdentifier: false,
  aliasConfirmation: false,
  conflictingLead: true,
  valueConflict: false,
  statusQuestion: false,
  unverifiedLabel: false,
  duplicatePerson: true,
  ambiguousEmail: true,
  identifierDefect: true,
  ambiguousLaboratory: true,
  institutionMatch: false,
  candidateLink: true,
  structureChange: false,
  unparsedValue: false,
  formattingSignal: false,
  annotationReview: false,
  vocabularyReview: false,
  linkDefect: false,
  privacyReview: true,
  missingFromSource: false,
};

/** One value that a source, or the portal, states. */
export interface ItemClaim {
  /** Where the claim comes from: a source and tab such as `h/people`, or `portal` for a value edited there. */
  readonly source: string;
  /** The normalised value, which enters the fingerprint through its hash and is not stored. */
  readonly value: string;
  /** The value as written, for the reviewer. */
  readonly valueSource?: string;
  readonly sourceRecordId?: string;
}

export interface ItemInput {
  /** The entity identifier or folded source key that the item is about. It holds no personal value. */
  readonly subject: string;
  readonly entityRefs?: readonly EntityRef[];
  readonly field?: string;
  readonly claims: readonly ItemClaim[];
  /** Overrides whether the candidate values are personal, for a kind that is used both ways. */
  readonly personal?: boolean;
  readonly blocking?: boolean;
  /**
   * True for a question that every source of a family states as far as it knows it, such as
   * whether the rows of one name in several contributor sheets are one person. The statement
   * with the most candidates stands, and the statements it contains are superseded.
   */
  readonly shared?: boolean;
}

function buildItem(kind: ReconciliationKind, input: ItemInput, secret: string): PlannedItem {
  if (input.subject === "" || /[\n\r]/.test(input.subject)) {
    throw new RangeError("The subject of a reconciliation item is one line of text.");
  }
  const personal = input.personal ?? PERSONAL_KINDS[kind];
  const candidates: ItemCandidate[] = input.claims.map((claim) => ({
    key: `${claim.source}:${personal ? keyedShortHash(claim.value, secret) : shortHash(claim.value)}`,
    // A value longer than a verbatim field may hold stays in its source record alone.
    ...(claim.valueSource !== undefined && claim.valueSource.length <= LIMITS.longText
      ? { valueSource: claim.valueSource }
      : {}),
    ...(claim.sourceRecordId === undefined ? {} : { sourceRecordId: claim.sourceRecordId }),
  }));
  const subject = input.field === undefined ? input.subject : `${input.subject}#${input.field}`;
  return {
    fingerprint: reconciliationFingerprint(
      { kind, subject, candidateKeys: candidates.map((candidate) => candidate.key) },
      personal ? secret : undefined,
    ),
    kind,
    subject,
    entityRefs: input.entityRefs ?? [],
    ...(input.field === undefined ? {} : { field: input.field }),
    candidates,
    blocking: input.blocking ?? false,
    // The fingerprint of the question without its candidates is the same in every statement of it.
    ...(input.shared === true
      ? { subjectKey: reconciliationFingerprint({ kind, subject, candidateKeys: [] }, personal ? secret : undefined) }
      : {}),
  };
}

export type ItemBuilders = { readonly [Kind in ReconciliationKind]: (input: ItemInput) => PlannedItem };

/** One builder for each kind of item, bound to the secret of the keyed hash. */
export function itemBuilders(secret: string): ItemBuilders {
  const kinds = Object.keys(PERSONAL_KINDS) as ReconciliationKind[];
  return Object.fromEntries(
    kinds.map((kind) => [kind, (input: ItemInput) => buildItem(kind, input, secret)]),
  ) as ItemBuilders;
}
