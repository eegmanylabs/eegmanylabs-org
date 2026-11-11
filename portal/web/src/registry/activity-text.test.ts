import { taskPatchSchema } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTION_LABELS, changedFieldsText, TASK_FIELD_LABELS } from "./activity-text";

describe("the words of the activity", () => {
  it("label every field of a task that a callable function can change", () => {
    // `archived` of a change is stored and recorded as `archivedAt`.
    const fields = Object.keys(taskPatchSchema.shape).map((field) => (field === "archived" ? "archivedAt" : field));
    expect(fields.filter((field) => TASK_FIELD_LABELS[field] === undefined)).toEqual([]);
  });

  it("say the fields of a change as a sentence, each once, and never their keys", () => {
    expect(changedFieldsText(["tagIds", "assigneeUids", "dueAt"])).toBe("the tags, the assignees and the due date");
    expect(changedFieldsText(["recurrenceRule", "recurrenceSourceTaskId"])).toBe("the repetition");
    expect(changedFieldsText(["dependsOn"])).toBe("the dependencies");
  });

  it("label every action of tasks and pages that the activity records", () => {
    for (const action of ["page.edited", "task.created", "task.updated", "task.moved", "task.statusChanged"]) {
      expect(ACTIVITY_ACTION_LABELS[action]).toBeDefined();
    }
  });
});
