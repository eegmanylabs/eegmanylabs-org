// The field that is edited where it is shown: a change waits for the server visibly, says when the
// connection holds it back, and tells the person when it was refused. Values are synthetic.
import { replicationDocSchema } from "@eegml/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableField, SLOW_SAVE_MS } from "./editable-field";

afterEach(() => {
  vi.useRealTimers();
});

function field(onSave: (value: unknown) => Promise<void>) {
  render(
    <EditableField
      label="Title"
      value="A synthetic title"
      kind="text"
      schema={replicationDocSchema.shape.originalTitle}
      invalidMessage="Enter at most 10,000 characters."
      canEdit
      onSave={onSave}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  fireEvent.change(screen.getByLabelText("New value of title"), { target: { value: "Another synthetic title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("EditableField", () => {
  it("says that a change is not saved yet until the server answers, and that it waits for the connection", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    field(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(screen.getByTestId("not-saved-yet").textContent).toBe("Not saved yet");
    act(() => {
      vi.advanceTimersByTime(SLOW_SAVE_MS);
    });
    expect(screen.getByTestId("not-saved-yet").textContent).toBe(
      "Not saved yet. It will be saved when the connection returns.",
    );
    await act(async () => finish());
    expect(screen.queryByTestId("not-saved-yet")).toBeNull();
  });

  it("tells the person when the change was refused", async () => {
    field(() => Promise.reject(Object.assign(new Error("refused"), { code: "permission-denied" })));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("The change was refused"),
    );
    expect(screen.queryByTestId("not-saved-yet")).toBeNull();
  });
});
