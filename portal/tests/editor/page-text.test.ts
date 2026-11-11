// The walk of a page's Yjs document, checked against documents that the editor's own converter
// builds from blocks, with the configurations of the custom blocks and the mention that the
// browser uses. If an upgrade of the editor changed how blocks are stored, these tests would
// show it. Fixtures are synthetic: invented names and accounts.
import { BlockNoteSchema, createBlockSpec, createInlineContentSpec } from "@blocknote/core";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import {
  calloutBlockConfig,
  linkedViewBlockConfig,
  mentionInlineConfig,
  PAGE_CHUNK_BYTES,
  PAGE_FRAGMENT_NAME,
} from "@eegml/shared";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { chunksOf, contentChunks, extractPageText, mentionedUids } from "../../functions/src/pages/content";

// The renderers serve HTML only, which these tests never ask for.
const unused = () => {
  throw new Error("Not rendered on the server.");
};
const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    linkedView: createBlockSpec(linkedViewBlockConfig, { render: unused })(),
    callout: createBlockSpec(calloutBlockConfig, { render: unused })(),
  },
  inlineContentSpecs: {
    mention: createInlineContentSpec(mentionInlineConfig, { render: unused }),
  },
});
const editor = ServerBlockNoteEditor.create({ schema });

describe("extractPageText", () => {
  it("reads the text of every kind of block, with mentions, tables and files, in the order of the page", () => {
    const doc = editor.blocksToYDoc(
      [
        { id: "h", type: "heading", props: { level: 2 }, content: "Electrode montage" },
        {
          id: "p",
          type: "paragraph",
          content: [
            "Agreed with ",
            { type: "mention", props: { userId: "uid-ada", label: "Ada Example" } },
            " and ",
            { type: "mention", props: { userId: "uid-ben", label: "Ben Sample" } },
            ".",
          ],
        },
        { id: "c", type: "callout", props: { variant: "warning" }, content: "Check the impedance" },
        { id: "l", type: "checkListItem", props: { checked: true }, content: "Order the caps" },
        { id: "q", type: "codeBlock", props: { language: "python" }, content: "print('alpha')" },
        { id: "v", type: "linkedView", props: { viewId: "view-1", title: "Recruitment" } },
        {
          id: "t",
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: ["Laboratory", "Site"] }, { cells: ["Cologne", "North"] }],
          },
        },
        { id: "f", type: "file", props: { name: "protocol.pdf", url: "portal-file:pages/x/files/y/protocol.pdf" } },
        {
          id: "n",
          type: "bulletListItem",
          content: "Parent item",
          children: [{ id: "m", type: "bulletListItem", content: "Nested item" }],
        },
      ],
      PAGE_FRAGMENT_NAME,
    );
    const text = extractPageText(doc);
    expect(text.lines).toEqual([
      "Electrode montage",
      "Agreed with @Ada Example and @Ben Sample.",
      "Check the impedance",
      "Order the caps",
      "print('alpha')",
      "Laboratory Site Cologne North",
      "protocol.pdf",
      "Parent item",
      "Nested item",
    ]);
    expect(text.mentions).toEqual([
      { uid: "uid-ada", label: "Ada Example", blockId: "p" },
      { uid: "uid-ben", label: "Ben Sample", blockId: "p" },
    ]);
    expect(mentionedUids(text)).toEqual(["uid-ada", "uid-ben"]);
  });

  it("finds nothing in an empty document", () => {
    expect(extractPageText(new Y.Doc())).toEqual({ lines: [], mentions: [] });
  });
});

describe("the chunks of a snapshot", () => {
  it("split a large state below the size of a document, and name each by generation and index", () => {
    const state = new Uint8Array(PAGE_CHUNK_BYTES * 2 + 5);
    expect(chunksOf(state).map((chunk) => chunk.length)).toEqual([PAGE_CHUNK_BYTES, PAGE_CHUNK_BYTES, 5]);
    expect(contentChunks("page-1", 3, new Uint8Array(2)).map((chunk) => chunk.id)).toEqual(["000003__000000"]);
  });
});
