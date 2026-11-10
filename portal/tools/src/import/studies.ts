// Resolution of a study identifier (docs/MIGRATION_PLAN.md, section 3.2). Every source resolves
// a study through this one routine: the raw string is kept by the caller, and its lookup fold is
// looked up in the folded alias index. An entry that lists exactly one replication resolves the
// study. Nothing is matched on similarity of spelling.
import { COLLECTIONS, studyAliasIndexId } from "@eegml/shared";
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

/** The shape of every programme study identifier. */
export const STUDY_ID_PATTERN = /^[A-Z][A-Za-z]+\d{4}$/;

export class StudyResolver {
  readonly #db: Firestore;
  readonly #stored = new Map<string, readonly string[]>();
  readonly #declared = new Map<string, Set<string>>();

  constructor(db: Firestore) {
    this.#db = db;
  }

  /** Says that the current plan gives a spelling to a replication, so that later rows of the plan resolve it. */
  declare(spelling: string, replicationId: string): void {
    const folded = studyAliasIndexId(spelling);
    if (folded === null) return;
    const known = this.#declared.get(folded) ?? new Set<string>();
    known.add(replicationId);
    this.#declared.set(folded, known);
  }

  async #lookup(folded: string): Promise<readonly string[]> {
    let stored = this.#stored.get(folded);
    if (stored === undefined) {
      const snapshot = await this.#db.doc(COLLECTIONS.studyAliasIndex.docPath(folded)).get();
      stored = (snapshot.get("replicationIds") as string[] | undefined) ?? [];
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
