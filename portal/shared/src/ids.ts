// Identifier derivation (docs/DATA_MODEL.md, section 1). Every function here is pure and
// deterministic: the same input always gives the same identifier, which is what makes an import
// that runs twice write the same documents. A change to any derivation would break that, so
// ids.test.ts pins every builder to golden values.
//
// | Building block      | Result                                                                  |
// |---------------------|-------------------------------------------------------------------------|
// | `fold`              | Lower-case words of `a` to `z` and `0` to `9`, joined by single hyphens |
// | `lookupFold`        | The same without the hyphens: the folded form that serves lookups       |
// | `sha256Hex`         | SHA-256 of the UTF-8 bytes of a text, as 64 hexadecimal characters      |
// | `shortHash`         | The first 20 hexadecimal characters of the SHA-256 of a text in NFC     |
// | `keyedShortHash`    | The same from HMAC-SHA-256, for a personal value                        |
//
// A composite identifier joins its parts with two underscores. A part holds letters, digits,
// hyphens, full stops, colons and single underscores, and neither begins nor ends with an
// underscore. At most one part of an identifier may itself contain the separator (an identifier
// that an importer derived, such as `lab__0f3a...`), and every builder says which. With those
// rules two different lists of parts can never give the same identifier, and a builder throws a
// `RangeError` for a part that breaks them. A part that may hold other characters is replaced by
// its hash, and the hash of a personal value is keyed with a secret from the secret store.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { GrantableCapability, Role, RoleScopeType } from "./capabilities";
import type { EntityType } from "./entities";
import { normaliseEmail } from "./identifiers";

/** The separator between the parts of a composite identifier. */
export const ID_SEPARATOR = "__";

/** The number of hexadecimal characters kept of a hash that stands for a part. */
export const SHORT_HASH_LENGTH = 20;

/**
 * The identifier that Firestore generates for a record made in the portal: twenty letters and
 * digits. Where the data model calls an identifier opaque, the security rules accept no other
 * shape from a client, so a client can never take an identifier that trusted code derives: a
 * derived identifier holds the separator, a hyphen or another length.
 */
export const AUTO_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

/** Whether an identifier has the shape of one that Firestore generates. */
export function isAutoId(id: string): boolean {
  return AUTO_ID_PATTERN.test(id);
}

/** The shortest secret, in bytes of UTF-8, that a keyed hash accepts. */
export const MIN_HASH_SECRET_BYTES = 32;

/**
 * Folds a text for matching: Unicode NFKD, combining marks removed, lower case, every run of
 * other characters replaced by one hyphen, and no hyphen at either end. `São  Paulo!` gives
 * `sao-paulo`. Folding is for identifiers and lookups only. The text itself is stored as written.
 */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The folded form that serves lookups (docs/DATA_MODEL.md, section 1): `fold` without its
 * hyphens, so only `a` to `z` and `0` to `9` remain. `Amodio-Jost 2007`, `AmodioJost2007_` and
 * `amodiojost2007` all give `amodiojost2007`.
 */
export function lookupFold(text: string): string {
  return fold(text).replaceAll("-", "");
}

/**
 * Folds a text for matching in any script: Unicode NFKD, the combining marks of Latin letters
 * removed (as `fold` does) while the marks of other scripts stay, because in Arabic, Hebrew,
 * Devanagari or Hangul they carry the word, then NFC and lower case, with every run of
 * characters that are not letters, marks or digits replaced by one hyphen. `São  Paulo!` gives
 * `sao-paulo`, as with `fold`, and `جامعة المثال` gives `جامعة-المثال` where `fold` gives nothing.
 * For search and for the name keys of organisations. The text itself is stored as written.
 */
export function searchFold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The words of a search query, folded with `searchFold`: null when nothing was typed, which
 * matches everything, and an empty list when what was typed holds no letter or digit, which
 * matches nothing, so that a query in a script the fold cannot read never shows every record.
 */
export function searchWords(query: string): readonly string[] | null {
  if (query.trim() === "") return null;
  return searchFold(query).split("-").filter(Boolean);
}

