// Red-team attacks on the Quire importer (docs/INTEGRATIONS.md, section 4; docs/DATA_MODEL.md,
// section 8), made with a crafted dump in the documented layout. Whoever can edit the Quire
// workspace, or the pulled file, decides what the importer writes into the programme's task
// lists, which every member reads. The functions keep the tree of tasks and the dependencies free
// of cycles, so the importer, which writes with the Admin SDK past them, must keep them so too:
//
// - a task that names itself as its parent;
// - two tasks that name each other as their parents;
// - two tasks that each name the other among their predecessors.
//
// The test runs in the functions suite so that the triggers see the imported tasks as they would
// in production. It states the secure behaviour: either the import refuses the dump, or what it
// writes holds no cycle of parents or dependencies and keeps `ancestorIds` true to `parentId`.
// Fixtures are synthetic: every name and identifier in the dump is invented.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { dependencyCycles, taskDocSchema } from "@eegml/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedLookups } from "../../../tools/src/commands/seed-lookups";
import { quireDump } from "../../../tools/src/import/fixtures/quire";
import { importer as quire } from "../../../tools/src/import/sources/quire";
import { adminDb } from "../../support/admin";
import { PROJECT_ID } from "../../support/emulators";
import { removeTemporaryDirectories, run, temporaryDirectory } from "../../tools/import-support";
import { leaveNoTrace, resetWorld } from "../support";

beforeEach(async () => {
  await resetWorld();
  await seedLookups(adminDb, PROJECT_ID);
});

afterAll(async () => {
  removeTemporaryDirectories();
  await leaveNoTrace();
});

const SELF = "TskPoisonSelfParent00001";
const LOOP_A = "TskPoisonParentLoopA0002";
const LOOP_B = "TskPoisonParentLoopB0003";
const DEPENDS_A = "TskPoisonDependsA0000004";
const DEPENDS_B = "TskPoisonDependsB0000005";

const crafted = (oid: string, id: number, fields: Record<string, unknown>) => ({
  oid,
  id,
  name: `Synthetic poisoned task ${id}`,
  nameText: `Synthetic poisoned task ${id}`,
  parent: null,
  ...fields,
});

function poisonedDump(): string {
  const dump = quireDump();
  const projects = dump.projects as { tasks: unknown[]; project: Record<string, unknown> }[];
  const first = projects[0];
  if (first === undefined) throw new Error("The synthetic dump has no project.");
  first.tasks.push(
    crafted(SELF, 901, { parent: { oid: SELF, id: 901 } }),
    crafted(LOOP_A, 902, { parent: { oid: LOOP_B, id: 903 } }),
    crafted(LOOP_B, 903, { parent: { oid: LOOP_A, id: 902 } }),
    crafted(DEPENDS_A, 904, { predecessorRefs: [{ id: 905, oid: DEPENDS_B }] }),
    crafted(DEPENDS_B, 905, { predecessorRefs: [{ id: 904, oid: DEPENDS_A }] }),
  );
  first.project.taskCount = first.tasks.length;
  const file = path.join(temporaryDirectory(), "quire-dump.json");
  writeFileSync(file, JSON.stringify(dump));
  return file;
}

describe("a crafted Quire dump", () => {
  it("never brings a cycle of parents or of dependencies into the task lists", async () => {
    await run(quire, poisonedDump(), "apply");

    const found = await adminDb.collection("tasks").get();
    const tasks = new Map(found.docs.map((document) => [document.id, taskDocSchema.parse(document.data())]));
    const problems: string[] = [];
    for (const [id, task] of tasks) {
      if (task.parentId === id) problems.push(`${id} is its own parent`);
      // The ancestors that the parents name, walked from the parent up, must be the stored ones.
      const chain: string[] = [];
      let parent = task.parentId;
      while (parent !== null && !chain.includes(parent) && parent !== id) {
        chain.unshift(parent);
        parent = tasks.get(parent)?.parentId ?? null;
      }
      if (parent !== null) problems.push(`${id} sits in a cycle of parents`);
      if (JSON.stringify(chain) !== JSON.stringify(task.ancestorIds)) {
        problems.push(`${id} has ancestors that its parents do not name`);
      }
    }
    for (const cycle of dependencyCycles([...tasks].map(([id, task]) => ({ id, dependsOn: task.dependsOn })))) {
      problems.push(`${cycle.join(" and ")} depend on each other`);
    }
    expect(problems).toEqual([]);
  });
});
