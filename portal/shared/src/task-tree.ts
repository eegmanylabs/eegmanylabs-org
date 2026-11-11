// The structure of tasks (docs/DATA_MODEL.md, section 8): nesting by `parentId` with
// `ancestorIds` beside it, placement by fractional `order`, and dependencies in `dependsOn`.
// The browser draws trees, boards and timelines with these functions, the callable functions
// check moves and dependencies with them, and the integrity checker finds cycles with them.
import { orderBetween } from "./order";

/** The most ancestors a task may have, which is the cap of `ancestorIds`. */
export const TASK_MAX_ANCESTORS = 20;

/** The most tasks one move rewrites: the task and every task beneath it. */
export const TASK_SUBTREE_MAX = 400;

export interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly order: string;
}

export interface TreeRow<T extends TreeNode> {
  readonly task: T;
  /** 0 for a task at the top of the tree. */
  readonly depth: number;
  /** The number of tasks directly beneath it among those given. */
  readonly childCount: number;
}

const byOrder = (a: TreeNode, b: TreeNode) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Tasks as a tree, in the order a list draws them: each task followed by the tasks beneath it,
 * siblings by `order`. A task whose parent is not among those given stands at the top, so a
 * filtered set still shows every task once. `collapsed` names tasks whose subtasks are left out.
 */