/** Whether every word of a query is found in one of the texts. Null words match everything. */
export function matchesSearch(words: readonly string[] | null, texts: readonly (string | null | undefined)[]): boolean {
  if (words === null) return true;
  if (words.length === 0) return false;
  const folded = texts.flatMap((text) => (text == null ? [] : [searchFold(text)]));
  return words.every((word) => folded.some((text) => text.includes(word)));
}

/** `searchFold` without its hyphens: the name of an organisation as its key folds it, in any script. */
export function nameFold(text: string): string {
  return searchFold(text).replaceAll("-", "");
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function encode(text: string): Uint8Array {
  // An unpaired surrogate has no UTF-8 form. Encoders replace each one by the same substitute,
  // which would let two different texts share a hash.
  if (LONE_SURROGATE.test(text)) throw new RangeError("The text is not well-formed Unicode and cannot be hashed.");
  return utf8ToBytes(text);
}

/** SHA-256 of the UTF-8 bytes of a text, in lower-case hexadecimal. Works in a browser and in Node.js alike. */
export function sha256Hex(text: string): string {
  return bytesToHex(sha256(encode(text)));
}

/** The hash that stands for a part that is not personal: 20 hexadecimal characters of SHA-256 over the text in NFC. */
export function shortHash(value: string): string {
  return sha256Hex(value.normalize("NFC")).slice(0, SHORT_HASH_LENGTH);
}

/**
 * The hash that stands for a personal value such as a name, an email address or an ORCID iD:
 * 20 hexadecimal characters of HMAC-SHA-256 over the text in NFC. A plain hash of such a value
 * can be reversed by guessing, so the key is a secret that importers and functions read from the
 * secret store and never from the repository.
 */
export function keyedShortHash(value: string, secret: string): string {
  const key = encode(secret);
  if (key.length < MIN_HASH_SECRET_BYTES) {
    throw new RangeError(`The secret of a keyed hash is at least ${MIN_HASH_SECRET_BYTES} bytes long.`);
  }
  return bytesToHex(hmac(sha256, key, encode(value.normalize("NFC")))).slice(0, SHORT_HASH_LENGTH);
}

const PART = /^(?!_)(?:[A-Za-z0-9.:-]|_(?![_]|$))+$/;
const WIDE_PART = /^(?!_)(?:[A-Za-z0-9.:-]|_(?!$))+$/;

/**
 * Joins the parts of a composite identifier. `wide` is the position of the one part that may
 * itself contain the separator, or -1 when no part may.
 */
function compose(parts: readonly string[], wide = -1): string {
  parts.forEach((part, index) => {
    if (!(index === wide ? WIDE_PART : PART).test(part)) {
      throw new RangeError(
        `Part ${index + 1} of a composite identifier holds letters, digits, hyphens, full stops, colons and ` +
          `single underscores, and neither begins nor ends with an underscore${index === wide ? "" : ", and never two underscores in a row"}.`,
      );
    }
  });
  return parts.join(ID_SEPARATOR);
}

/** The text that a hash over several values is taken from: the values in NFC, one to a line. */
function lines(values: readonly string[]): string {
  return values
    .map((value, index) => {
      if (value.includes("\n")) throw new RangeError(`Value ${index + 1} of a hashed key contains a line feed.`);
      return value.normalize("NFC");
    })
    .join("\n");
}

function wholeNumber(value: number, what: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${what} is a whole number from 0 to ${maximum}.`);
  }
  return value;
}

// Scope keys (docs/DATA_MODEL.md, section 1).

/** The scope of the programme as a whole, held by programme administrators and the core team. */
export const PROGRAMME_SCOPE_KEY = "programme";
/** The scope of every approved member. */
export const MEMBERS_SCOPE_KEY = "members";

function scopeKey(prefix: string, identifier: string): string {
  if (identifier.length === 0 || identifier.includes("/")) {
    throw new RangeError("A scope key names a non-empty identifier without a slash.");
  }
  return `${prefix}:${identifier}`;
}

export const replicationScopeKey = (studyKey: string): string => scopeKey("rep", studyKey);
export const laboratoryScopeKey = (laboratoryId: string): string => scopeKey("lab", laboratoryId);
export const groupScopeKey = (groupKey: string): string => scopeKey("group", groupKey);
export const userScopeKey = (uid: string): string => scopeKey("user", uid);
export const roleScopeKey = (role: Role): string => scopeKey("role", role);

const SCOPE_KEY_KINDS = { rep: "replication", lab: "laboratory", group: "group", user: "user", role: "role" } as const;
export type ScopeKeyKind = (typeof SCOPE_KEY_KINDS)[keyof typeof SCOPE_KEY_KINDS];

/**
 * What a scope key names: the kind of unit and its identifier, the reverse of the builders
 * above. Null for `programme`, `members` and anything that is not a well-formed scope key.
 */
export function parseScopeKey(key: string): { kind: ScopeKeyKind; id: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const prefix = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!Object.hasOwn(SCOPE_KEY_KINDS, prefix) || id === "" || id.includes("/")) return null;
  return { kind: SCOPE_KEY_KINDS[prefix as keyof typeof SCOPE_KEY_KINDS], id };
}

/**
 * The `scopeKeys` of a document whose scope is its own replication, its own laboratory or
 * both: their keys in that order. The security rules rebuild the same array on each client write.
 */
export function unitScopeKeys(replicationId: string | null, laboratoryId: string | null): string[] {
  return [
    ...(replicationId === null ? [] : [replicationScopeKey(replicationId)]),
    ...(laboratoryId === null ? [] : [laboratoryScopeKey(laboratoryId)]),
  ];
}

// Identity and access.

/**
 * `entityType__entityId`: the identifier of a favourite, a recent and a subscription beneath a
 * user, of the body page of an entity, and the form of a key in `sharedRecordKeys`. The entity
 * identifier may contain the separator.
 */
export function entityRefId(entityType: EntityType, entityId: string): string {
  return compose([entityType, entityId], 1);
}

/**
 * The `entityId` of an entity in a subcollection: the identifier of its parent document joined
 * to its own, as in `AmodioJost2007__h01`. The parent identifier may contain the separator and
 * the entity's own identifier may not, so `splitNestedEntityId` finds the two again.
 */
export function nestedEntityId(parentId: string, ownId: string): string {
  return compose([parentId, ownId], 0);
}

/** The parent identifier and the own identifier of an `entityId` made by `nestedEntityId`. */
export function splitNestedEntityId(entityId: string): readonly [parentId: string, ownId: string] {
  const cut = entityId.lastIndexOf(ID_SEPARATOR);
  const parentId = cut < 0 ? "" : entityId.slice(0, cut);
  const ownId = cut < 0 ? "" : entityId.slice(cut + ID_SEPARATOR.length);
  if (cut < 0 || nestedEntityId(parentId, ownId) !== entityId) {
    throw new RangeError("The identifier does not name an entity in a subcollection.");
  }
  return [parentId, ownId];
}

/** `uid__role__scopeType__scopeId`. The scope identifier may contain the separator. */
export function roleAssignmentId(uid: string, role: Role, scopeType: RoleScopeType, scopeId: string): string {
  return compose([uid, role, scopeType, scopeId], 3);
}

/** `uid__capability`, for example `uid__demographics.read`. */
export function capabilityGrantId(uid: string, capability: GrantableCapability): string {
  return compose([uid, capability]);
}

/** `uid__entityType__entityId`. The entity identifier may contain the separator. */
export function recordGrantId(uid: string, entityType: EntityType, entityId: string): string {
  return compose([uid, entityType, entityId], 2);
}

/** `uid__laboratoryId`. The laboratory identifier may contain the separator. */
export function labClaimId(uid: string, laboratoryId: string): string {
  return compose([uid, laboratoryId], 1);
}

/** The keyed hash of an email address in canonical form: the identifier of its entry in `personEmailIndex`. */
export function personEmailIndexId(email: string, secret: string): string {
  return keyedShortHash(normaliseEmail(email), secret);
}

/**
 * The keyed hash of entity type, key kind and normalised key: the identifier of an identity
 * key. The caller normalises the key for its kind before it calls.
 */
export function identityKeyId(entityType: EntityType, keyKind: string, normalisedKey: string, secret: string): string {
  return keyedShortHash(lines([entityType, keyKind, normalisedKey]), secret);
}

/**
 * The key strings by which an import finds a person again (docs/MIGRATION_PLAN.md, section 3.3).
 * Each is the normalised key of an identity key, and the first one that a source row carries is
 * the evidence from which the identifier of a new person is derived. The importers and the claim
 * function share these, so that both hash the same text.
 */
export const personEvidenceKey = {
  /** A `PersonId` of the Core Team file of the public website. */
  websitePeople: (websitePersonId: string): string => `web_people:${websitePersonId}`,
  /** A `PersonId` of the Members file of the public website. */
  websiteMembers: (websitePersonId: string): string => `web_members:${websitePersonId}`,
  /** A bare ORCID iD, in upper case. */
  orcid: (orcid: string): string => `orcid:${orcid.trim().toUpperCase()}`,
  /** An email address in canonical form. */
  email: (email: string): string => `email:${normaliseEmail(email)}`,
  /**
   * A name with its affiliation, both folded for lookups. It links a row to an existing person
   * and never creates one. Null when nothing is left of either part.
   */
  nameAffiliation: (name: string, affiliation: string): string | null => {
    const foldedName = lookupFold(name);
    const foldedAffiliation = lookupFold(affiliation);
    return foldedName === "" || foldedAffiliation === "" ? null : `name:${foldedName}@${foldedAffiliation}`;
  },
} as const;

/**
 * `p__hash`: the identifier of a person that an importer creates, from the keyed hash of the
 * first evidence key of the row that created the person. It is assigned once and never changes,
 * and later imports find the person through `identityKeys`.
 */
export function importedPersonId(firstEvidenceKey: string, secret: string): string {
  if (firstEvidenceKey.trim() === "") throw new RangeError("An evidence key is not empty.");
  return compose(["p", keyedShortHash(firstEvidenceKey, secret)]);
}

/**
 * The key strings by which an institution and a laboratory are found again: the `nameAffiliation`
 * identity keys of docs/DATA_MODEL.md, section 3. A folded name is joined to its context, the
 * country of an institution and the institution of a laboratory. The importers, the functions
 * that create these records and the interface share them, so that all three hash the same text.
 * The name is folded with `nameFold`, so a name in any script has a key, and two names that
 * differ only outside the Latin alphabet have different keys. Null when nothing is left of the
 * name after folding.
 */
export const organisationKey = {
  institution: (name: string, countryCode: string): string | null => {
    const folded = nameFold(name);
    return folded === "" ? null : `${folded}#${countryCode.trim().toUpperCase()}`;
  },
  laboratory: (institutionId: string, name: string): string | null => {
    const folded = nameFold(name);
    return folded === "" ? null : `${institutionId}#${folded}`;
  },
} as const;

