import { describe, expect, it } from "vitest";
import { portalDictionary, sentenceCase, shortcutText } from "./dictionary";

/** Every text the dictionary shows, with its path, leaving out search terms and shortcuts. */
function texts(value: unknown, path: string[] = []): [string, string][] {
  const key = path.at(-1) ?? "";
  if (["aliases", "secondary_tooltip", "locale", "ctrl_shortcut"].includes(key)) return [];
  if (typeof value === "string") return [[path.join("."), value]];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([name, entry]) => texts(entry, [...path, name]));
}

describe("the dictionary of the editor", () => {
  const all = texts(portalDictionary);

  it("is in sentence case throughout", () => {
    const wrong = all.filter(([, text]) => sentenceCase(text) !== text);
    expect(wrong).toEqual([]);
    expect(portalDictionary.slash_menu.toggle_list.title).toBe("Toggle list");
    expect(portalDictionary.slash_menu.code_block.title).toBe("Code block");
  });

  it("uses UK spelling", () => {
    expect(all.filter(([, text]) => /color|center|gray/i.test(text))).toEqual([]);
    expect(portalDictionary.color_picker.colors.gray).toBe("Grey");
    expect(portalDictionary.formatting_toolbar.colors.tooltip).toBe("Colours");
    expect(portalDictionary.formatting_toolbar.align_center.tooltip).toBe("Centre text");
  });
});

describe("shortcutText", () => {
  it("names the keys in words", () => {
    expect(shortcutText("CTRL-ALT-1")).toBe("Control Alt 1");
    expect(shortcutText("Mod+Shift+S")).toBe("Control Shift S");
  });
});
