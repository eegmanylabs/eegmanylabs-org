// Synthetic documents only: invented identifiers, no person's details.
import { describe, expect, it } from "vitest";
import { tagId } from "./ids";
import {
  type CheckedDocument,
  checkIntegrity,
  countFindings,
  type IntegrityCollection,
  type IntegrityFinding,
} from "./integrity";

const doc = (path: string, data: Record<string, unknown>): CheckedDocument => ({
  path,
  data: { archivedAt: null, ...data },
});

/** A small world in which every reference resolves and every derived value agrees. */
function world(): Map<IntegrityCollection, CheckedDocument[]> {
  return new Map<IntegrityCollection, CheckedDocument[]>([
    ["users", [doc("users/uid-1", { personId: "p-1" })]],
    [
      "persons",
      [
        doc("persons/p-1", { userId: "uid-1", laboratoryIds: ["lab-1"], replicationIds: ["Rep2001"] }),
        doc("persons/p-2", { userId: null, laboratoryIds: [], replicationIds: [] }),
      ],
    ],
    ["institutions", [doc("institutions/inst-1", {})]],
    ["laboratories", [doc("laboratories/lab-1", { institutionId: "inst-1", piPersonId: "p-1" })]],
    [
      "laboratoryMembers",
      [doc("laboratories/lab-1/members/p-1", { laboratoryId: "lab-1", personId: "p-1", status: "confirmed" })],
    ],
    [
      "laboratoryEquipment",
      [
        doc("laboratories/lab-1/equipment/cfg-1", { laboratoryId: "lab-1", isCurrent: false, supersedesId: null }),
        doc("laboratories/lab-1/equipment/cfg-2", { laboratoryId: "lab-1", isCurrent: true, supersedesId: "cfg-1" }),
      ],
    ],
    [
      "replications",
      [
        doc("replications/Rep2001", {
          studyKey: "Rep2001",
          leadPersonIds: ["p-1"],
          statusKey: null,
          statusHistoryId: null,
        }),
      ],
    ],
    [
      "replicationMemberships",
      [
        doc("replications/Rep2001/memberships/p-1__lead", {
          replicationId: "Rep2001",
          personId: "p-1",
          role: "lead",
          isCurrent: true,
          reviewStatus: "confirmed",
        }),
      ],
    ],
    [
      "participations",
      [
        doc("participations/Rep2001__lab-1", {
          replicationId: "Rep2001",
          laboratoryId: "lab-1",
          status: "invited",
          statusHistoryId: "hist-1",
          equipmentConfigurationId: "cfg-2",
          localLeadPersonId: "p-1",
        }),
      ],
    ],
    [
      "participationChecklist",
      [
        doc("participations/Rep2001__lab-1/checklist/ethics", {
          participationId: "Rep2001__lab-1",
          templateItemKey: "ethics",
          replicationId: "Rep2001",
          laboratoryId: "lab-1",
        }),
      ],
    ],
    [
      "statusHistory",
      [
        doc("statusHistory/hist-1", {
          entityType: "participation",
          entityId: "Rep2001__lab-1",
          toStatusKey: "invited",
          replicationId: "Rep2001",
          laboratoryId: "lab-1",
        }),
      ],
    ],
  ]);
}

function change(
  snapshot: Map<IntegrityCollection, CheckedDocument[]>,
  collection: IntegrityCollection,
  path: string,
  data: Record<string, unknown>,
): void {
  const documents = snapshot.get(collection) ?? [];
  const others = documents.filter((document) => document.path !== path);
  const current = documents.find((document) => document.path === path);
  snapshot.set(collection, [...others, doc(path, { ...(current?.data ?? {}), ...data })]);
}

const summary = (findings: readonly IntegrityFinding[]) =>
  findings.map((finding) => [finding.check, finding.documentPath, finding.field ?? null]);

