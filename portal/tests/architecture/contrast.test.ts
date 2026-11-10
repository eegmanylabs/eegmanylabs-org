// Contrast of every colour pair the interface uses, computed from the token values.
//
// WCAG 2.2 AA asks for 4.5 to 1 for text, 3 to 1 for large text and 3 to 1 for the boundaries
// and indicators that are needed to recognise an interface component or its state. The table
// below names each pair of colour tokens that meets in the interface. A second set of tests
// reads the source and fails when a colour utility is used that the table does not cover, so a
// new combination cannot enter the interface without being measured here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColour, readTokens, TOKENS_FILE } from "../../web/config/tokens";
import { isTest, sourceFiles } from "./support";

type Kind = "text" | "large-text" | "boundary";

/** The lowest ratio WCAG 2.2 AA accepts for each kind of pair. */
const REQUIRED: Record<Kind, number> = { text: 4.5, "large-text": 3, boundary: 3 };

interface Pair {
  /** The colour of the text, the border, the outline or the indicator. A colour name of the theme. */
  readonly foreground: string;
  /** The colour it lies on. */
  readonly background: string;
  readonly kind: Kind;
  /** Where the two meet. */
  readonly where: string;
}

const text = (foreground: string, backgrounds: readonly string[], where: string): Pair[] =>
  backgrounds.map((background) => ({ foreground, background, kind: "text", where }));
const boundary = (foreground: string, backgrounds: readonly string[], where: string): Pair[] =>
  backgrounds.map((background) => ({ foreground, background, kind: "boundary", where }));

const PAIRS: readonly Pair[] = [
  ...text("fg", ["background", "surface", "surface-muted", "surface-accent"], "body text, titles, table cells"),
  ...text("fg-strong", ["background", "surface", "surface-muted", "surface-accent"], "headings, outline buttons"),
  ...text(
    "fg-secondary",
    ["background", "surface", "surface-muted", "surface-accent"],
    "labels, descriptions, navigation",
  ),
  ...text("fg-muted", ["background", "surface", "surface-muted"], "hints, placeholders, table headers"),
  ...text("fg-accent", ["background", "surface", "surface-muted", "surface-accent"], "field errors, hovered links"),
  ...text("fg-inverse", ["surface-inverse"], "tooltips"),
  ...text("fg-on-accent", ["accent-strong", "accent-strong-hover"], "primary buttons, skip link, solid badges"),
  ...text("tag-accent-fg", ["tag-accent-bg"], "accent badges"),
  ...text("tag-neutral-fg", ["tag-neutral-bg"], "neutral badges"),

  ...boundary("border-strong", ["background", "surface"], "text fields, menus, notifications, empty states"),
  ...boundary("border-emphasis", ["background", "surface", "surface-muted"], "outline buttons"),
  ...boundary("accent-strong", ["background", "surface"], "primary buttons, invalid fields, failure notifications"),
  ...boundary("accent-strong-hover", ["background", "surface"], "hovered primary buttons"),
  ...boundary("accent", ["background", "surface", "surface-accent"], "current-page bar, current tab, error bar"),
  ...boundary("focus", ["background", "surface", "surface-muted", "surface-accent"], "the focus outline"),
];

/**
 * Colours that carry no information by themselves, with the reason. A component never relies
 * on one of these alone to be recognised.
 */
const DECORATIVE: Readonly<Record<string, string>> = {
  border: "Hairlines between rows and around panels. Controls use border-strong or border-emphasis.",
  scrim: "The dimmed page behind a dialog.",
};

const themeSource = readFileSync(TOKENS_FILE, "utf8");
const tokens = readTokens();

/** Colour names of the Tailwind theme, each with its value: `bg-surface` uses the name "surface". */
const themeColours = new Map<string, string>();
for (const [, name, token] of themeSource.matchAll(/--color-([\w-]+):\s*var\(--([\w-]+)\)/g)) {
  const value = tokens.get(token ?? "");
  if (name && value !== undefined) themeColours.set(name, value);
}

const ratio = (pair: Pick<Pair, "foreground" | "background">) => {
  const foreground = themeColours.get(pair.foreground);
  const background = themeColours.get(pair.background);
  if (foreground === undefined || background === undefined) {
    throw new Error(`The theme has no colour named ${foreground === undefined ? pair.foreground : pair.background}.`);
  }
  return contrastRatio(parseColour(foreground), parseColour(background));
};

/** Every colour utility in the class names of the web application, as `[utility, colour name, file]`. */
function colourUtilities(): { utility: string; colour: string; classes: string; file: string }[] {
  const found: { utility: string; colour: string; classes: string; file: string }[] = [];
  const files = sourceFiles("web/src").filter((file) => !isTest(file) && /\.tsx?$/.test(file.path));
  for (const file of files) {
    for (const literal of file.text.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      const classes = literal[1] ?? "";
      for (const candidate of classes.split(/\s+/)) {
        // Variants such as hover: and aria-[current=page]:before: come first and are dropped.
        const match = /(?:^|:)(text|bg|border|outline)-([a-z][a-z-]*)$/.exec(candidate);
        if (!match?.[1] || !match[2] || !themeColours.has(match[2])) continue;
        found.push({ utility: match[1], colour: match[2], classes, file: file.path });
      }
    }
  }
  return found;
}

