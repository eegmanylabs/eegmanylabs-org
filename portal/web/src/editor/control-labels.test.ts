// The names that the content controls of the editor receive. Fixtures are synthetic.
import { describe, expect, it } from "vitest";
import { labelEditorControls, withControlLabels } from "./control-labels";

function content(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("labelEditorControls", () => {
  it("names a checklist checkbox and a code language select, and steps a heading down", () => {
    const root = content(`
      <input type="checkbox"><p class="bn-inline-content">Book the EEG room</p>
      <div contenteditable="false"><select><option>Python</option></select></div>
      <h1>Synthetic agenda</h1><h6>Small print</h6>
    `);
    labelEditorControls(root);
    expect(root.querySelector("input")?.getAttribute("aria-label")).toBe("Done");
    expect(root.querySelector("select")?.getAttribute("aria-label")).toBe("Language of the code");
    expect(root.querySelector("h1")?.getAttribute("aria-level")).toBe("2");
    expect(root.querySelector("h6")?.getAttribute("aria-level")).toBe("6");
  });
});

describe("withControlLabels", () => {
  it("names the controls of what the renderer of a block draws, before anyone else sees it", () => {
    const spec = {
      config: { type: "checkListItem" },
      implementation: {
        render: () => ({ dom: content('<input type="checkbox">'), contentDOM: document.createElement("p") }),
      },
    };
    const drawn = withControlLabels(spec).implementation.render();
    expect(drawn.dom.querySelector("input")?.getAttribute("aria-label")).toBe("Done");
    expect(drawn.contentDOM.tagName).toBe("P");
  });
});