export function taskTree<T extends TreeNode>(
  tasks: readonly T[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow<T>[] {
  const ids = new Set(tasks.map((task) => task.id));
  const children = new Map<string | null, T[]>();
  for (const task of tasks) {
    const parent = task.parentId !== null && ids.has(task.parentId) ? task.parentId : null;
    const siblings = children.get(parent) ?? [];
    siblings.push(task);
    children.set(parent, siblings);
  }
  for (const siblings of children.values()) siblings.sort(byOrder);
  const rows: TreeRow<T>[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const task of children.get(parent) ?? []) {
      // A cycle of parents, which only corrupt data can hold, is cut where it closes.
      if (visited.has(task.id)) continue;
      visited.add(task.id);
      rows.push({ task, depth, childCount: children.get(task.id)?.length ?? 0 });
      if (!collapsed.has(task.id)) walk(task.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** The identifiers of the tasks beneath a task, at any depth, from the `ancestorIds` of each. */
export function descendantIds(
  tasks: readonly { readonly id: string; readonly ancestorIds: readonly string[] }[],
  id: string,
): string[] {
  return tasks.filter((task) => task.ancestorIds.includes(id)).map((task) => task.id);
}

/** The `ancestorIds` of a task placed beneath a parent, or at the top where the parent is null. */
export function ancestorIdsBeneath(
  parent: { readonly id: string; readonly ancestorIds: readonly string[] } | null,
): string[] {
  return parent === null ? [] : [...parent.ancestorIds, parent.id];
}

/**
 * Whether a task may be moved beneath a parent: never beneath itself or one of its own
 * descendants, which would cut the subtree off from the tree, and never deeper than the cap of
 * `ancestorIds` allows for the deepest task beneath it.
 */
export function moveRefusal(
  taskId: string,
  parent: { readonly id: string; readonly ancestorIds: readonly string[] } | null,
  subtreeHeight: number,
): "beneathItself" | "tooDeep" | null {
  if (parent === null) return subtreeHeight > TASK_MAX_ANCESTORS ? "tooDeep" : null;
  if (parent.id === taskId || parent.ancestorIds.includes(taskId)) return "beneathItself";
  return parent.ancestorIds.length + 1 + subtreeHeight > TASK_MAX_ANCESTORS ? "tooDeep" : null;
}

/** How many levels lie beneath a task: 0 for a task without subtasks. */
export function subtreeHeight(
  taskId: string,
  ancestorCount: number,
  descendants: readonly { readonly ancestorIds: readonly string[] }[],
): number {
  let deepest = ancestorCount;
  for (const task of descendants)
    if (task.ancestorIds.includes(taskId)) deepest = Math.max(deepest, task.ancestorIds.length);
  return deepest - ancestorCount;
}

/**
 * The order key that places an item at `index` among siblings whose keys are given in order,
 * where the item itself is not among them. Null when two neighbours share a key and nothing
 * fits between them, so that the siblings must be numbered again.
 */
export function orderAt(siblingOrders: readonly string[], index: number): string | null {
  const position = Math.max(0, Math.min(index, siblingOrders.length));
  const before = position === 0 ? null : (siblingOrders[position - 1] ?? null);
  const after = siblingOrders[position] ?? null;
  if (before !== null && after !== null && before >= after) return null;
  return orderBetween(before, after);
}

// ===== Dependencies =====

export interface DependencyNode {
  readonly id: string;
  /** The tasks this one depends on, keyed by identifier. */
  readonly dependsOn: Readonly<Record<string, string>>;
}

/** Whether `taskId` depends on `targetId`, directly or through other tasks. */
function reaches(byId: ReadonlyMap<string, DependencyNode>, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of Object.keys(byId.get(current)?.dependsOn ?? {})) stack.push(next);
  }
  return false;
}

/**
 * Whether making `taskId` depend on `targetId` would close a cycle: the target depends on the
 * task already, directly or through others, or is the task itself.
 */
export function wouldCreateCycle(tasks: readonly DependencyNode[], taskId: string, targetId: string): boolean {
  if (taskId === targetId) return true;
  return reaches(new Map(tasks.map((task) => [task.id, task])), targetId, taskId);
}

/**
 * The cycles of dependencies among tasks, each once, as the identifiers along it starting from
 * the smallest. Only corrupt or imported data holds one, since the interface and the callable
 * functions refuse to close a cycle, and the integrity checker reports each.
 */
export function dependencyCycles(tasks: readonly DependencyNode[]): string[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const found = new Map<string, string[]>();
  const visit = (id: string) => {
    state.set(id, "open");
    path.push(id);
    for (const next of Object.keys(byId.get(id)?.dependsOn ?? {}).sort()) {
      if (!byId.has(next)) continue;
      if (state.get(next) === "open") {
        const cycle = path.slice(path.indexOf(next));
        const start = cycle.indexOf([...cycle].sort()[0] as string);
        const normalised = [...cycle.slice(start), ...cycle.slice(0, start)];
        found.set(normalised.join("\n"), normalised);
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    path.pop();
    state.set(id, "done");
  };
  for (const id of [...byId.keys()].sort()) if (!state.has(id)) visit(id);
  return [...found.values()];
}

/** Breaks the cycles of a set of dependencies by leaving out, in each, the dependency on its smallest task. */
export function breakDependencyCycles(tasks: readonly DependencyNode[]): {
  readonly dependsOn: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly dropped: readonly { readonly from: string; readonly to: string }[];
} {
  const dependsOn = new Map(tasks.map((task) => [task.id, { ...task.dependsOn }]));
  const dropped: { from: string; to: string }[] = [];
  // Each round leaves out at least one dependency, so the rounds end.
  for (;;) {
    const cycles = dependencyCycles([...dependsOn].map(([id, targets]) => ({ id, dependsOn: targets })));
    if (cycles.length === 0) break;
    for (const cycle of cycles) {
      // Along a cycle each task depends on the next, and the last on the first.
      const first = cycle[0] as string;
      const last = cycle[cycle.length - 1] as string;
      const targets = dependsOn.get(last);
      if (targets !== undefined && first in targets) {
        delete targets[first];
        dropped.push({ from: last, to: first });
      }
    }
  }
  return { dependsOn, dropped };
}

// ===== Trees written past the functions =====

/**
 * | Defect        | Meaning                                                       |
 * |---------------|---------------------------------------------------------------|
 * | `ownParent`   | The task names itself as its parent                           |
 * | `parentCycle` | The task sits in a cycle of parents                           |
 * | `tooDeep`     | The task lies deeper than `TASK_MAX_ANCESTORS` allows         |
 */
export type ParentDefect = "ownParent" | "parentCycle" | "tooDeep";

export interface ResolvedParent {
  readonly parentId: string | null;
  readonly ancestorIds: readonly string[];
  readonly defect: ParentDefect | null;
}

/**
 * The parents and ancestors of tasks that are written past the callable functions, as an import
 * or a copy writes them, so that they always form a tree. A parent that is not among the tasks
 * given is no parent. A task that is its own parent, sits in a cycle of parents or lies too deep
 * stands at the top instead, and says why. `ancestorIds` always follows the parent written.
 */
export function resolveParents(
  tasks: readonly { readonly id: string; readonly parentId: string | null }[],
): ReadonlyMap<string, ResolvedParent> {
  const ids = new Set(tasks.map((task) => task.id));
  const parentOf = new Map(
    tasks.map((task) => [task.id, task.parentId !== null && ids.has(task.parentId) ? task.parentId : null]),
  );
  const defects = new Map<string, ParentDefect>();
  for (const [id, parent] of parentOf) {
    if (parent === id) {
      defects.set(id, "ownParent");
      parentOf.set(id, null);
    }
  }
  const state = new Map<string, "open" | "done">();
  for (const start of [...ids].sort()) {
    const path: string[] = [];
    let current: string | null = start;
    while (current !== null && !state.has(current)) {
      state.set(current, "open");
      path.push(current);
      current = parentOf.get(current) ?? null;
    }
    if (current !== null && state.get(current) === "open") {
      for (const member of path.slice(path.indexOf(current))) {
        defects.set(member, "parentCycle");
        parentOf.set(member, null);
      }
    }
    for (const member of path) state.set(member, "done");
  }
  const resolved = new Map<string, ResolvedParent>();
  for (const start of ids) {
    // The chain up to the first task resolved already or to the top, resolved from the top down.
    const chain: string[] = [];
    let current: string | null = start;
    while (current !== null && !resolved.has(current)) {
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    for (const id of chain.reverse()) {
      const parent = parentOf.get(id) ?? null;
      const above = parent === null ? undefined : resolved.get(parent);
      const ancestorIds = above === undefined || parent === null ? [] : [...above.ancestorIds, parent];
      if (ancestorIds.length > TASK_MAX_ANCESTORS) {
        resolved.set(id, { parentId: null, ancestorIds: [], defect: "tooDeep" });
      } else {
        resolved.set(id, {
          parentId: above === undefined ? null : parent,
          ancestorIds,
          defect: defects.get(id) ?? null,
        });
      }
    }
  }
  return resolved;
}
