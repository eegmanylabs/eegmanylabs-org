// What the keyboard reaches in the editor beyond typing (D-010). The spike found that the
// formatting toolbar of BlockNote is reached with Tab only on a page without other controls,
// that its buttons have no arrow-key navigation, and that the side menu of a block appears on
// hover alone. These shortcuts close those gaps; shortcuts.ts lists them for the dialog that
// the page offers.
import { createExtension, type ExtensionOptions } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

const TOOLBAR = ".bn-formatting-toolbar";

function toolbarButtons(root: ParentNode): HTMLElement[] {
  const toolbar = root.querySelector(TOOLBAR);
  return toolbar === null
    ? []
    : [...toolbar.querySelectorAll<HTMLElement>("button:not([disabled]), [role='combobox']:not([disabled])")];
}

/**
 * Moves focus into the formatting toolbar. Without a selection the toolbar is hidden, so the text
 * of the current block is selected first, which shows it.
 */
function focusToolbar(editorElement: HTMLElement, selectBlock: () => boolean): void {
  const tryFocus = (attempts: number) => {
    const first = toolbarButtons(editorElement.ownerDocument)[0];
    if (first !== undefined) first.focus();
    else if (attempts > 0) requestAnimationFrame(() => tryFocus(attempts - 1));
  };
  if (toolbarButtons(editorElement.ownerDocument).length === 0) selectBlock();
  tryFocus(10);
}

/**
 * Brings the selection of the editor in line with that of the document. A shortcut pressed just
 * after a click or a selection by the keyboard can arrive before the editor has read the new
 * selection, and would otherwise act on the previous one.
 */
function takeDomSelection(view: EditorView): void {
  const selection = view.dom.ownerDocument.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (selection === null || !anchorNode || !focusNode) return;
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) return;
  try {
    const anchor = view.posAtDOM(anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(focusNode, selection.focusOffset);
    const current = view.state.selection;
    if (current.anchor === anchor && current.head === head) return;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))),
    );
  } catch {
    // A position the document cannot resolve: the editor keeps the selection it has.
  }
}

/**
 * The shortcuts of the editor, and arrow-key navigation within its formatting toolbar.
 * `onComment` is called with the selection, for the comment panel.
 */
export const KeyboardAccess = createExtension(
  ({ editor, options }: ExtensionOptions<{ readonly onComment: () => void }>) => ({
    key: "portalKeyboardAccess",
    keyboardShortcuts: {
      "Alt-F10": () => {
        const element = editor.domElement;
        if (element === undefined) return false;
        if (editor.prosemirrorView !== undefined) takeDomSelection(editor.prosemirrorView);
        focusToolbar(element, () => {
          const view = editor.prosemirrorView;
          if (view === undefined) return false;
          const { $from } = view.state.selection;
          const start = $from.start();
          const end = $from.end();
          if (end <= start) return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
          return true;
        });
        return true;
      },
      "Mod-Alt-m": () => {
        if (editor.prosemirrorView !== undefined) takeDomSelection(editor.prosemirrorView);
        options.onComment();
        return true;
      },
    },
    mount({ root, signal }) {
      // The toolbar is drawn in a layer of its own, so its keys are handled where it is drawn.
      root.addEventListener(
        "keydown",
        (event) => {
          if (!(event instanceof KeyboardEvent) || !(event.target instanceof HTMLElement)) return;
          if (event.target.closest(TOOLBAR) === null) return;
          const buttons = toolbarButtons(event.target.ownerDocument);
          const at = buttons.indexOf(event.target);
          if (event.key === "Escape") {
            event.preventDefault();
            editor.focus();
            return;
          }
          const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
          const step = moves[event.key];
          if (step === undefined || at < 0) return;
          event.preventDefault();
          buttons[(at + step + buttons.length) % buttons.length]?.focus();
        },
        { signal, capture: true },
      );
    },
  }),
);
