// Resolution of people, institutions and laboratories through identity keys
// (docs/MIGRATION_PLAN.md, sections 3.4 and 3.5).
//
// | Rule                                                                 | Where it holds                         |
// |----------------------------------------------------------------------|----------------------------------------|
// | No person is created from a name alone                               | `resolvePerson` returns `unresolved`   |
// | A person is created only from a website identifier, an email address | The first of them that a row carries   |
// | that is exactly one address, or an ORCID iD with a correct check digit | gives the identifier of the person   |
// | A name with a matching affiliation links to one person, creates none | Only for a row with no identifier      |
// | An identifier that names two people attaches nothing                 | `resolvePerson` returns `ambiguous`    |
// | An erased or merged person is never recreated                        | The tombstone of its key decides       |
// | No importer creates an institution or a laboratory                   | Their resolvers find or return null    |
import {
  COLLECTIONS,
  identityKeyId,
  importedPersonId,
  normaliseEmail,
  organisationKey,
  personEvidenceKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import type { DocumentSpec } from "./model";

export type EvidenceKind = "websitePersonId" | "email" | "orcid" | "nameAffiliation";

/** One identity key that a source row carries, as the normalised key text. */
export interface PersonEvidence {
  readonly kind: EvidenceKind;
  readonly key: string;
}

/** The identifying kinds, in the order in which they give a new person its identifier and are looked up. */
const IDENTIFYING: readonly EvidenceKind[] = ["websitePersonId", "email", "orcid"];

export type PersonResolution =
  | { readonly status: "existing"; readonly personId: string; readonly basis: EvidenceKind }
  /** No key of the row is known yet. The row may create the person with this identifier. */
  | { readonly status: "new"; readonly personId: string; readonly basis: EvidenceKind }
  /** The keys of the row name several people. Nothing is attached, and a reviewer decides. */
  | { readonly status: "ambiguous"; readonly personIds: readonly string[]; readonly basis: EvidenceKind }
  /** A key of the row belongs to a person who was erased. The row creates and restores nothing. */
  | { readonly status: "erased" }
  /** The row carries a name at most. It creates no person and links to none. */
  | { readonly status: "unresolved" };

/** The one address that a cell holds, in canonical form, or null when it holds none or several. */
export function singleEmail(cell: string): string | null {
  const text = normaliseEmail(cell);
  return /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>().]+$/.test(text) ? text : null;
}

/**
 * The bare ORCID iD that a cell holds, in upper case, or null when the cell holds none or the
 * iD fails its ISO 7064 MOD 11-2 check digit. An address on `orcid.org` is accepted as well.
 */
export function validOrcid(cell: string): string | null {
  const match = /^(?:https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])$/.exec(cell.trim());
  if (!match) return null;
  const orcid = (match[1] ?? "").toUpperCase();
  const digits = orcid.replaceAll("-", "");
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - (total % 11)) % 11;
  return (check === 10 ? "X" : String(check)) === digits[15] ? orcid : null;
}

export const personEvidence = {
  websitePeople: (id: string): PersonEvidence => ({
    kind: "websitePersonId",
    key: personEvidenceKey.websitePeople(id),
  }),
  websiteMembers: (id: string): PersonEvidence => ({
    kind: "websitePersonId",
    key: personEvidenceKey.websiteMembers(id),
  }),
  /** Null unless the cell is exactly one address. */
  email: (cell: string): PersonEvidence | null => {
    const email = singleEmail(cell);
    return email === null ? null : { kind: "email", key: personEvidenceKey.email(email) };
  },
  /** Null unless the cell is an ORCID iD with a correct check digit. */
  orcid: (cell: string): PersonEvidence | null => {
    const orcid = validOrcid(cell);
    return orcid === null ? null : { kind: "orcid", key: personEvidenceKey.orcid(orcid) };
  },
  /** Null when nothing is left of the name or of the affiliation after folding. */
  nameAffiliation: (name: string, affiliation: string): PersonEvidence | null => {
    const key = personEvidenceKey.nameAffiliation(name, affiliation);
    return key === null ? null : { kind: "nameAffiliation", key };
  },
} as const;

interface KeyEntry {
  readonly entityIds: readonly string[];
  readonly status: "active" | "merged" | "erased";
  readonly mergedIntoId: string | null;
}

type KeyedEntity = "person" | "institution" | "laboratory";

export class IdentityResolver {
  readonly #db: Firestore;
  readonly #secret: string;
  readonly #stored = new Map<string, KeyEntry | null>();
  readonly #declared = new Map<string, Set<string>>();

  constructor(db: Firestore, secret: string) {
    this.#db = db;
    this.#secret = secret;
  }

