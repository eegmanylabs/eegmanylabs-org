// The blocks that an update of a page touched, resolved in the stored document. The document is
// built as y-prosemirror stores BlockNote's: a block group of block containers, each with an
// identifier and its content, and nested blocks in a block group of their own.
// Fixtures are synthetic.
import { PAGE_FRAGMENT_NAME } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksTouchedBy } from "./content";

function block(id: string, text: string, children: readonly Y.XmlElement[] = []): Y.XmlElement {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", id);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  container.insert(0, [paragraph]);
  if (children.length > 0) {
    const group = new Y.XmlElement("blockGroup");
    group.insert(0, [...children]);
    container.insert(1, [group]);
  }
  return container;
}

/** A page of three blocks, the last holding one nested block, and the update that made it. */
function page(): Y.Doc {
  const doc = new Y.Doc();
  const group = new Y.XmlElement("blockGroup");
  doc.getXmlFragment(PAGE_FRAGMENT_NAME).insert(0, [group]);
  group.insert(0, [
    block("block-a", "Book the EEG room"),
    block("block-b", "Order caps"),
    block("block-c", "Pilot", [block("block-d", "Nested")]),
  ]);
  return doc;
}

/** The update that a change makes to a document, applied to it. */
function change(doc: Y.Doc, edit: () => void): Uint8Array {
  const before = Y.encodeStateVector(doc);
  edit();
  return Y.encodeStateAsUpdate(doc, before);
}

const textOf = (doc: Y.Doc, index: number, nested = false): Y.XmlText => {
  const group = doc.getXmlFragment(PAGE_FRAGMENT_NAME).get(0) as Y.XmlElement;
  let container = group.get(index) as Y.XmlElement;
  if (nested) container = (container.get(1) as Y.XmlElement).get(0) as Y.XmlElement;
  return (container.get(0) as Y.XmlElement).get(0) as Y.XmlText;
};

describe("blocksTouchedBy", () => {
  it("names the block whose text an update inserted, and only that block", () => {
    const doc = page();
    const update = change(doc, () => textOf(doc, 1).insert(0, "Now: "));
    expect(blocksTouchedBy(doc, update, 10)).toEqual(["block-b"]);
  });

  it("names a nested block rather than the block around it", () => {
    const doc = page();
    const update = change(doc, () => textOf(doc, 2, true).insert(6, " again"));
    expect(blocksTouchedBy(doc, update, 10)).toEqual(["block-d"]);
  });

  it("names the blocks from which an update deleted, and the attributes it set", () => {
    const doc = page();
    const update = change(doc, () => {
      textOf(doc, 0).delete(0, 5);
      const group = doc.getXmlFragment(PAGE_FRAGMENT_NAME).get(0) as Y.XmlElement;
      ((group.get(2) as Y.XmlElement).get(0) as Y.XmlElement).setAttribute("textAlignment", "center");
    });
    expect(blocksTouchedBy(doc, update, 10).sort()).toEqual(["block-a", "block-c"]);
  });

  it("names a new block by its own identifier, and stops at the limit", () => {
    const doc = page();
    const update = change(doc, () => {
      const group = doc.getXmlFragment(PAGE_FRAGMENT_NAME).get(0) as Y.XmlElement;
      group.insert(3, [block("block-e", "Added"), block("block-f", "Added too")]);
    });
    expect(blocksTouchedBy(doc, update, 10).sort()).toEqual(["block-e", "block-f"]);
    expect(blocksTouchedBy(doc, update, 1)).toHaveLength(1);
  });

  it("names nothing for an update of another document", () => {
    const other = new Y.Doc();
    const update = change(other, () => other.getText("elsewhere").insert(0, "synthetic"));
    expect(blocksTouchedBy(page(), update, 10)).toEqual([]);
  });
});