describe("checkIntegrity", () => {
  it("finds nothing in a consistent world", () => {
    expect(checkIntegrity(world())).toEqual([]);
  });

  it("finds a reference, an element of an array and a polymorphic reference that name nothing", () => {
    const snapshot = world();
    change(snapshot, "laboratories", "laboratories/lab-1", { piPersonId: "p-gone" });
    change(snapshot, "persons", "persons/p-2", { laboratoryIds: ["lab-gone"] });
    change(snapshot, "statusHistory", "statusHistory/hist-1", { entityId: "Rep2001__lab-gone" });
    change(snapshot, "participations", "participations/Rep2001__lab-1", { equipmentConfigurationId: "cfg-gone" });
    const found = summary(checkIntegrity(snapshot).filter((finding) => finding.check === "danglingReference"));
    expect(found).toEqual(
      expect.arrayContaining([
        ["danglingReference", "laboratories/lab-1", "piPersonId"],
        ["danglingReference", "persons/p-2", "laboratoryIds"],
        ["danglingReference", "statusHistory/hist-1", "entityId"],
        ["danglingReference", "participations/Rep2001__lab-1", "equipmentConfigurationId"],
      ]),
    );
    expect(found).toHaveLength(4);
  });

  it("does not follow a reference into a collection the snapshot does not hold", () => {
    const snapshot = world();
    snapshot.delete("users");
    change(snapshot, "persons", "persons/p-2", { userId: "uid-unknown" });
    expect(checkIntegrity(snapshot)).toEqual([]);
  });

  it("finds a participation whose identifier disagrees with its fields", () => {
    const snapshot = world();
    change(snapshot, "participations", "participations/Rep2001__lab-1", { laboratoryId: "lab-other" });
    change(snapshot, "laboratoryMembers", "laboratories/lab-1/members/p-1", { personId: "p-2" });
    const found = checkIntegrity(snapshot).filter((finding) => finding.check === "identifierMismatch");
    expect(found.map((finding) => finding.documentPath).sort()).toEqual([
      "laboratories/lab-1/members/p-1",
      "participations/Rep2001__lab-1",
    ]);
    expect(found.find((finding) => finding.documentPath.startsWith("participations"))?.detail).toBe(
      "The fields of the document give the identifier Rep2001__lab-other.",
    );
  });

  it("finds a person linked to more than one login, and a link that only one side records", () => {
    const snapshot = world();
    snapshot.set("users", [doc("users/uid-1", { personId: "p-1" }), doc("users/uid-2", { personId: "p-1" })]);
    change(snapshot, "persons", "persons/p-2", { userId: "uid-3" });
    expect(
      summary(checkIntegrity(snapshot).filter((finding) => finding.check === "personLinkedToSeveralUsers")),
    ).toEqual([
      ["personLinkedToSeveralUsers", "persons/p-1", "userId"],
      ["personLinkedToSeveralUsers", "persons/p-2", "userId"],
    ]);
  });

  it("finds denormalised values that disagree with their source", () => {
    const snapshot = world();
    change(snapshot, "replications", "replications/Rep2001", { leadPersonIds: ["p-2"] });
    change(snapshot, "persons", "persons/p-1", { laboratoryIds: [], replicationIds: [] });
    change(snapshot, "participations", "participations/Rep2001__lab-1", { status: "confirmed" });
    change(snapshot, "participationChecklist", "participations/Rep2001__lab-1/checklist/ethics", {
      laboratoryId: "lab-other",
    });
    const found = checkIntegrity(snapshot).filter((finding) => finding.check === "derivedValueDisagrees");
    expect(summary(found)).toEqual([
      ["derivedValueDisagrees", "replications/Rep2001", "leadPersonIds"],
      ["derivedValueDisagrees", "persons/p-1", "laboratoryIds"],
      ["derivedValueDisagrees", "persons/p-1", "replicationIds"],
      ["derivedValueDisagrees", "participations/Rep2001__lab-1", "status"],
      ["derivedValueDisagrees", "participations/Rep2001__lab-1/checklist/ethics", "laboratoryId"],
    ]);
    expect(found[0]?.detail).toBe("Stored: p-2. Derived from the source: p-1.");
  });

  it("does not count an archived or unconfirmed entry towards a derived value", () => {
    const snapshot = world();
    change(snapshot, "laboratoryMembers", "laboratories/lab-1/members/p-1", { status: "proposed" });
    change(snapshot, "persons", "persons/p-1", { laboratoryIds: [] });
    expect(checkIntegrity(snapshot)).toEqual([]);
  });

  it("finds a chain of equipment configurations with two current members, and leaves separate chains alone", () => {
    const snapshot = world();
    change(snapshot, "laboratoryEquipment", "laboratories/lab-1/equipment/cfg-3", {
      laboratoryId: "lab-1",
      isCurrent: true,
      supersedesId: null,
    });
    expect(checkIntegrity(snapshot)).toEqual([]);
    change(snapshot, "laboratoryEquipment", "laboratories/lab-1/equipment/cfg-1", { isCurrent: true });
    expect(summary(checkIntegrity(snapshot))).toEqual([
      ["equipmentChainCurrent", "laboratories/lab-1/equipment/cfg-1", "isCurrent"],
    ]);
  });

  it("counts the findings of every check, the checks with none included", () => {
    const snapshot = world();
    change(snapshot, "laboratories", "laboratories/lab-1", { piPersonId: "p-gone" });
    expect(countFindings(checkIntegrity(snapshot))).toEqual({
      danglingReference: 1,
      identifierMismatch: 0,
      personLinkedToSeveralUsers: 0,
      derivedValueDisagrees: 0,
      equipmentChainCurrent: 0,
      dependencyCycle: 0,
    });
  });
});