/**
 * `inst__hash`: the identifier of an institution that is registered in the portal, from the hash
 * of its name key (`organisationKey.institution`). The same institution entered twice, however
 * its name is spelt, addresses the same document, so the second entry is found as a duplicate.
 */
export function registeredInstitutionId(name: string, countryCode: string): string {
  const key = organisationKey.institution(name, countryCode);
  if (key === null) throw new RangeError("The name of an institution holds a letter or a digit.");
  return compose(["inst", shortHash(key)]);
}

/**
 * `lab__hash`: the identifier of a laboratory that is registered in the portal, from the hash of
 * its name key at its institution (`organisationKey.laboratory`). The same laboratory proposed
 * twice addresses the same document, which is how a duplicate is caught.
 */
export function registeredLaboratoryId(institutionId: string, name: string): string {
  const key = organisationKey.laboratory(institutionId, name);
  if (key === null) throw new RangeError("The name of a laboratory holds a letter or a digit.");
  return compose(["lab", shortHash(key)]);
}

/**
 * `sourceKey__tabKey__aN`: the identifier of an affiliation that an importer writes beneath a
 * person, from the source, the tab and the affiliation slot of the row. The source key may
 * contain the separator.
 */
export function importedAffiliationId(sourceKey: string, tabKey: string, slot: number): string {
  return compose([sourceKey, tabKey, `a${wholeNumber(slot, "An affiliation slot", 99)}`], 0);
}