describe("the colour tokens", () => {
  it("are all read from tokens.css", () => {
    expect(themeColours.size).toBeGreaterThan(20);
    expect(themeColours.get("accent")).toBe("#d84b4d");
    expect(themeColours.get("accent-strong")).toBe("#a9353a");
    expect(themeColours.get("background")).toBe("#fcf9f7");
    expect(themeColours.get("fg")).toBe("#302a2a");
  });

  it("contain no green", () => {
    for (const [name, value] of themeColours) {
      const { red, green, blue } = parseColour(value);
      // Green dominates neither of the other two channels in any colour of the portal.
      expect(green > red && green > blue, `${name}: ${value}`).toBe(false);
    }
  });
});

describe("contrast", () => {
  it.each(PAIRS.map((pair) => [`${pair.foreground} on ${pair.background}`, pair.kind, pair] as const))(
    "%s is enough for %s",
    (_label, _kind, pair) => {
      const measured = ratio(pair);
      expect(
        measured,
        `${pair.foreground} on ${pair.background} (${pair.where}) is ${measured.toFixed(2)} to 1`,
      ).toBeGreaterThanOrEqual(REQUIRED[pair.kind]);
    },
  );

  it("applies the thresholds of WCAG 2.2 AA", () => {
    expect(REQUIRED).toEqual({ text: 4.5, "large-text": 3, boundary: 3 });
  });

  it("confirms decision D-018: white on coral is enough for large text only, and white on deep coral for any text", () => {
    const onCoral = ratio({ foreground: "fg-on-accent", background: "accent" });
    expect(onCoral).toBeGreaterThanOrEqual(REQUIRED["large-text"]);
    expect(onCoral).toBeLessThan(REQUIRED.text);
    expect(ratio({ foreground: "fg-on-accent", background: "accent-strong" })).toBeGreaterThanOrEqual(REQUIRED.text);
  });
});

describe("the colour utilities in the source", () => {
  const used = colourUtilities();
  const covered = (kind: "text" | "boundary", role: "foreground" | "background") =>
    new Set(PAIRS.filter((pair) => (kind === "text") === (pair.kind !== "boundary")).map((pair) => pair[role]));

  it("are found by the scan", () => {
    expect(used.length).toBeGreaterThan(50);
    expect(used.some((use) => use.utility === "bg" && use.colour === "accent-strong")).toBe(true);
    expect(used.some((use) => use.utility === "border" && use.colour === "border-strong")).toBe(true);
    expect(used.some((use) => use.utility === "outline" && use.colour === "focus")).toBe(true);
  });

  it("use only text colours whose contrast is measured above", () => {
    const measured = covered("text", "foreground");
    const unmeasured = used
      .filter((use) => use.utility === "text" && !measured.has(use.colour) && !(use.colour in DECORATIVE))
      .map((use) => `${use.file}: text-${use.colour}`);
    expect(unmeasured).toEqual([]);
  });

  it("use only background colours that text or a boundary is measured against, or that are indicators themselves", () => {
    const backgrounds = new Set([...covered("text", "background"), ...covered("boundary", "background")]);
    const indicators = covered("boundary", "foreground");
    const unmeasured = used
      .filter((use) => use.utility === "bg")
      .filter((use) => !backgrounds.has(use.colour) && !indicators.has(use.colour) && !(use.colour in DECORATIVE))
      .map((use) => `${use.file}: bg-${use.colour}`);
    expect(unmeasured).toEqual([]);
  });

  it("use only border and outline colours whose contrast is measured above, or that are decoration", () => {
    const measured = covered("boundary", "foreground");
    const unmeasured = used
      .filter((use) => use.utility === "border" || use.utility === "outline")
      .filter((use) => !measured.has(use.colour) && !(use.colour in DECORATIVE))
      .map((use) => `${use.file}: ${use.utility}-${use.colour}`);
    expect(unmeasured).toEqual([]);
  });

  it("never put a white label on the coral accent, which is too light for small text", () => {
    const offenders = used
      .filter((use) => use.utility === "bg" && (use.colour === "accent" || use.colour === "accent-hover"))
      .filter((use) => /(?:^|[\s:])text-fg-on-accent(?:\s|$)/.test(use.classes))
      .map((use) => `${use.file}: ${use.classes}`);
    expect(offenders).toEqual([]);
  });

  it("measure nothing that the theme does not define", () => {
    for (const pair of PAIRS) {
      expect(themeColours.has(pair.foreground), pair.foreground).toBe(true);
      expect(themeColours.has(pair.background), pair.background).toBe(true);
    }
  });
});