describe("the structure of tasks", () => {
  const task = (id: string, data: Record<string, unknown>) =>
    doc(`tasks/${id}`, {
      listId: "list-1",
      parentId: null,
      ancestorIds: [],
      dependsOn: {},
      tagIds: [],
      scopeKeys: ["rep:Rep2001"],
      ...data,
    });
  const snapshot = (tasks: CheckedDocument[], tags: CheckedDocument[] = []) =>
    new Map<IntegrityCollection, CheckedDocument[]>([
      ["taskLists", [doc("taskLists/list-1", { scopeKeys: ["rep:Rep2001"] })]],
      ["tasks", tasks],
      ["tags", tags],
    ]);

  it("finds nothing in a sound tree with sound dependencies and tags", () => {
    const tagged = doc(`tags/${tagId("Pilot")}`, { name: "Pilot", nameFolded: "pilot" });
    expect(
      checkIntegrity(
        snapshot(
          [
            task("a", { tagIds: [tagId("Pilot")] }),
            task("b", { parentId: "a", ancestorIds: ["a"], dependsOn: { a: "finishToStart" } }),
            task("c", { parentId: "b", ancestorIds: ["a", "b"] }),
          ],
          [tagged],
        ),
      ),
    ).toEqual([]);
  });

  it("reports a cycle of dependencies once, and every reference that names nothing", () => {
    const findings = checkIntegrity(
      snapshot([
        task("a", { dependsOn: { b: "finishToStart" } }),
        task("b", { dependsOn: { a: "blocks", gone: "blocks" } }),
        task("c", { listId: "list-2", parentId: "missing", ancestorIds: ["missing"], tagIds: ["nope"] }),
      ]),
    );
    expect(findings.filter((finding) => finding.check === "dependencyCycle")).toEqual([
      {
        check: "dependencyCycle",
        documentPath: "tasks/a",
        field: "dependsOn",
        detail: "These tasks depend on each other in a cycle: a, b.",
      },
    ]);
    expect(
      findings
        .filter((finding) => finding.check === "danglingReference")
        .map((finding) => [finding.documentPath, finding.field]),
    ).toEqual([
      ["tasks/b", "dependsOn"],
      ["tasks/c", "listId"],
      ["tasks/c", "parentId"],
      ["tasks/c", "tagIds"],
    ]);
  });

  it("reports ancestors and a scope that disagree with the parent and the list, and a tag folded wrongly", () => {
    const findings = checkIntegrity(
      snapshot(
        [task("a", { scopeKeys: ["rep:Other2002"] }), task("b", { parentId: "a", ancestorIds: [] })],
        [doc(`tags/${tagId("Pilot")}`, { name: "Pilot", nameFolded: "other" })],
      ),
    );
    expect(
      findings
        .filter((finding) => finding.check === "derivedValueDisagrees")
        .map((finding) => [finding.documentPath, finding.field]),
    ).toEqual([
      ["tasks/a", "scopeKeys"],
      ["tasks/b", "ancestorIds"],
      [`tags/${tagId("Pilot")}`, "nameFolded"],
    ]);
  });
});
