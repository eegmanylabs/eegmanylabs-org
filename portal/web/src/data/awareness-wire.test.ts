// Fixtures are synthetic.
import { describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { awarenessUpdateOf, namesOfOthers } from "./awareness-wire";

describe("the presence of a page", () => {
  it("applies a state that another tab wrote, in the wire format of y-protocols", () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalStateField("user", { name: "Ivy Pretend" });
    const state = JSON.stringify({ user: { name: "Ben Sample", colour: "x" }, cursor: { anchor: "ä" } });
    applyAwarenessUpdate(awareness, awarenessUpdateOf(300, 2, state), "test");
    applyAwarenessUpdate(
      awareness,
      awarenessUpdateOf(70_000, 1, JSON.stringify({ user: { name: "Ada Example" } })),
      "test",
    );
    expect(awareness.getStates().get(300)).toEqual(JSON.parse(state));
    expect(namesOfOthers(awareness)).toEqual(["Ada Example", "Ben Sample"]);
    awareness.destroy();
  });

  it("ignores an older state of the same tab", () => {
    const awareness = new Awareness(new Y.Doc());
    applyAwarenessUpdate(awareness, awarenessUpdateOf(5, 3, JSON.stringify({ user: { name: "Newer" } })), "test");
    applyAwarenessUpdate(awareness, awarenessUpdateOf(5, 2, JSON.stringify({ user: { name: "Older" } })), "test");
    expect(namesOfOthers(awareness)).toEqual(["Newer"]);
    awareness.destroy();
  });
});
