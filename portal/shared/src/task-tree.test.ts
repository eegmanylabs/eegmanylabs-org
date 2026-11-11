import { describe, expect, it } from "vitest";
import { orderBetween } from "./order";
import {
  ancestorIdsBeneath,
  breakDependencyCycles,
  dependencyCycles,
  descendantIds,
  moveRefusal,
  orderAt,
  resolveParents,
  subtreeHeight,
  TASK_MAX_ANCESTORS,
  taskTree,
  wouldCreateCycle,
} from "./task-tree";

const node = (id: string, parentId: string | null, order: string) => ({ id, parentId, order });

describe("taskTree", () => {
  const tasks = [
    node("c", "a", "5"),
    node("a", null, "5"),
    node("b", null, "8"),
    node("d", "a", "2"),
    node("e", "d", "5"),
    node("orphan", "gone", "1"),
  ];

  it("draws each task after its parent, siblings by order, and a task whose parent is absent at the top", () => {
    expect(taskTree(tasks).map((row) => [row.task.id, row.depth, row.childCount])).toEqual([
      ["orphan", 0, 0],
      ["a", 0, 2],
      ["d", 1, 1],
      ["e", 2, 0],
      ["c", 1, 0],
      ["b", 0, 0],
    ]);
  });

  it("leaves out the tasks beneath a collapsed task", () => {
    expect(taskTree(tasks, new Set(["a"])).map((row) => row.task.id)).toEqual(["orphan", "a", "b"]);
  });

  it("orders siblings with the same key by identifier, and cuts a cycle of parents", () => {
    expect(taskTree([node("y", null, "5"), node("x", null, "5")]).map((row) => row.task.id)).toEqual(["x", "y"]);
    expect(taskTree([node("p", "q", "1"), node("q", "p", "1")])).toEqual([]);
  });
});

describe("moving a task", () => {
  const tasks = [
    { id: "a", ancestorIds: [] },
    { id: "b", ancestorIds: ["a"] },
    { id: "c", ancestorIds: ["a", "b"] },
    { id: "d", ancestorIds: [] },
  ];

  it("finds the tasks beneath a task and the ancestors of a new place", () => {
    expect(descendantIds(tasks, "a")).toEqual(["b", "c"]);
    expect(ancestorIdsBeneath({ id: "c", ancestorIds: ["a", "b"] })).toEqual(["a", "b", "c"]);
    expect(ancestorIdsBeneath(null)).toEqual([]);
    expect(subtreeHeight("a", 0, tasks)).toBe(2);
    expect(subtreeHeight("d", 0, tasks)).toBe(0);
  });

  it("refuses a move beneath the task itself or one of its descendants", () => {
    expect(moveRefusal("a", { id: "a", ancestorIds: [] }, 2)).toBe("beneathItself");
    expect(moveRefusal("a", { id: "c", ancestorIds: ["a", "b"] }, 2)).toBe("beneathItself");
    expect(moveRefusal("b", { id: "d", ancestorIds: [] }, 1)).toBeNull();
    expect(moveRefusal("c", null, 0)).toBeNull();
  });

  it("refuses a move that would nest a task beyond the cap of its ancestors", () => {
    const deep = { id: "deep", ancestorIds: Array.from({ length: TASK_MAX_ANCESTORS - 1 }, (_, index) => `t${index}`) };
    expect(moveRefusal("x", deep, 0)).toBeNull();
    expect(moveRefusal("x", deep, 1)).toBe("tooDeep");
  });
});

describe("orderAt", () => {
  it("places an item between its neighbours, at the start and at the end", () => {
    const orders = ["2", "5", "8"];
    for (let index = 0; index <= orders.length; index += 1) {
      const key = orderAt(orders, index) as string;
      const placed = [...orders.slice(0, index), key, ...orders.slice(index)];
      expect([...placed].sort()).toEqual(placed);
    }
    expect(orderAt([], 0)).toBe(orderBetween(null, null));
    expect(orderAt(["5"], 99)).toBe(orderBetween("5", null));
  });

  it("asks for the siblings to be numbered again where two neighbours share a key", () => {
    expect(orderAt(["5", "5"], 1)).toBeNull();
  });

  it("keeps placing between two keys a hundred times without failing", () => {
    let low = "1";
    const high = "2";
    for (let step = 0; step < 100; step += 1) {
      const key = orderAt([low, high], 1) as string;
      expect(key > low && key < high).toBe(true);
      low = key;
    }
  });
});

