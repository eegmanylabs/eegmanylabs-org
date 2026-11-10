// Builders of the documents that several importers write in the same way: an alias with its
// entry in the folded lookup, a DOI lookup, an affiliation with its institution candidate, a
// vocabulary term and a link in a named slot (docs/MIGRATION_PLAN.md, section 3.3). Every
// identifier is built with the builders of the shared package and never by hand.
import {
  type AliasScheme,
  documentLinkSlotId,
  type EntityRef,
  entityRefId,
  importedAffiliationId,
  institutionCandidateId,
  integrationMappingId,
  LIMITS,
  lookupFold,
  MEMBERS_SCOPE_KEY,
  studyAliasId,
  studyAliasIndexId,
  urlSchema,
  vocabularyTermId,
} from "@eegml/shared";
import type { RawScalar, SourceRow } from "./model";
import type { PlanBuilder } from "./plan";
import type { StudyResolver } from "./studies";

/** The stored value of a cell of a row, by the name the row gives it. Null for an empty or absent cell. */
export function cellValue(row: SourceRow, label: string): RawScalar {
  const cell = row.cells[row.labels.indexOf(label)];
  if (cell === undefined || cell === null) return null;
  return typeof cell === "object" ? (cell.v ?? null) : cell;
}

/** The text of a cell, or null when the cell is empty or holds no text. The text is as the source wrote it. */
export function cellText(row: SourceRow, label: string): string | null {
  const value = cellValue(row, label);
  return typeof value === "string" && value !== "" ? value : null;
}

/** Whether a text is an address that the portal may store as a link. */
export function isStorableUrl(text: string): boolean {
  return urlSchema.safeParse(text).success;
}

export interface AliasInput {
  readonly replicationId: string;
  readonly scheme: AliasScheme;
  /** The spelling exactly as the source wrote it, without a footnote marker. */
  readonly alias: string;
  /** Fields of the alias that follow the source, such as its explanation. */
  readonly owned?: Readonly<Record<string, unknown>>;
  readonly recordId: string;
}

/**
 * States an alias beneath its replication and its entry in the folded lookup, and tells the
 * resolver, so that later rows of the same plan resolve the spelling. An alias is flagged as
 * canonical when it equals the identifier of its replication. Returns false for a spelling of
 * which nothing is left after folding: it has no entry in the lookup and is for a reviewer.
 */
export function aliasDocuments(builder: PlanBuilder, studies: StudyResolver, input: AliasInput): boolean {
  builder.document({
    collection: "replicationAliases",
    ids: [input.replicationId, studyAliasId(input.scheme, input.alias)],
    fixed: {
      replicationId: input.replicationId,
      alias: input.alias,
      aliasFolded: lookupFold(input.alias),
      scheme: input.scheme,
      isCanonical: input.alias === input.replicationId,
    },
    ...(input.owned === undefined ? {} : { owned: input.owned }),
    sourceRecordIds: [input.recordId],
  });
  const indexId = studyAliasIndexId(input.alias);
  if (indexId === null) return false;
  builder.document({
    collection: "studyAliasIndex",
    ids: [indexId],
    union: { replicationIds: [input.replicationId] },
    sourceRecordIds: [input.recordId],
  });
  studies.declare(input.alias, input.replicationId);
  return true;
}

/** The form in which a DOI is a key: trimmed and in lower case. The DOI as written stays on its record. */
export const doiKey = (doi: string): string => doi.trim().toLowerCase();

/** States the lookup that names the record a DOI belongs to. */
export function doiLookupDocument(
  builder: PlanBuilder,
  target: EntityRef & { readonly entityType: "replication" | "manuscript" | "candidateStudy" },
  doi: string,
  recordId: string,
): void {
  const key = doiKey(doi);
  builder.document({
    collection: "integrationMappings",
    ids: [integrationMappingId("doi", target.entityType, key)],
    fixed: { entityType: target.entityType, entityId: target.entityId, system: "doi", externalId: key },
    sourceRecordIds: [recordId],
  });
}

export interface AffiliationInput {
  readonly personId: string;
  readonly sourceKey: string;
  readonly tabKey: string;
  /** The position of the affiliation column in its row, from 1. */
  readonly slot: number;
  /** One raw string, which is never split. */
  readonly affiliation: string;
  readonly recordId: string;
}

/**
 * States the affiliation of a person with its verbatim string, and the institution candidate
 * of the folded string. No institution is created or guessed: a reviewer maps the candidate.
 */