  #declare(keyId: string, personId: string): void {
    const declared = this.#declared.get(keyId) ?? new Set<string>();
    declared.add(personId);
    this.#declared.set(keyId, declared);
  }

  /** The identifier of the identity key of a person. */
  keyId(evidence: PersonEvidence): string {
    return identityKeyId("person", evidence.kind, evidence.key, this.#secret);
  }

  async #entry(entityType: KeyedEntity, kind: string, key: string): Promise<KeyEntry | null> {
    const id = identityKeyId(entityType, kind, key, this.#secret);
    let stored = this.#stored.get(id);
    if (stored === undefined) {
      const snapshot = await this.#db.doc(COLLECTIONS.identityKeys.docPath(id)).get();
      stored = snapshot.exists ? (snapshot.data() as KeyEntry) : null;
      this.#stored.set(id, stored);
    }
    const declared = this.#declared.get(id);
    if (declared === undefined) return stored;
    return {
      entityIds: [...new Set([...(stored?.entityIds ?? []), ...declared])],
      status: stored?.status ?? "active",
      mergedIntoId: stored?.mergedIntoId ?? null,
    };
  }

  /** The people that one key names: none, one, or several where the key is ambiguous. */
  async #people(evidence: PersonEvidence): Promise<readonly string[] | "erased"> {
    const entry = await this.#entry("person", evidence.kind, evidence.key);
    if (entry === null) return [];
    if (entry.status === "erased") return "erased";
    return entry.status === "merged" && entry.mergedIntoId !== null ? [entry.mergedIntoId] : entry.entityIds;
  }

  /** Resolves the person of a row from the identity keys the row carries. */
  async resolvePerson(evidence: readonly PersonEvidence[]): Promise<PersonResolution> {
    const identifying = IDENTIFYING.flatMap((kind) => evidence.filter((entry) => entry.kind === kind));
    const found = new Map<string, EvidenceKind>();
    for (const entry of identifying) {
      const people = await this.#people(entry);
      if (people === "erased") return { status: "erased" };
      for (const personId of people) if (!found.has(personId)) found.set(personId, entry.kind);
    }
    const [first, ...others] = [...found];
    if (first !== undefined) {
      return others.length === 0
        ? { status: "existing", personId: first[0], basis: first[1] }
        : { status: "ambiguous", personIds: [...found.keys()].sort(), basis: first[1] };
    }
    const [creating] = identifying;
    if (creating !== undefined) {
      return { status: "new", personId: importedPersonId(creating.key, this.#secret), basis: creating.kind };
    }
    // A name with its affiliation is the fourth basis. It links a row that has no identifier and never creates.
    for (const entry of evidence.filter((candidate) => candidate.kind === "nameAffiliation")) {
      const people = await this.#people(entry);
      if (people === "erased") return { status: "erased" };
      const [only] = people;
      if (only !== undefined) {
        return people.length === 1
          ? { status: "existing", personId: only, basis: "nameAffiliation" }
          : { status: "ambiguous", personIds: [...people].sort(), basis: "nameAffiliation" };
      }
    }
    return { status: "unresolved" };
  }

  /**
   * The identity keys of a person as planned documents, so that a later import finds the person
   * again. The keys are also remembered for the rows that the current plan has still to resolve.
   */
  keyDocuments(personId: string, evidence: readonly PersonEvidence[], sourceRecordId: string): DocumentSpec[] {
    return evidence.map((entry) => {
      const id = this.keyId(entry);
      this.#declare(id, personId);
      return {
        collection: "identityKeys",
        ids: [id],
        fixed: { entityType: "person", keyKind: entry.kind, status: "active", mergedIntoId: null },
        union: { entityIds: [personId] },
        sourceRecordIds: [sourceRecordId],
      };
    });
  }

  /** The identity key that reserves the slug of a person. A slug never names two people. */
  slugDocument(personId: string, slug: string, sourceRecordId: string): DocumentSpec {
    const id = identityKeyId("person", "slug", slug, this.#secret);
    this.#declare(id, personId);
    return {
      collection: "identityKeys",
      ids: [id],
      fixed: { entityType: "person", keyKind: "slug", status: "active", mergedIntoId: null },
      union: { entityIds: [personId] },
      sourceRecordIds: [sourceRecordId],
    };
  }

  /** The people who hold a slug already. */
  async holdersOfSlug(slug: string): Promise<readonly string[]> {
    return (await this.#entry("person", "slug", slug))?.entityIds ?? [];
  }

  /**
   * The institution that a reviewer has confirmed under a name and a country, or null. An
   * importer never creates an institution: an affiliation string becomes an institution candidate.
   */
  async resolveInstitution(name: string, countryCode: string): Promise<string | null> {
    const key = organisationKey.institution(name, countryCode);
    if (key === null) return null;
    const entry = await this.#entry("institution", "nameAffiliation", key);
    return entry !== null && entry.status === "active" && entry.entityIds.length === 1
      ? (entry.entityIds[0] ?? null)
      : null;
  }

  /**
   * The laboratory that exists under a name at an institution, or null. A laboratory is created
   * by a reviewer or through a confirmed laboratory claim, and never by an importer.
   */
  async resolveLaboratory(institutionId: string, name: string): Promise<string | null> {
    const key = organisationKey.laboratory(institutionId, name);
    if (key === null) return null;
    const entry = await this.#entry("laboratory", "nameAffiliation", key);
    return entry !== null && entry.status === "active" && entry.entityIds.length === 1
      ? (entry.entityIds[0] ?? null)
      : null;
  }
}
