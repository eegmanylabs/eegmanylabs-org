// What rolling back an import batch does to each document (docs/MIGRATION_PLAN.md, section 6).
// Pure: the command `import rollback` of the tools and the callable function
// `rollbackImportBatch` both read the change log and the current documents, ask this planner
// what to do, and carry the steps out with their own writes.
//
// The entries of the batch are taken in reverse order. A document that still is what the batch
// wrote gets its earlier state back, is removed if the batch created it, or is written again if
// the batch removed it. If any document has changed since, the plan refuses as a whole and lists
// those documents, so that a person decides and nothing edited in the portal is lost. An open
// reconciliation item that the batch raised is withdrawn, and an item that a reviewer has decided
// since is left as it is. A document already in its earlier state counts as reversed, so a
// rollback that stopped part-way is carried on by planning it again.

/** One entry of the change log: the document and its imported fields before and after the batch. */
export interface ChangeState {
  readonly path: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

/**
 * | Step          | What the executor writes                                                     |
 * |---------------|------------------------------------------------------------------------------|
 * | `restore`     | Sets the fields in `set` and deletes those in `remove`, where the document still is as the batch left it |
 * | `recreate`    | Writes the document again as `data`: the batch removed it                    |
 * | `remove`      | Deletes the document: the batch created it                                   |
 * | `restoreItem` | Writes the earlier state of a reconciliation item over it                    |
 * | `withdraw`    | Closes a reconciliation item that the batch raised as withdrawn              |
 * | `keep`        | Nothing: a reviewer has decided the item since, and the decision stands      |
 * | `skip`        | Nothing: an earlier attempt has reversed the document already, or the batch matched it and changed nothing |
 */
export type RollbackStep =
  | {
      readonly kind: "restore";
      readonly path: string;
      readonly set: Readonly<Record<string, unknown>>;
      readonly remove: readonly string[];
    }
  | { readonly kind: "recreate"; readonly path: string; readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: "remove"; readonly path: string }
  | { readonly kind: "restoreItem"; readonly path: string; readonly data: Readonly<Record<string, unknown>> }
  | { readonly kind: "withdraw"; readonly path: string }
  | { readonly kind: "keep"; readonly path: string }
  | { readonly kind: "skip"; readonly path: string };

export interface RollbackCounts {
  readonly restored: number;
  readonly removed: number;
  readonly itemsWithdrawn: number;
  readonly itemsLeft: number;
}

export type RollbackPlan =
  | { readonly status: "refused"; readonly changedDocuments: readonly string[] }
  | { readonly status: "ready"; readonly steps: readonly RollbackStep[]; readonly counts: RollbackCounts };

export interface RollbackPlanInput {
  /** The entries of the change log, latest first. */
  readonly states: readonly ChangeState[];
  /** The stored data of every document the log names, or null where it does not exist. */
  readonly current: ReadonlyMap<string, Readonly<Record<string, unknown>> | null>;
  /** Whether two stored values are equal. Each caller gives the comparison that fits its SDK's values. */
  readonly equal: (a: unknown, b: unknown) => boolean;
  /** The path prefix of the reconciliation items, which are withdrawn instead of restored. */
  readonly itemsPrefix: string;
}

export function planBatchRollback({ states, current, equal, itemsPrefix }: RollbackPlanInput): RollbackPlan {
  const isItem = (path: string) => path.startsWith(itemsPrefix);
  const stored = (path: string) => current.get(path) ?? null;
  const holds = (state: ChangeState, wanted: Readonly<Record<string, unknown>> | null) =>
    equal(stored(state.path), wanted);
  const unchangedSince = (state: ChangeState) => holds(state, state.after);
  const reversed = (state: ChangeState) =>
    !unchangedSince(state) &&
    (holds(state, state.before) ||
      (isItem(state.path) && state.before === null && stored(state.path)?.status === "withdrawn"));

  const changedDocuments = states
    .filter((state) => !isItem(state.path) && !unchangedSince(state) && !reversed(state))
    .map((state) => state.path);
  if (changedDocuments.length > 0) return { status: "refused", changedDocuments: [...changedDocuments].sort() };

  const steps: RollbackStep[] = [];
  for (const state of states) {
    const { path } = state;
    if (reversed(state)) {
      steps.push({ kind: "skip", path });
    } else if (isItem(path)) {
      if (stored(path) === null) steps.push({ kind: "skip", path });
      else if (!unchangedSince(state)) steps.push({ kind: "keep", path });
      else if (state.before === null) steps.push({ kind: "withdraw", path });
      else steps.push({ kind: "restoreItem", path, data: state.before });
    } else if (state.before === null) {
      steps.push({ kind: "remove", path });
    } else if (state.after === null) {
      steps.push({ kind: "recreate", path, data: state.before });
    } else {
      const { before, after } = state;
      const set: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(before)) {
        if (!equal(after[field], value)) set[field] = value;
      }
      const remove = Object.keys(after).filter((field) => !(field in before));
      // A change that matched the document and wrote nothing has nothing to give back.
      if (Object.keys(set).length === 0 && remove.length === 0) steps.push({ kind: "skip", path });
      else steps.push({ kind: "restore", path, set, remove });
    }
  }
  const count = (...kinds: RollbackStep["kind"][]) => steps.filter((step) => kinds.includes(step.kind)).length;
  return {
    status: "ready",
    steps,
    counts: {
      restored: count("restore", "recreate", "restoreItem"),
      removed: count("remove"),
      itemsWithdrawn: count("withdraw"),
      itemsLeft: count("keep"),
    },
  };
}