export function affiliationDocuments(builder: PlanBuilder, input: AffiliationInput): void {
  builder.document({
    collection: "personAffiliations",
    ids: [input.personId, importedAffiliationId(input.sourceKey, input.tabKey, input.slot)],
    fixed: { personId: input.personId, isPrimary: input.slot === 1 },
    owned: { affiliationSource: input.affiliation },
    sourceRecordIds: [input.recordId],
  });
  const candidateId = institutionCandidateId(input.affiliation);
  if (candidateId === null) return;
  builder.document({
    collection: "institutionCandidates",
    ids: [candidateId],
    fixed: { affiliationFolded: lookupFold(input.affiliation), institutionId: null },
    union: { affiliationsSource: [input.affiliation] },
    sourceRecordIds: [input.recordId],
  });
}

type LinkKind = "googleDoc" | "googleSheet" | "driveFolder" | "osf" | "github" | "pdf" | "form" | "url";

/** The kind of a link, read from its host and path alone. Nothing is fetched. */
export function linkKindOf(address: string): LinkKind {
  const url = new URL(address);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === "forms.gle" || (host === "docs.google.com" && path.startsWith("/forms/"))) return "form";
  if (host === "docs.google.com" && path.startsWith("/document/")) return "googleDoc";
  if (host === "docs.google.com" && path.startsWith("/spreadsheets/")) return "googleSheet";
  if (host === "drive.google.com" && path.includes("/folders/")) return "driveFolder";
  if (host === "osf.io" || host.endsWith(".osf.io")) return "osf";
  if (host === "github.com") return "github";
  if (path.endsWith(".pdf")) return "pdf";
  return "url";
}

/** Whether an address opens the editor of a Google document or form, which a reader should never be sent to. */
export function isEditorAddress(address: string): boolean {
  const url = new URL(address);
  return url.hostname.toLowerCase() === "docs.google.com" && /\/edit\/?$/.test(url.pathname);
}

export interface LinkInput {
  /** The record the link is attached to. */
  readonly owner: EntityRef;
  /** The named place the source gives the link, such as `signup` or `osf`. */
  readonly slot: string;
  readonly url: string;
  /** The audience of the owner: its replication, and the keys of its scopes. */
  readonly replicationId: string | null;
  readonly ownerScopeKeys: readonly string[];
  readonly recordId: string;
}

/**
 * States a link in a named slot of its owner, so that a corrected address updates the same
 * document. The link is public by origin and carries the audience of its owner with `members`.
 */
export function slotLinkDocument(builder: PlanBuilder, input: LinkInput): void {
  builder.document({
    collection: "documentLinks",
    ids: [documentLinkSlotId(entityRefId(input.owner.entityType, input.owner.entityId), input.slot)],
    fixed: {
      entityType: input.owner.entityType,
      entityId: input.owner.entityId,
      accessStatus: "unknown",
      lastCheckedAt: null,
      restricted: false,
      replicationId: input.replicationId,
      laboratoryId: null,
      scopeKeys: [...input.ownerScopeKeys, MEMBERS_SCOPE_KEY],
    },
    owned: { url: input.url, kind: linkKindOf(input.url) },
    sourceRecordIds: [input.recordId],
  });
}

interface CollectedTerm {
  readonly kind: string;
  /** How often each label names the term. */
  readonly labels: Map<string, number>;
  /** For each raw spelling, the smallest identifier of a source record that carries it. */
  readonly spellings: Map<string, string>;
}

/**
 * Collects the labels that a source uses as vocabulary, and states one term for each kind and
 * folded label. Spellings that fold alike are one term that lists each spelling. The name of
 * the term is its most frequent label, and of equally frequent ones the first in code-point
 * order, so that the same rows always give the same term.
 */
export class VocabularyCollector {
  readonly #terms = new Map<string, CollectedTerm>();

  /**
   * Notes that a row uses a label. `spelling` is the raw value where an alias table mapped it
   * to the label. Returns the identifier of the term, or null for a label that is empty or too
   * long to name one.
   */
  add(kind: string, label: string, recordId: string, spelling: string = label): string | null {
    if (label.trim() === "" || label.length > LIMITS.shortText || spelling.length > LIMITS.longText) return null;
    const id = vocabularyTermId(kind, label);
    const term = this.#terms.get(id) ?? { kind, labels: new Map(), spellings: new Map() };
    this.#terms.set(id, term);
    term.labels.set(label, (term.labels.get(label) ?? 0) + 1);
    const known = term.spellings.get(spelling);
    if (known === undefined || recordId < known) term.spellings.set(spelling, recordId);
    return id;
  }

  /** States every collected term. A term names one source record for each of its spellings. */
  documents(builder: PlanBuilder): void {
    for (const [id, term] of [...this.#terms].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const [name] = [...term.labels].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))[0] ?? [
        "",
      ];
      const spellings = [...term.spellings.keys()].sort();
      builder.document({
        collection: "vocabularyTerms",
        ids: [id],
        fixed: { kind: term.kind, sameAsSource: [], isDeprecated: false },
        owned: { name },
        union: { labelsSource: spellings },
        sourceRecordIds: [...new Set(term.spellings.values())].sort(),
      });
    }
  }
}
