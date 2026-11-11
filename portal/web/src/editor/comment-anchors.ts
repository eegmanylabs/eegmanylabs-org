// Comment threads anchored to a selection of a page, with the anchor kept in the Firestore
// document of the thread and never in the page body (D-010), so that a member who may only
// comment writes nothing into the page. Ported from the editor spike, which verified it.
//
// An anchor is resolved in this order:
//   1. its two Yjs relative positions, which follow edits around the text and inside it;
//   2. where they have collapsed, because the text was deleted or its block moved: the block with
//      the stored identifier, and in it the quoted text where it still occurs, or else the block;
//   3. otherwise the thread has lost its place, and the comment panel lists it without one.
// The plugin draws each resolved anchor as a decoration and tells the panel which thread a
// click lands on. It depends on y-prosemirror's binding, so check it on every upgrade of the editor.
import { createExtension, type ExtensionOptions } from "@blocknote/core";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { type EditorState, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "y-prosemirror";
import * as Y from "yjs";

/** Where a thread is anchored, as its document stores it. */
export interface Anchor {
  readonly blockId: string;
  readonly from: string;
  readonly to: string;
  readonly quote: string;
}

export interface AnchoredThread {
  readonly id: string;
  readonly anchor: Anchor;
  readonly resolved: boolean;
}

/** What the comment panel shares with the editor: the anchored threads, and the one that is selected. */
export interface AnchorStore {
  threads(): readonly AnchoredThread[];
  selectedThreadId(): string | null;
  subscribe(listener: () => void): () => void;
  /** Called when a reader clicks an anchor. */
  select(threadId: string): void;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

type Positions = ReadonlyMap<string, Range>;

/** The mapping of y-prosemirror between Yjs types and editor nodes. */
type ProsemirrorMapping = Parameters<typeof relativePositionToAbsolutePosition>[3];

interface Binding {
  readonly type: Y.XmlFragment;
  readonly mapping: ProsemirrorMapping;
}

function bindingOf(state: EditorState): Binding | null {
  const binding: unknown = ySyncPluginKey.getState(state)?.binding;
  if (typeof binding !== "object" || binding === null) return null;
  const { type, mapping } = binding as Partial<Binding>;
  return type instanceof Y.XmlFragment && mapping instanceof Map ? { type, mapping } : null;
}

/** The range of the quoted text in a block, or the whole block where the quote is gone. */
function blockRange(doc: ProsemirrorNode, blockId: string, quote: string): Range | null {
  let found: Range | null = null;
  doc.descendants((node, position) => {
    if (found !== null) return false;
    if (node.type.name !== "blockContainer" || node.attrs.id !== blockId) return true;
    const content = node.firstChild;
    if (content === null) return false;
    const start = position + 2;
    const end = position + content.nodeSize;
    if (end <= start) return false;
    const text = doc.textBetween(start, end, " ");
    const at = quote === "" ? -1 : text.indexOf(quote);
    const exact = at >= 0 && doc.textBetween(start + at, Math.min(end, start + at + quote.length), " ") === quote;
    found = exact ? { from: start + at, to: start + at + quote.length } : { from: start, to: end };
    return false;
  });
  return found;
}

/** Where an anchor is in the editor now, or null where its thread has lost its place. */
export function resolveAnchor(state: EditorState, anchor: Anchor): Range | null {
  const binding = bindingOf(state);
  const doc = binding?.type.doc ?? null;
  if (binding !== null && doc !== null) {
    try {
      const from = relativePositionToAbsolutePosition(
        doc,
        binding.type,
        Y.createRelativePositionFromJSON(JSON.parse(anchor.from)),
        binding.mapping,
      );
      const to = relativePositionToAbsolutePosition(
        doc,
        binding.type,
        Y.createRelativePositionFromJSON(JSON.parse(anchor.to)),
        binding.mapping,
      );
      if (from !== null && to !== null && from < to && to <= state.doc.content.size) return { from, to };
    } catch {
      // A position that no longer parses or resolves: the block and the quote find the place.
    }
  }
  return anchor.blockId === "" ? null : blockRange(state.doc, anchor.blockId, anchor.quote);
}

/** The anchor of the current selection, or null where nothing is selected. */
export function anchorOfSelection(state: EditorState): Anchor | null {
  const binding = bindingOf(state);
  const { from, to } = state.selection;
  if (binding === null || from === to) return null;
  let blockId = "";
  const start = state.doc.resolve(from);
  for (let depth = start.depth; depth >= 0; depth -= 1) {
    const node = start.node(depth);
    if (node.type.name === "blockContainer") {
      blockId = String(node.attrs.id);
      break;
    }
  }
  // Yjs writes a relative position with class instances, which Firestore does not store: it is kept as JSON text.
  const relative = (position: number) =>
    JSON.stringify(
      Y.relativePositionToJSON(absolutePositionToRelativePosition(position, binding.type, binding.mapping)),
    );
  const quote = state.doc.textBetween(from, to, " ").trim().slice(0, 300);
  return quote === "" ? null : { blockId, from: relative(from), to: relative(to), quote };
}

const anchorsKey = new PluginKey<{ readonly positions: Positions; readonly decorations: DecorationSet }>(
  "portal-comment-anchors",
);

const samePositions = (a: Positions, b: Positions) =>
  a.size === b.size && [...a].every(([id, range]) => b.get(id)?.from === range.from && b.get(id)?.to === range.to);

/** Draws the anchors of the threads of the store, and selects a thread when its anchor is clicked. */
export const CommentAnchors = createExtension(
  ({ editor, options }: ExtensionOptions<{ readonly store: AnchorStore }>) => {
    const { store } = options;
    let scheduled = false;
    let selected: string | null = null;

    const decorate = (doc: ProsemirrorNode, positions: Positions) =>
      DecorationSet.create(
        doc,
        [...positions].map(([id, range]) =>
          Decoration.inline(range.from, range.to, {
            class: id === store.selectedThreadId() ? "portal-comment-anchor is-selected" : "portal-comment-anchor",
            "data-thread-id": id,
          }),
        ),
      );

    const sync = () => {
      scheduled = false;
      const view = editor.prosemirrorView;
      if (view === undefined || view.isDestroyed) return;
      const positions = new Map<string, Range>();
      for (const thread of store.threads()) {
        if (thread.resolved) continue;
        const range = resolveAnchor(view.state, thread.anchor);
        if (range !== null) positions.set(thread.id, range);
      }
      const current = anchorsKey.getState(view.state);
      if (current === undefined) return;
      if (samePositions(positions, current.positions) && selected === store.selectedThreadId()) return;
      selected = store.selectedThreadId();
      view.dispatch(view.state.tr.setMeta(anchorsKey, { positions }).setMeta("addToHistory", false));
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(sync, 0);
    };

    return {
      key: "portalCommentAnchors",
      prosemirrorPlugins: [
        new Plugin({
          key: anchorsKey,
          state: {
            init: () => ({ positions: new Map<string, Range>() as Positions, decorations: DecorationSet.empty }),
            apply(transaction, value) {
              const meta = transaction.getMeta(anchorsKey) as { readonly positions: Positions } | undefined;
              if (meta !== undefined)
                return { positions: meta.positions, decorations: decorate(transaction.doc, meta.positions) };
              if (!transaction.docChanged) return value;
              // Keeps a highlight on its text for this frame. `sync` resolves it again right after.
              const positions = new Map<string, Range>();
              for (const [id, range] of value.positions) {
                const from = transaction.mapping.map(range.from, 1);
                const to = transaction.mapping.map(range.to, -1);
                if (from < to) positions.set(id, { from, to });
              }
              return { positions, decorations: value.decorations.map(transaction.mapping, transaction.doc) };
            },
          },
          props: {
            decorations: (state) => anchorsKey.getState(state)?.decorations,
            handleClick(view, position, event) {
              if (event.button !== 0) return false;
              const hit = [...(anchorsKey.getState(view.state)?.positions ?? [])].find(
                ([, range]) => position >= range.from && position <= range.to,
              );
              if (hit === undefined) return false;
              store.select(hit[0]);
              return false;
            },
          },
          view: () => ({ update: schedule }),
        }),
      ],
      mount() {
        const unsubscribe = store.subscribe(schedule);
        schedule();
        return unsubscribe;
      },
    } as const;
  },
);
