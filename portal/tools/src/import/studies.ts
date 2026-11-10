// Resolution of a study identifier (docs/MIGRATION_PLAN.md, section 3.2). Every source resolves
// a study through this one routine: the raw string is kept by the caller, and its lookup fold is
// looked up in the folded alias index. Nothing is matched on similarity of spelling.
//
// The index lists every replication that carries a spelling under any scheme: its identifier, a
// tab title, the display text of a link, a name in another naming scheme. Only two of those
// schemes hold identifiers, so only they resolve a cell of an identifier column:
//
// | Scheme of the alias                                   | Resolves an identifier | Why                                             |
// |-------------------------------------------------------|------------------------|-------------------------------------------------|
// | `programme`, `website`                                | yes                    | The spelling was written as an identifier       |
// | `sourceTab`, `sourceLabel`, `cloudAccount`, `bids`, `eegnet`, `dataRepository` | no | A label or a name of another scheme. A label is resolved through the identifier column of its own row, a tab title through the reviewed table |
//
// A wrong link label therefore never detaches a study from its identifier, and never resolves an
// identifier that the sources leave open.
import { type AliasScheme, COLLECTIONS, studyAliasIndexId } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";

export type StudyResolution =
  | { readonly status: "resolved"; readonly replicationId: string }
  /** The spelling belongs to several replications, as one BIDS name does. */
  | { readonly status: "ambiguous"; readonly replicationIds: readonly string[] }
  | { readonly status: "unresolved" }
  /** The cell names several studies joined by ` + `. Nothing of its row is ever split between them. */
  | {
      readonly status: "combined";
      readonly parts: readonly { readonly raw: string; readonly resolution: StudyResolution }[];
    };

/** The shape of every programme study identifier. Only a spelling of this shape may name a new replication. */
export const STUDY_ID_PATTERN = /^[A-Z][A-Za-z]+\d{4}$/;

/** The schemes whose aliases are spellings of the identifier itself. */
export const IDENTIFIER_SCHEMES: ReadonlySet<AliasScheme> = new Set<AliasScheme>(["programme", "website"]);

export class StudyResolver {
  readonly #db: Firestore;
  readonly #stored = new Map<string, readonly string[]>();
  readonly #declared = new Map<string, Set<string>>();

  constructor(db: Firestore) {
    this.#db = db;
  }

  /**
   * Says that the current plan gives a spelling to a replication, so that later rows of the plan
   * resolve it. A spelling under a scheme that holds no identifiers resolves nothing.
   */
  declare(spelling: string, replicationId: string, scheme: AliasScheme): void {
    const folded = studyAliasIndexId(spelling);
    if (folded === null || !IDENTIFIER_SCHEMES.has(scheme)) return;
    const known = this.#declared.get(folded) ?? new Set<string>();
    known.add(replicationId);
    this.#declared.set(folded, known);
  }

  async #lookup(folded: string): Promise<readonly string[]> {
    let stored = this.#stored.get(folded);
    if (stored === undefined) {
      const snapshot = await this.#db.doc(COLLECTIONS.studyAliasIndex.docPath(folded)).get();
      const listed = (snapshot.get("replicationIds") as string[] | undefined) ?? [];
      // The index says who carries the spelling. The aliases of each say whether it is carried as an identifier.
      const holders: string[] = [];
      for (const replicationId of listed) {
        const aliases = await this.#db
          .collection(COLLECTIONS.replicationAliases.collectionPath(replicationId))
          .where("aliasFolded", "==", folded)
          .get();
        if (aliases.docs.some((alias) => IDENTIFIER_SCHEMES.has(alias.get("scheme") as AliasScheme)))
          holders.push(replicationId);
      }
      stored = holders;
      this.#stored.set(folded, stored);
    }
    return [...new Set([...stored, ...(this.#declared.get(folded) ?? [])])].sort();
  }

  /** Resolves one cell. A cell that contains ` + ` is resolved part by part and stays combined. */
  async resolve(raw: string): Promise<StudyResolution> {
    const text = raw.normalize("NFC").trim();
    if (text.includes(" + ")) {
      const parts = [];
      for (const part of text.split(" + ")) parts.push({ raw: part, resolution: await this.resolve(part) });
      return { status: "combined", parts };
    }
    const folded = studyAliasIndexId(text);
    if (folded === null) return { status: "unresolved" };
    const replicationIds = await this.#lookup(folded);
    const [only] = replicationIds;
    if (only === undefined) return { status: "unresolved" };
    return replicationIds.length === 1
      ? { status: "resolved", replicationId: only }
      : { status: "ambiguous", replicationIds };
  }
}
