// The builder of an import plan. An importer states each intended document and item here, in any
// order and as often as its rows give cause, and the builder joins what belongs to one document.
import { COLLECTIONS } from "@eegml/shared";
import type {
  BlockingCheck,
  DerivedValue,
  DocumentSpec,
  ImportPlan,
  NumericCell,
  PlannedDocument,
  PlannedItem,
} from "./model";
import { distinct, sameValue } from "./values";

/** Raised when an importer contradicts itself, which is a defect of the importer and never of the data. */
export class PlanError extends Error {
  override readonly name = "PlanError";
}

interface Draft {
  readonly collection: DocumentSpec["collection"];
  readonly ids: readonly string[];
  readonly path: string;
  fixed: Record<string, unknown>;
  owned: Record<string, unknown>;
  silent: string[];
  union: Record<string, unknown[]>;
  sourceRecordIds: string[];
  fieldSources: Record<string, string>;
  /** The fields whose supplier the importer has named, as opposed to the first record of a statement. */
  namedSources: Set<string>;
}

function join(
  path: string,
  kind: string,
  into: Record<string, unknown>,
  from: Readonly<Record<string, unknown>>,
): void {
  for (const [field, value] of Object.entries(from)) {
    if (field in into && !sameValue(into[field], value)) {
      throw new PlanError(`The plan states two different values for the ${kind} field ${field} of ${path}.`);
    }
    into[field] = value;
  }
}

export class PlanBuilder {
  readonly #documents = new Map<string, Draft>();
  readonly #items = new Map<string, PlannedItem>();
  readonly #rawOnly = new Map<string, string>();
  readonly #held = new Set<string>();
  readonly #blocking: BlockingCheck[] = [];
  readonly #numericCells: NumericCell[] = [];
  readonly #derivedValues: DerivedValue[] = [];

  /** States a document, or adds to one that an earlier row stated. Returns the path of the document. */
  document(spec: DocumentSpec): string {
    const path = (COLLECTIONS[spec.collection].docPath as (...ids: string[]) => string)(...spec.ids);
    if (spec.sourceRecordIds.length === 0) throw new PlanError(`The plan names no source record behind ${path}.`);
    let draft = this.#documents.get(path);
    if (draft === undefined) {
      draft = {
        collection: spec.collection,
        ids: spec.ids,
        path,
        fixed: {},
        owned: {},
        silent: [],
        union: {},
        sourceRecordIds: [],
        fieldSources: {},
        namedSources: new Set(),
      };
      this.#documents.set(path, draft);
    }
    join(path, "fixed", draft.fixed, spec.fixed ?? {});
    join(path, "owned", draft.owned, spec.owned ?? {});
    for (const [field, members] of Object.entries(spec.union ?? {})) {
      draft.union[field] = distinct([...(draft.union[field] ?? []), ...members]);
    }
    draft.silent = distinct([...draft.silent, ...(spec.silent ?? [])]);
    draft.sourceRecordIds = distinct([...draft.sourceRecordIds, ...spec.sourceRecordIds]);
    const supplier = spec.sourceRecordIds[0] ?? "";
    for (const field of Object.keys(spec.owned ?? {})) {
      // Where several rows state one value, the supplier is chosen by a rule that does not depend on the order
      // in which the rows were read: a supplier that the importer names stands before the first record of a
      // statement, and of two of one standing the smaller identifier is taken.
      const named = spec.fieldSources?.[field];
      const stated = named ?? supplier;
      const known = draft.fieldSources[field];
      const knownIsNamed = draft.namedSources.has(field);
      if (known === undefined || (named !== undefined && !knownIsNamed)) draft.fieldSources[field] = stated;
      else if ((named !== undefined) === knownIsNamed && stated < known) draft.fieldSources[field] = stated;
      if (named !== undefined) draft.namedSources.add(field);
    }
    return path;
  }

  /** States a reconciliation item. An item that is stated twice is raised once. */
  item(item: PlannedItem): void {
    if (!this.#items.has(item.fingerprint)) this.#items.set(item.fingerprint, item);
  }

  /**
   * States an item for a data row whose own record is not written: the row waits in the queue
   * until a reviewer has decided, whatever else the plan derives from its cells.
   */
  hold(recordId: string, item: PlannedItem): void {
    this.#held.add(recordId);
    this.item(item);
  }

  /** Says that a data row is kept as a source record only, and why. */
  rawOnly(recordId: string, reason: string): void {
    this.#rawOnly.set(recordId, reason);
  }

  /** Says that a check of the source has failed and that the batch cannot be applied. */
  block(check: string, message: string, item?: PlannedItem): void {
    this.#blocking.push({ check, message });
    if (item !== undefined) this.item({ ...item, blocking: true });
  }

  /** States what a numeric cell of the source says, for the check that a blank stays absent and a zero stays zero. */
  numericCell(cell: NumericCell): void {
    this.#numericCells.push(cell);
  }

  /** States a value that the source computes from its rows, as recomputed here. */
  derivedValue(value: DerivedValue): void {
    this.#derivedValues.push(value);
  }

  build(): ImportPlan {
    const documents: PlannedDocument[] = [...this.#documents.values()]
      .map(({ namedSources: _named, ...draft }) => ({ ...draft, sourceRecordIds: [...draft.sourceRecordIds].sort() }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const items = [...this.#items.values()].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1));
    return {
      documents,
      items,
      rawOnly: new Map(this.#rawOnly),
      held: new Set(this.#held),
      blocking: [...this.#blocking],
      numericCells: [...this.#numericCells],
      derivedValues: [...this.#derivedValues],
    };
  }
}