describe("dependencies", () => {
  const tasks = [
    { id: "a", dependsOn: { b: "finishToStart" } },
    { id: "b", dependsOn: { c: "startToStart" } },
    { id: "c", dependsOn: {} },
    { id: "d", dependsOn: { a: "blocks" } },
  ];

  it("refuses a dependency that closes a cycle, directly, through others or on the task itself", () => {
    expect(wouldCreateCycle(tasks, "c", "a")).toBe(true);
    expect(wouldCreateCycle(tasks, "b", "a")).toBe(true);
    expect(wouldCreateCycle(tasks, "a", "a")).toBe(true);
    expect(wouldCreateCycle(tasks, "c", "d")).toBe(true);
    expect(wouldCreateCycle(tasks, "d", "c")).toBe(false);
    expect(wouldCreateCycle(tasks, "a", "unknown")).toBe(false);
  });

  it("finds every cycle once, from its smallest identifier, and none where there is none", () => {
    expect(dependencyCycles(tasks)).toEqual([]);
    const cyclic = [
      { id: "x", dependsOn: { y: "finishToStart" } },
      { id: "y", dependsOn: { z: "finishToStart" } },
      { id: "z", dependsOn: { x: "finishToStart" } },
      { id: "self", dependsOn: { self: "blocks" } },
      { id: "p", dependsOn: { gone: "blocks" } },
    ];
    expect(dependencyCycles(cyclic)).toEqual([["self"], ["x", "y", "z"]]);
  });
});

describe("breaking cycles of dependencies", () => {
  it("leaves out the dependency on the smallest task of each cycle and keeps the rest", () => {
    const { dependsOn, dropped } = breakDependencyCycles([
      { id: "x", dependsOn: { y: "finishToStart" } },
      { id: "y", dependsOn: { z: "finishToStart" } },
      { id: "z", dependsOn: { x: "finishToStart", w: "blocks" } },
      { id: "w", dependsOn: {} },
      { id: "self", dependsOn: { self: "blocks" } },
    ]);
    expect(dropped).toEqual([
      { from: "self", to: "self" },
      { from: "z", to: "x" },
    ]);
    expect(dependsOn.get("z")).toEqual({ w: "blocks" });
    expect(dependsOn.get("x")).toEqual({ y: "finishToStart" });
    expect(dependencyCycles([...dependsOn].map(([id, targets]) => ({ id, dependsOn: targets })))).toEqual([]);
  });

  it("changes nothing where there is no cycle", () => {
    const tasks = [
      { id: "a", dependsOn: { b: "finishToStart" } },
      { id: "b", dependsOn: {} },
    ];
    expect(breakDependencyCycles(tasks).dropped).toEqual([]);
  });
});

describe("resolving parents written past the functions", () => {
  it("keeps a sound tree as it is, with ancestors that follow the parents", () => {
    const resolved = resolveParents([
      { id: "c", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
      { id: "orphan", parentId: "elsewhere" },
    ]);
    expect(resolved.get("c")).toEqual({ parentId: "b", ancestorIds: ["a", "b"], defect: null });
    expect(resolved.get("orphan")).toEqual({ parentId: null, ancestorIds: [], defect: null });
  });

  it("puts a task that is its own parent, or sits in a cycle of parents, at the top", () => {
    const resolved = resolveParents([
      { id: "self", parentId: "self" },
      { id: "loopA", parentId: "loopB" },
      { id: "loopB", parentId: "loopA" },
      { id: "child", parentId: "loopA" },
    ]);
    expect(resolved.get("self")).toEqual({ parentId: null, ancestorIds: [], defect: "ownParent" });
    expect(resolved.get("loopA")).toEqual({ parentId: null, ancestorIds: [], defect: "parentCycle" });
    expect(resolved.get("loopB")).toEqual({ parentId: null, ancestorIds: [], defect: "parentCycle" });
    expect(resolved.get("child")).toEqual({ parentId: "loopA", ancestorIds: ["loopA"], defect: null });
  });

  it("cuts a chain deeper than the cap of ancestors", () => {
    const chain = Array.from({ length: TASK_MAX_ANCESTORS + 3 }, (_, index) => ({
      id: `t${String(index).padStart(2, "0")}`,
      parentId: index === 0 ? null : `t${String(index - 1).padStart(2, "0")}`,
    }));
    const resolved = resolveParents(chain);
    for (const [id, entry] of resolved) {
      expect(entry.ancestorIds.length, id).toBeLessThanOrEqual(TASK_MAX_ANCESTORS);
      const parent = entry.parentId === null ? null : resolved.get(entry.parentId);
      expect(entry.ancestorIds, id).toEqual(parent == null ? [] : [...parent.ancestorIds, entry.parentId]);
    }
    expect(resolved.get(`t${TASK_MAX_ANCESTORS + 1}`)?.defect).toBe("tooDeep");
  });
});
