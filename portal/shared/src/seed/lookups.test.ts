// The lookup data that a new database starts with.
import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "../collections";
import { systemWriteContext } from "../schemas/base";
import type { FirestoreTimestamp } from "../timestamp";
import {
  COUNT_CATEGORIES,
  CREDIT_ROLES,
  DATASET_WORKFLOW_STATUSES,
  lookupSeedDocuments,
  ONBOARDING_CHECKLIST_TEMPLATE,
  PROGRAMME_SEED,
  REPLICATION_STATUSES,
  TASK_STATUSES,
} from "./lookups";

const now: FirestoreTimestamp = { seconds: 0, nanoseconds: 0, toDate: () => new Date(0), toMillis: () => 0 };
const standard = {
  schemaVersion: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: "system:seedLookups",
  updatedBy: "system:seedLookups",
  archivedAt: null,
  writeContext: systemWriteContext(),
};

const keysOf = (items: readonly { readonly key: string }[]) => items.map((item) => item.key);

describe("the programme", () => {
  it("is #EEGManyLabs under the key eegmanylabs", () => {
    expect(PROGRAMME_SEED).toEqual({ key: "eegmanylabs", name: "#EEGManyLabs", kind: "programme", parentId: null });
  });
});

describe("the statuses", () => {
  it("of a replication are the thirteen of the data model, in order", () => {
    expect(REPLICATION_STATUSES.map((status) => [status.key, status.label, status.category])).toEqual([
      ["proposed", "Proposed", "notStarted"],
      ["planning", "Planning", "active"],
      ["recruitingLabs", "Recruiting labs", "active"],
      ["sitePreparation", "Site preparation", "active"],
      ["collecting", "Collecting", "active"],
      ["collectionComplete", "Collection complete", "active"],
      ["processing", "Processing", "active"],
      ["analysing", "Analysing", "active"],
      ["writing", "Writing", "active"],
      ["submitted", "Submitted", "active"],
      ["published", "Published", "done"],
      ["paused", "Paused", "paused"],
      ["archived", "Archived", "cancelled"],
    ]);
  });

  it("of a dataset are the nine workflow statuses, in order", () => {
    expect(DATASET_WORKFLOW_STATUSES.map((status) => [status.key, status.label, status.category])).toEqual([
      ["received", "Received", "notStarted"],
      ["integrityChecked", "Integrity checked", "active"],
      ["bidsValidated", "BIDS validated", "active"],
      ["qcPending", "QC pending", "active"],
      ["qcCompleted", "QC completed", "active"],
      ["accepted", "Accepted", "active"],
      ["flagged", "Flagged", "paused"],
      ["preprocessing", "Preprocessing", "active"],
      ["analysisReady", "Analysis ready", "done"],
    ]);
  });

  it("of a task are the five, in order", () => {
    expect(TASK_STATUSES.map((status) => [status.key, status.label, status.category])).toEqual([
      ["toDo", "To do", "notStarted"],
      ["inProgress", "In progress", "active"],
      ["blocked", "Blocked", "paused"],
      ["done", "Done", "done"],
      ["cancelled", "Cancelled", "cancelled"],
    ]);
  });

  it("have one default for each kind of record: the first, which has not started", () => {
    const statuses = lookupSeedDocuments().filter((document) => document.collection === "statusDefinitions");
    expect(statuses).toHaveLength(27);
    for (const entityType of ["replication", "dataset", "task"]) {
      const ofType = statuses.filter((document) => document.data.entityType === entityType);
      expect(ofType.map((document) => document.data.position)).toEqual(ofType.map((_document, index) => index));
      expect(ofType.filter((document) => document.data.isDefault).map((document) => document.data.position)).toEqual([
        0,
      ]);
      expect(ofType[0]?.data.category).toBe("notStarted");
    }
  });
});

