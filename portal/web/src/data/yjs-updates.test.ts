// A red-team regression: an editor appends bytes that are no Yjs update, which the rules accept,
// and every reader of the page must still apply the updates around it.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyUpdateSafely } from "./yjs-updates";

function textUpdate(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

describe("applyUpdateSafely", () => {
  it("skips an update that does not decode and applies the next one", () => {
    const doc = new Y.Doc();
    expect(() => Y.applyUpdate(new Y.Doc(), new Uint8Array([1, 2, 3]))).toThrow();
    expect(applyUpdateSafely(doc, new Uint8Array([1, 2, 3]), null)).toBe(false);
    expect(applyUpdateSafely(doc, new Uint8Array([]), null)).toBe(false);
    expect(applyUpdateSafely(doc, textUpdate("Synthetic agenda"), null)).toBe(true);
    expect(doc.getText("t").toString()).toBe("Synthetic agenda");
  });

  it("applies the same update twice without change", () => {
    const doc = new Y.Doc();
    const update = textUpdate("Once");
    applyUpdateSafely(doc, update, null);
    applyUpdateSafely(doc, update, null);
    expect(doc.getText("t").toString()).toBe("Once");
  });
});
