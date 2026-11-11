// Accessible names for the controls that BlockNote draws inside the content of a page (D-010).
// Its checklist checkboxes have no label and the language select of a code block has no name,
// which an accessibility audit reports as critical, and a heading of the content is drawn at a
// level that competes with the title of the page. The names and levels are set when a block is
// drawn, inside its renderer, before ProseMirror watches the element: an attribute set later
// would count as a change of the content, which ProseMirror answers by drawing the block again.
import { createExtension } from "@blocknote/core";

/**
 * Keeps `aria-expanded` off the editing area. BlockNote marks the area with it while a menu of
 * suggestions opens and closes, but the area is a text box, on which the attribute is not
 * allowed; the open menu is announced through `aria-activedescendant`. ProseMirror ignores a
 * change of the attributes of the area itself, so removing it draws nothing again.
 */
export const TextboxAttributes = createExtension(() => ({
  key: "portalTextboxAttributes",
  mount({ dom, signal }) {
    const clean = () => {
      for (const area of [dom, ...dom.querySelectorAll<HTMLElement>(".ProseMirror")]) {
        if (area.classList.contains("ProseMirror") && area.hasAttribute("aria-expanded")) {
          area.removeAttribute("aria-expanded");
        }
      }
    };
    clean();
    const observer = new MutationObserver(clean);
    observer.observe(dom, { attributes: true, attributeFilter: ["aria-expanded"], subtree: true });
    signal.addEventListener("abort", () => observer.disconnect());
  },
}));

/** The name of the checkbox of a checklist item. */
export const CHECKBOX_LABEL = "Done";
/** The name of the language select of a code block. */
export const CODE_LANGUAGE_LABEL = "Language of the code";

/** Names every checklist checkbox and code language select beneath a root, and steps its headings down. */
export function labelEditorControls(root: ParentNode): void {
  for (const checkbox of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    checkbox.setAttribute("aria-label", CHECKBOX_LABEL);
  }
  for (const select of root.querySelectorAll<HTMLSelectElement>("select")) {
    select.setAttribute("aria-label", CODE_LANGUAGE_LABEL);
  }
  // The title of the page is the one heading of level one in the view.
  for (const heading of root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
    heading.setAttribute("aria-level", String(Math.min(Number(heading.tagName.slice(1)) + 1, 6)));
  }
}

/** What a renderer of a block returns that matters here: the element it drew. */
interface Drawn {
  readonly dom: HTMLElement | DocumentFragment;
}

const isDrawn = (value: unknown): value is Drawn =>
  typeof value === "object" && value !== null && "dom" in value && value.dom instanceof Node;

/** A block spec whose renderer names the controls of what it draws, as `labelEditorControls` does. */
export function withControlLabels<S extends { readonly implementation: { readonly render?: unknown } }>(spec: S): S {
  const render = spec.implementation.render;
  if (typeof render !== "function") return spec;
  return {
    ...spec,
    implementation: {
      ...spec.implementation,
      render(this: unknown, ...args: unknown[]): unknown {
        const drawn: unknown = Reflect.apply(render, this, args);
        if (isDrawn(drawn)) labelEditorControls(drawn.dom);
        return drawn;
      },
    },
  };
}