/**
 * `instcand__hash` of the lookup fold of an affiliation string, so that one string from two
 * sources meets in one candidate. Null when nothing is left of the string.
 */
export function institutionCandidateId(affiliation: string): string | null {
  const folded = lookupFold(affiliation);
  return folded === "" ? null : compose(["instcand", shortHash(folded)]);
}

// Replications and scientific definition.

/** `scheme__hash`, where the hash is taken over the alias as written. An alias lives beneath its replication. */
export function studyAliasId(scheme: string, alias: string): string {
  return compose([scheme, shortHash(alias)]);
}

/**
 * The identifier of the `studyAliasIndex` entry of a spelling: its lookup fold. Null when
 * nothing is left of the spelling, in which case it has no entry and is raised for review.
 */
export function studyAliasIndexId(alias: string): string | null {
  const folded = lookupFold(alias);
  return folded === "" ? null : folded;
}

/** `h` and a two-digit number, for example `h01`. A hypothesis lives beneath its replication. */
export function hypothesisId(hypothesisNumber: number): string {
  if (!Number.isInteger(hypothesisNumber) || hypothesisNumber < 1 || hypothesisNumber > 99) {
    throw new RangeError("A hypothesis number is a whole number from 1 to 99.");
  }
  return `h${String(hypothesisNumber).padStart(2, "0")}`;
}

