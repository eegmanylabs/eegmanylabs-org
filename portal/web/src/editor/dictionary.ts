// The words of the editor in the portal's own style (D-018): UK English, sentence case, and the
// portal's way of naming shortcuts. BlockNote ships US English in title case. Its English
// dictionary is taken as the base and every text it shows is turned the portal's way, so a word
// that a later version adds is turned too; the few texts that need other words are set here.
import type { Dictionary } from "@blocknote/core";
import { en } from "@blocknote/core/locales";

/** US spellings that the dictionary uses, with their UK forms. */
const SPELLINGS: readonly (readonly [RegExp, string])[] = [
  [/\bColors\b/g, "Colours"],
  [/\bcolors\b/g, "colours"],
  [/\bColor\b/g, "Colour"],
  [/\bcolor\b/g, "colour"],
  [/\bGray\b/g, "Grey"],
  [/\bcenter\b/g, "centre"],
  [/\bCenter\b/g, "Centre"],
  [/\.\.\./g, "…"],
];

/** Keys whose values are search terms, keyboard shortcuts or a code, which are not shown as text. */
const UNCHANGED = new Set(["aliases", "secondary_tooltip", "locale", "ctrl_shortcut"]);

/** A word that is written in capitals or holds a digit keeps its form: URL, OK, H1. */
const KEEPS_FORM = /^([A-Z0-9]{2,}|.*\d.*)$/;

/**
 * A text in sentence case: every word in small letters but the first of each sentence, unless
 * it keeps its form.
 */
export function sentenceCase(text: string): string {
  const words = text.split(" ");
  return words
    .map((word, index) => {
      const startsSentence = index === 0 || /[.?!:]$/.test(words[index - 1] ?? "");
      return startsSentence || KEEPS_FORM.test(word) ? word : word.toLowerCase();
    })
    .join(" ");
}

/** A text of the editor in the portal's style. */
export function portalText(text: string): string {
  return SPELLINGS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), sentenceCase(text));
}

function localise<T>(value: T, key: string): T {
  if (UNCHANGED.has(key)) return value;
  if (typeof value === "string") return portalText(value) as T;
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([name, entry]) => [name, localise(entry, name)]),
  ) as T;
}

const base = localise(en, "");

/** The dictionary that the editor of every page is created with. */
export const portalDictionary: Dictionary = {
  ...base,
  locale: "en-GB",
  placeholders: {
    ...base.placeholders,
    default: "Type text, or / for the list of blocks",
    new_comment: "Write a comment…",
    edit_comment: "Edit the comment…",
    comment_reply: "Reply…",
  },
  comments: { ...base.comments, actions: { ...base.comments.actions, reopen: "Reopen" } },
  file_panel: {
    ...base.file_panel,
    upload: { ...base.file_panel.upload, upload_error: "The file could not be uploaded." },
    embed: { ...base.file_panel.embed, url_placeholder: "Web address" },
  },
  formatting_toolbar: {
    ...base.formatting_toolbar,
    align_center: { tooltip: "Centre text" },
    strike: { ...base.formatting_toolbar.strike, tooltip: "Strikethrough" },
  },
  versioning: { ...base.versioning, action_failed: "Something went wrong. Try again." },
};

/**
 * A keyboard shortcut as the portal writes it: words joined by spaces, as in "Control Alt 1",
 * where BlockNote writes "CTRL-ALT-1" or "Mod+B".
 */
export function shortcutText(shortcut: string): string {
  const names: Record<string, string> = { ctrl: "Control", mod: "Control", alt: "Alt", shift: "Shift", cmd: "Command" };
  return shortcut
    .split(/[-+]/)
    .filter((part) => part !== "")
    .map((part) => names[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(" ");
}
