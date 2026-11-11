// Synthetic documents only.
import { describe, expect, it } from "vitest";
import { type ChangeState, planBatchRollback } from "./import-rollback";

const ITEMS = "reconciliationItems/";
/** Equality of plain values, as each caller's own comparison gives it for stored values. */
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plan = (states: readonly ChangeState[], current: Record<string, Record<string, unknown> | null>) =>
  planBatchRollback({ states, current: new Map(Object.entries(current)), equal: sameJson, itemsPrefix: ITEMS });

describe("planBatchRollback", () => {
  it("restores updated fields, removes created documents and writes removed ones again", () => {
    const result = plan(
      [
        { path: "persons/a", before: { name: "Old", gone: 1 }, after: { name: "New", added: true } },
        { path: "persons/b", before: null, after: { name: "Created" } },
        { path: "persons/c", before: { name: "Removed" }, after: null },
      ],
      { "persons/a": { name: "New", added: true }, "persons/b": { name: "Created" }, "persons/c": null },
    );
    expect(result).toEqual({
      status: "ready",
      steps: [
        { kind: "restore", path: "persons/a", set: { name: "Old", gone: 1 }, remove: ["added"] },
        { kind: "remove", path: "persons/b" },
        { kind: "recreate", path: "persons/c", data: { name: "Removed" } },
      ],
      counts: { restored: 2, removed: 1, itemsWithdrawn: 0, itemsLeft: 0 },
    });
  });

  it("has nothing to give back to a document that the batch matched and left as it was", () => {
    const result = plan([{ path: "persons/a", before: { name: "Same" }, after: { name: "Same" } }], {
      "persons/a": { name: "Same" },
    });
    expect(result.status === "ready" && result.steps).toEqual([{ kind: "skip", path: "persons/a" }]);
  });

  it("refuses as a whole when a document has changed since the batch wrote it", () => {
    expect(
      plan(
        [
          { path: "persons/a", before: null, after: { name: "Created" } },
          { path: "persons/b", before: { name: "Old" }, after: { name: "New" } },
        ],
        { "persons/a": { name: "Created" }, "persons/b": { name: "Edited in the portal" } },
      ),
    ).toEqual({ status: "refused", changedDocuments: ["persons/b"] });
  });

  it("withdraws an item the batch raised and leaves one that a reviewer decided", () => {
    const result = plan(
      [
        { path: `${ITEMS}one`, before: null, after: { status: "open" } },
        { path: `${ITEMS}two`, before: null, after: { status: "open" } },
      ],
      { [`${ITEMS}one`]: { status: "open" }, [`${ITEMS}two`]: { status: "resolved" } },
    );
    expect(result.status === "ready" && result.steps).toEqual([
      { kind: "withdraw", path: `${ITEMS}one` },
      { kind: "keep", path: `${ITEMS}two` },
    ]);
  });

  it("skips what an earlier attempt reversed, so a rollback that stopped is carried on", () => {
    const result = plan(
      [
        { path: "persons/a", before: { name: "Old" }, after: { name: "New" } },
        { path: `${ITEMS}one`, before: null, after: { status: "open" } },
      ],
      { "persons/a": { name: "Old" }, [`${ITEMS}one`]: { status: "withdrawn" } },
    );
    expect(result.status === "ready" && result.steps.map((step) => step.kind)).toEqual(["skip", "skip"]);
  });
});