/** `personId__role`. The person identifier may contain the separator. A membership lives beneath its replication. */
export function replicationMembershipId(personId: string, role: string): string {
  return compose([personId, role], 0);
}

/** `entityType__key`: the identifier of a status definition. */
export function statusDefinitionId(entityType: EntityType, key: string): string {
  return compose([entityType, key]);
}

/** `metricKey__sourceRecordId`: the identifier of a historical aggregate. */
export function historicalAggregateId(metricKey: string, sourceRecordId: string): string {
  return compose([metricKey, sourceRecordId]);
}

/** The longest folded label that is used as it stands in the identifier of a vocabulary term. */
export const VOCABULARY_FOLD_MAX_LENGTH = 60;

/**
 * The identifier of a vocabulary term that does not come from the community vocabulary: its
 * kind and the lookup fold of its label, or the hash of the label as written when the fold is
 * empty or longer than 60 characters. Spellings that fold alike are one term. A term of the
 * community vocabulary keeps its original identifier and needs no builder.
 */
export function vocabularyTermId(kind: string, label: string): string {
  const folded = lookupFold(label);
  const usable = folded !== "" && folded.length <= VOCABULARY_FOLD_MAX_LENGTH;
  return compose([kind, usable ? folded : shortHash(label)]);
}

/** What identifies a nominated paper: its DOI, or its first author, year and title where it has none. */
export type CandidateStudyKey =
  | { readonly doi: string }
  | { readonly firstAuthorSurname: string; readonly year: number; readonly title: string };

/**
 * `cand__hash` of the DOI in lower case, or `cand__t__hash` of the folded surname of the first
 * author, the year and the folded title for a paper that has no DOI.
 */
export function candidateStudyId(key: CandidateStudyKey): string {
  if ("doi" in key) {
    const doi = key.doi.trim().toLowerCase();
    if (doi === "") throw new RangeError("A DOI is not empty.");
    return compose(["cand", shortHash(doi)]);
  }
  const surname = lookupFold(key.firstAuthorSurname);
  const title = lookupFold(key.title);
  if (surname === "" || title === "") throw new RangeError("A candidate study needs a first author and a title.");
  return compose(["cand", "t", shortHash(lines([surname, String(wholeNumber(key.year, "A year", 9999)), title]))]);
}

/** The highest ordinal that the identifier of a prediction-market item can carry. */
export const MAX_PREDICTION_MARKET_ORDINAL = 999;

/**
 * `pmq__hash__ordinal`: the identifier of a survey or market question that an importer writes
 * (docs/MIGRATION_PLAN.md, section 4.4). The hash is taken over the heading of the section in
 * which the question stands and over the text of the question, each with its white space
 * collapsed, and the ordinal counts the exact repeats of that pair, from 1. A row number is no
 * part of it, so a question keeps its identifier when rows are inserted above it.
 */
export function predictionMarketItemId(sectionHeading: string, questionText: string, ordinal: number): string {
  const collapsed = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim();
  const question = collapsed(questionText);
  if (question === "") throw new RangeError("A question has a text.");
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_PREDICTION_MARKET_ORDINAL) {
    throw new RangeError(
      `The ordinal of a prediction-market item is a whole number from 1 to ${MAX_PREDICTION_MARKET_ORDINAL}.`,
    );
  }
  return compose(["pmq", shortHash(lines([collapsed(sectionHeading), question])), String(ordinal)]);
}

