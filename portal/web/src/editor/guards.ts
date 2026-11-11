// Guards against two defects of BlockNote 0.57 that the editor spike found, each of which breaks
// collaboration. Its test of the editor reports whether the stock defect still reproduces, so
// check both again on every upgrade of BlockNote, and remove a guard once the defect is fixed.
import { createExtension, type ExtensionOptions } from "@blocknote/core";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";

/**
 * The Markdown shortcut for a code block takes the typed word as its language verbatim, and the
 * code block then throws for a language it does not support, which leaves the editor out of step
 * with its document and sends the bad value to every collaborator. This rewrites an unknown
 * language to plain text in the same dispatch, before anything renders.
 */
export const CodeLanguageGuard = createExtension(
  ({ options }: ExtensionOptions<{ readonly supported: Readonly<Record<string, unknown>> }>) => ({
    key: "codeLanguageGuard",
    prosemirrorPlugins: [
      new Plugin({
        key: new PluginKey("codeLanguageGuard"),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          let fixed: Transaction | null = null;
          state.doc.descendants((node, position) => {
            if (node.type.name === "codeBlock" && !Object.hasOwn(options.supported, String(node.attrs.language))) {
              fixed = (fixed ?? state.tr).setNodeMarkup(position, undefined, { ...node.attrs, language: "text" });
            }
          });
          return fixed;
        },
      }),
    ],
  }),
);

/** The part of the position mapping of BlockNote's Yjs binding that the guard below wraps. */
interface PositionMapping {
  mapPosition: (position: number, side?: "left" | "right") => () => number;
  portalGuarded?: boolean;
}

const isPositionMapping = (value: unknown): value is PositionMapping =>
  typeof value === "object" && value !== null && typeof (value as PositionMapping).mapPosition === "function";

/**
 * After a trigger character (`/` or `@`) the suggestion menu tracks a position through a Yjs
 * relative position. When a collaborator replaces that block, resolving it throws inside the
 * editor's state, and every later remote change is never shown here until a reload. The guard
 * makes a failed lookup give 0, which tells the menu that the caret has left its block, so it
 * closes.
 */
export const PositionMappingGuard = createExtension(({ editor }) => ({
  key: "positionMappingGuard",
  mount() {
    const mapping: unknown = editor.getExtension("yPositionMapping");
    if (!isPositionMapping(mapping) || mapping.portalGuarded === true) return;
    const original = mapping.mapPosition.bind(mapping);
    mapping.mapPosition = (position, side) => {
      const resolve = original(position, side);
      return () => {
        try {
          return resolve();
        } catch {
          return 0;
        }
      };
    };
    mapping.portalGuarded = true;
  },
}));
