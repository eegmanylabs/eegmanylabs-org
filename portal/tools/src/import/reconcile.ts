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
  /**
   * True for a value that a decision of the programme seals: an outcome label of source E
   * (question 7), a null-significance label or a link to the market's study description or
   * information sheet (question 22), a summary figure of source F (question 14), or what is
   * computed from one. The
   * item is then sealed, the claim shows no value, and its key is a keyed hash of the subject and
   * the value together, so that two items with equal values have different keys.
   */
  readonly sealed?: true;
}

/** The figures of the summary tabs of sources F and A, under the names their claims carry. */
const SUMMARY_METRICS = new Set(["nLabsSigned", "totalNToBeRun", "nLabsFinished", "totalNMainCollected", "totalNRest"]);

/** The columns of source E whose values are sealed labels (questions 7 and 22). */
const SEALED_LABEL_COLUMNS = new Set(["replicated", "null-sig"]);
/** The columns of source E whose links lead to the market's own documents (question 22). */
const SEALED_LINK_COLUMNS = new Set(["studyDescr_pdf", "infosheet_link"]);
/** The claims about a link cell that state its address: its target, its text, and a text that is no address. */
const LINK_ADDRESS_CLAIMS = new Set(["target", "text", "noAddress"]);

/**
 * Whether the source of a claim states a sealed value, whatever the call site says: an outcome
 * label of source E or a counter computed from the labels (question 7), a null-significance
 * label or the address of a link to the market's study description or information sheet
 * (question 22), the value of a row of either label column, or a summary figure of source F
 * (question 14) or of the coordination workbook A, which the answer to question 24 keeps sealed,
 * or a value computed from one. The migration of items raised before the seal reads them the
 * same way. An option of a validated list is vocabulary, which names no row, and stays shown.
 */
export function statesSealedValue(source: string, field: string | undefined): boolean {
  const parts = source.split("/");
  const [sourceKey] = parts;
  if (sourceKey === "e") {
    const last = parts.at(-1) ?? "";
    if (["replicated", "null-sig", "footer", "recount"].includes(last)) return true;
    if (SEALED_LINK_COLUMNS.has(parts.at(-2) ?? "") && LINK_ADDRESS_CLAIMS.has(last)) return true;
    // A value of a row outside the list of its column, which the claim of the tab itself states.
    return parts.length === 2 && field !== undefined && SEALED_LABEL_COLUMNS.has(field);
  }
  if (sourceKey !== "f" && sourceKey !== "a") return false;
  // The comparison of the two workbooks names the bare source keys, and the metric as the field.
  if (parts.length === 1) return field !== undefined && SUMMARY_METRICS.has(field);
  return parts.includes("derived") || SUMMARY_METRICS.has(parts.at(-1) ?? "");
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
  const sealedClaim = (claim: ItemClaim): boolean =>
    claim.sealed === true || statesSealedValue(claim.source, input.field);
  const sealed = input.claims.some(sealedClaim);
  // An item that holds a sealed value is keyed throughout, whatever its kind.
  const personal = sealed || (input.personal ?? PERSONAL_KINDS[kind]);
  const subject = input.field === undefined ? input.subject : `${input.subject}#${input.field}`;
  const hashOf = (claim: ItemClaim): string => {
    // A sealed value is hashed together with the subject, so that equal values of two subjects give different keys.
    if (sealedClaim(claim)) return keyedShortHash(`${subject}\u0000${claim.value}`, secret);
    return personal ? keyedShortHash(claim.value, secret) : shortHash(claim.value);
  };
  const candidates: ItemCandidate[] = input.claims.map((claim) => ({
    key: `${claim.source}:${hashOf(claim)}`,
    // A sealed value is never shown, and a value longer than a verbatim field may hold stays in its source record alone.
    ...(!sealedClaim(claim) && claim.valueSource !== undefined && claim.valueSource.length <= LIMITS.longText
      ? { valueSource: claim.valueSource }
      : {}),
    ...(claim.sourceRecordId === undefined ? {} : { sourceRecordId: claim.sourceRecordId }),
  }));
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
    sealed,
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