// Participation.

/** `studyKey__laboratoryId`. The laboratory identifier may contain the separator. */
export function participationId(studyKey: string, laboratoryId: string): string {
  return compose([studyKey, laboratoryId], 1);
}

/** `personId__protocolVersionId`. The person identifier may contain the separator. */
export function acknowledgementId(personId: string, protocolVersionId: string): string {
  return compose([personId, protocolVersionId], 0);
}

/** The highest ordinal that the identifier of an outreach contact can carry. */
export const MAX_OUTREACH_ORDINAL = 9_999;

/**
 * The keyed hash that stands for the name cell of an outreach row: taken over the lookup fold
 * of the cell, so that a trailing space or a question mark changes nothing, or over the cell as
 * written when nothing is left of it after folding. The row key of the source record and the
 * identifier of the contact are both built from it.
 */
export function outreachNameHash(contactNameCell: string, secret: string): string {
  const folded = lookupFold(contactNameCell);
  return keyedShortHash(folded === "" ? contactNameCell : folded, secret);
}

/**
 * `oc__sourceKey__tabKey__hash__ordinal`: the identifier of an outreach contact that an importer
 * writes, one for each source row (docs/MIGRATION_PLAN.md, section 3.3). The hash stands for the
 * name cell of the row, and the ordinal counts the rows of the tab whose names fold alike, from
 * 1. Neither a row number nor a readable name is part of it. The source key may contain the
 * separator.
 */
export function outreachContactId(
  sourceKey: string,
  tabKey: string,
  contactNameCell: string,
  ordinal: number,
  secret: string,
): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_OUTREACH_ORDINAL) {
    throw new RangeError(`The ordinal of an outreach contact is a whole number from 1 to ${MAX_OUTREACH_ORDINAL}.`);
  }
  return compose(["oc", sourceKey, tabKey, outreachNameHash(contactNameCell, secret), String(ordinal)], 1);
}

/**
 * The key that the copies of one contact share across the tabs of one study: the keyed hash of
 * the lookup fold of the study identifier and of the name cell. It links the copies, which are
 * never merged. Null when nothing is left of either part after folding.
 */
export function outreachGroupKey(studyKey: string, contactNameCell: string, secret: string): string | null {
  const study = lookupFold(studyKey);
  const name = lookupFold(contactNameCell);
  return study === "" || name === "" ? null : keyedShortHash(lines([study, name]), secret);
}

// Tasks and workspace.

/** The hash of the lookup fold of a tag name, so that one name is one tag however it is spelt. */
export function tagId(name: string): string {
  const folded = lookupFold(name);
  if (folded === "") throw new RangeError("A tag name holds at least one letter or digit.");
  return shortHash(folded);
}

/** `principalType__principalId`. The principal identifier may contain the separator. */
export function pagePermissionId(principalType: string, principalId: string): string {
  return compose([principalType, principalId], 1);
}

/** The highest position that `sequenceId` can express. */
export const MAX_SEQUENCE_NUMBER = 999_999;

/**
 * The identifier of a chunk, a change or a log entry by its position in a series: the number
 * with six digits, so that identifiers sort in the order of the series.
 */
export function sequenceId(position: number): string {
  return String(wholeNumber(position, "A position in a series", MAX_SEQUENCE_NUMBER)).padStart(6, "0");
}

/** `generation__n`: the identifier of one chunk of a page snapshot. */
export function pageContentChunkId(generation: number, index: number): string {
  return compose([sequenceId(generation), sequenceId(index)]);
}

// Scientific outputs.

/** The highest ordinal that the identifier of a contributor can carry. */
export const MAX_CONTRIBUTOR_ORDINAL = 9_999;

function fileIdentifierHash(fileIdentifier: string): string {
  if (fileIdentifier.trim() === "") throw new RangeError("The file identifier of a contributor sheet is not empty.");
  return shortHash(fileIdentifier.trim());
}