describe("the count categories", () => {
  it("are the eleven of the data model, in the order a participant passes through them", () => {
    expect(keysOf(COUNT_CATEGORIES)).toEqual([
      "target",
      "planned",
      "scheduled",
      "recruited",
      "tested",
      "recorded",
      "submitted",
      "received",
      "validated",
      "usable",
      "excluded",
    ]);
  });

  it("each have a definition of one sentence that says who is counted, and no two alike", () => {
    for (const category of COUNT_CATEGORIES) {
      expect(category.definition, category.key).toMatch(/^Participants [^.!?;]+\.$/);
      expect(category.definition.length, category.key).toBeGreaterThan(60);
    }
    expect(new Set(COUNT_CATEGORIES.map((category) => category.definition)).size).toBe(COUNT_CATEGORIES.length);
  });

  it("are all core categories of the programme, and none belongs to one replication", () => {
    const categories = lookupSeedDocuments().filter((document) => document.collection === "countCategories");
    expect(categories).toHaveLength(11);
    for (const category of categories) {
      expect(category.id).toBe(category.data.key);
      expect(category.data.isCore).toBe(true);
      expect(category.data).not.toHaveProperty("replicationId");
    }
  });
});

describe("the onboarding checklist", () => {
  it("has the nine items of the data model, in order", () => {
    expect(ONBOARDING_CHECKLIST_TEMPLATE.key).toBe("onboarding");
    expect(ONBOARDING_CHECKLIST_TEMPLATE.items).toEqual([
      { key: "participationConfirmation", label: "Participation confirmation" },
      { key: "verifiedContacts", label: "Verified contacts" },
      { key: "equipmentConfirmation", label: "Equipment confirmation" },
      { key: "ethics", label: "Ethics" },
      { key: "protocolReview", label: "Protocol review" },
      { key: "training", label: "Training" },
      { key: "technicalChecks", label: "Technical checks" },
      { key: "pilot", label: "Pilot" },
      { key: "readinessApproval", label: "Readiness approval" },
    ]);
  });
});

describe("the contributor roles", () => {
  it("are the fourteen roles of the taxonomy under their official names", () => {
    expect(CREDIT_ROLES.map((role) => role.name)).toEqual([
      "Conceptualization",
      "Data curation",
      "Formal analysis",
      "Funding acquisition",
      "Investigation",
      "Methodology",
      "Project administration",
      "Resources",
      "Software",
      "Supervision",
      "Validation",
      "Visualization",
      "Writing – original draft",
      "Writing – review & editing",
    ]);
    expect(keysOf(CREDIT_ROLES)).toEqual(
      Object.keys(COLLECTIONS.contributors.schema.shape.creditRoles.def.keyType.def.entries),
    );
  });

  it("are seeded as vocabulary terms that keep the key of each role", () => {
    const terms = lookupSeedDocuments().filter((document) => document.collection === "vocabularyTerms");
    expect(terms.map((term) => term.id)).toEqual([
      "creditRole__conceptualization",
      "creditRole__datacuration",
      "creditRole__formalanalysis",
      "creditRole__fundingacquisition",
      "creditRole__investigation",
      "creditRole__methodology",
      "creditRole__projectadministration",
      "creditRole__resources",
      "creditRole__software",
      "creditRole__supervision",
      "creditRole__validation",
      "creditRole__visualization",
      "creditRole__writingoriginaldraft",
      "creditRole__writingreviewediting",
    ]);
    expect(terms.map((term) => term.data.sourceId)).toEqual(keysOf(CREDIT_ROLES));
  });
});

describe("the documents of the lookup data", () => {
  const documents = lookupSeedDocuments();

  it("are 54, each with a path of its own", () => {
    expect(documents).toHaveLength(1 + 27 + 11 + 1 + 14);
    const paths = documents.map((document) => COLLECTIONS[document.collection].docPath(document.id));
    expect(new Set(paths).size).toBe(documents.length);
    expect(paths).toContain("programmes/eegmanylabs");
    expect(paths).toContain("statusDefinitions/replication__recruitingLabs");
    expect(paths).toContain("statusDefinitions/dataset__qcPending");
    expect(paths).toContain("statusDefinitions/task__toDo");
    expect(paths).toContain("countCategories/usable");
    expect(paths).toContain("checklistTemplates/onboarding");
  });

  it.each(documents.map((document) => [`${document.collection}/${document.id}`, document] as const))(
    "%s is a valid document of its collection once the standard fields are added",
    (_path, document) => {
      const parsed = COLLECTIONS[document.collection].schema.safeParse({ ...standard, ...document.data });
      expect(parsed.error?.issues ?? []).toEqual([]);
    },
  );

  it("are the same on every call", () => {
    expect(JSON.stringify(lookupSeedDocuments())).toBe(JSON.stringify(documents));
  });
});