/**
 * `ctable-hash`: the key of a contributor sheet in the source registry, from the hash of the
 * identifier that the host gives the file. The identifier is a long random string, so its plain
 * hash cannot be reversed by guessing, and the identifier itself stays in private configuration.
 * The key joins its two parts with a hyphen, because the key of a source holds no separator.
 */
export function contributorSheetSourceKey(fileIdentifier: string): string {
  return `ctable-${fileIdentifierHash(fileIdentifier)}`;
}

/**
 * `ctable__hash`: the identifier of the contributor table that an importer writes for a sheet,
 * from the hash of the file identifier. One replication may have a sign-up table and a final
 * table, so the replication is no part of it.
 */
export function contributorTableId(fileIdentifier: string): string {
  return compose(["ctable", fileIdentifierHash(fileIdentifier)]);
}

/**
 * The keyed hash that stands for the name of a contributor row: taken over the lookup folds of
 * the first name cell and of the surname cell, one to a line. The middle name is left out,
 * because it varies between the sheets of one person. Null when nothing is left of either cell.
 */
export function contributorNameHash(firstNameCell: string, surnameCell: string, secret: string): string | null {
  const first = lookupFold(firstNameCell);
  const surname = lookupFold(surnameCell);
  return first === "" || surname === "" ? null : keyedShortHash(lines([first, surname]), secret);
}

/**
 * `ctr__hash__hash__ordinal`: the identifier of a contributor that an importer writes, one for
 * each named row of a sheet (docs/MIGRATION_PLAN.md, section 3.3). The first hash stands for
 * the file, the second is `contributorNameHash`, and the ordinal counts the rows of the sheet
 * whose names fold alike, from 1. Neither a row number, an order value nor a readable name is
 * part of it.
 */
export function contributorId(fileIdentifier: string, nameHash: string, ordinal: number): string {
  if (!/^[0-9a-f]{20}$/.test(nameHash)) throw new RangeError("The name hash of a contributor is a keyed short hash.");
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_CONTRIBUTOR_ORDINAL) {
    throw new RangeError(`The ordinal of a contributor is a whole number from 1 to ${MAX_CONTRIBUTOR_ORDINAL}.`);
  }
  return compose(["ctr", fileIdentifierHash(fileIdentifier), nameHash, String(ordinal)]);
}

/**
 * `p-hash`: the slug of a person whom an importer creates from a restricted source. A slug is
 * a public page anchor, so it is never derived from the name of such a person: it repeats the
 * hash of the identifier of the person.
 */
export function opaquePersonSlug(personId: string): string {
  const match = /^p__([0-9a-f]{20})$/.exec(personId);
  if (match === null) throw new RangeError("An opaque slug is taken from the identifier of an imported person.");
  return `p-${match[1]}`;
}

// Provenance, migration and integrations.

/** The key of a tab of a source: the hash of its exact title, since two titles can fold alike. */
export function sourceTabKey(title: string): string {
  return shortHash(title);
}

/** The hash of source key, tab key, row key and raw hash: one source record per revision of a row. */
export function sourceRecordId(sourceKey: string, tabKey: string, rowKey: string, rawHash: string): string {
  return shortHash(lines([sourceKey, tabKey, rowKey, rawHash]));
}

/**
 * `run__time__hash`: the identifier of an import batch, from the instant it started, in UTC to
 * the millisecond, and the first 12 hexadecimal characters of the SHA-256 of the file it read.
 * A preview and an apply of one file start at different instants and are different batches.
 */
export function importBatchId(startedAt: Date, contentHash: string): string {
  if (Number.isNaN(startedAt.getTime())) throw new RangeError("The start of a batch is a valid instant.");
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new RangeError("A content hash is a SHA-256 in hexadecimal.");
  const instant = startedAt.toISOString().replace(/[-:.]/g, "");
  return compose(["run", instant, contentHash.slice(0, 12)]);
}

/**
 * `ownerId__slot`: the identifier of a document link that a source gives a named place, such as
 * `signup` or `osf`, so that a corrected address updates the same document. The owner identifier
 * may contain the separator.
 */
export function documentLinkSlotId(ownerId: string, slot: string): string {
  return compose([ownerId, slot], 0);
}

export interface ReconciliationSubject {
  readonly kind: string;
  /** The entity identifier or folded source key that the conflict is about, with the field where one applies. */
  readonly subject: string;
  /** One key for each candidate value: its claim source and the hash of its normalised value. */
  readonly candidateKeys: readonly string[];
}

/**
 * The fingerprint of a reconciliation item: a hash of its kind, its subject and its candidate
 * keys in sorted order. Row numbers, batch identifiers and times are no part of it, so the same
 * disagreement gives the same fingerprint on every run. Pass the secret when a candidate value
 * is personal.
 */
export function reconciliationFingerprint(item: ReconciliationSubject, secret?: string): string {
  const candidates = [...new Set(item.candidateKeys.map((key) => key.normalize("NFC")))].sort();
  const text = lines([item.kind, item.subject, ...candidates]);
  return secret === undefined ? shortHash(text) : keyedShortHash(text, secret);
}

/** `system__entityType__hash` of the external identifier. */
export function integrationMappingId(system: string, entityType: EntityType, externalId: string): string {
  return compose([system, entityType, shortHash(externalId)]);
}

/** The hash of source key, tab key and collection key: one synchronisation mapping per tab and collection. */
export function syncMappingId(sourceKey: string, tabKey: string, collectionKey: string): string {
  return shortHash(lines([sourceKey, tabKey, collectionKey]));
}

/** The hash of record identifier and field: one base value per mapped cell. */
export function syncCellStateId(recordId: string, field: string): string {
  return shortHash(lines([recordId, field]));
}

/** The hash of the mapping and of the event identifier or scheduled time that started the run. */
export function syncRunId(mappingId: string, startedBy: string): string {
  return shortHash(lines([mappingId, startedBy]));
}

/** `templateKey__entityType__entityId`. The entity identifier may contain the separator. */
export function generatedDocumentId(templateKey: string, entityType: EntityType, entityId: string): string {
  return compose([templateKey, entityType, entityId], 2);
}

// Events, notifications and search.

/** The hash of the notification type and of the event identifier, or of the reminder, that caused it. */
export function notificationId(type: string, causeId: string): string {
  return shortHash(lines([type, causeId]));
}

/**
 * The keyed hash of the recipient, the template and the event identifier or scheduled time, so
 * that an event delivered twice queues one email. The recipient is an address, hence the key.
 */
export function mailId(recipient: string, templateKey: string, occasion: string, secret: string): string {
  return keyedShortHash(lines([normaliseEmail(recipient), templateKey, occasion]), secret);
}

/** `consumer__eventId`: the record of an event that a consumer could not handle. */
export function eventFailureId(consumer: string, eventId: string): string {
  return compose([consumer, eventId], 1);
}

/** `entityType__entityId__part`. The entity identifier may contain the separator. */
export function searchIndexId(entityType: EntityType, entityId: string, part: number): string {
  return compose([entityType, entityId, sequenceId(part)], 1);
}

/**
 * Every builder of a natural key, by name. The collection registry names the builder of each
 * collection whose identifier is derived, and the integrity checker rebuilds identifiers with it.
 */
export const ID_BUILDERS = {
  entityRefId,
  nestedEntityId,
  roleAssignmentId,
  capabilityGrantId,
  recordGrantId,
  labClaimId,
  personEmailIndexId,
  identityKeyId,
  importedPersonId,
  registeredInstitutionId,
  registeredLaboratoryId,
  importedAffiliationId,
  institutionCandidateId,
  studyAliasId,
  studyAliasIndexId,
  hypothesisId,
  replicationMembershipId,
  statusDefinitionId,
  historicalAggregateId,
  vocabularyTermId,
  candidateStudyId,
  predictionMarketItemId,
  participationId,
  acknowledgementId,
  outreachContactId,
  tagId,
  pagePermissionId,
  sequenceId,
  pageContentChunkId,
  contributorTableId,
  contributorId,
  sourceTabKey,
  sourceRecordId,
  importBatchId,
  documentLinkSlotId,
  reconciliationFingerprint,
  integrationMappingId,
  syncMappingId,
  syncCellStateId,
  syncRunId,
  generatedDocumentId,
  notificationId,
  mailId,
  eventFailureId,
  searchIndexId,
} as const;
export type IdBuilderName = keyof typeof ID_BUILDERS;
