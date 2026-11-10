// Reads the design tokens out of src/styles/tokens.css, so that the few places outside the
// stylesheet that need a colour (the theme-colour meta element, the page for unknown addresses,
// the contrast test) take it from the one file that defines it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TOKENS_FILE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));

/** The custom properties declared in the `:root` blocks of a stylesheet, by name without the dashes. */
export function parseCustomProperties(css: string): Map<string, string> {
  const properties = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const declaration of (block[1] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      const [, name, value] = declaration;
      if (name && value) properties.set(name, value.trim());
    }
  }
  return properties;
}

/** The value of a custom property with every `var(--other)` in it replaced by that property's value. */
export function resolveCustomProperty(properties: ReadonlyMap<string, string>, name: string): string {
  const seen = new Set<string>();
  const resolve = (current: string): string => {
    if (seen.has(current)) throw new Error(`The token --${current} refers to itself.`);
    seen.add(current);
    const value = properties.get(current);
    if (value === undefined) throw new Error(`There is no token named --${current} in tokens.css.`);
    const resolved = value.replace(/var\(\s*--([\w-]+)\s*\)/g, (_match, inner: string) => resolve(inner));
    seen.delete(current);
    return resolved;
  };
  return resolve(name);
}

/** Every token of the portal with its final value. */
export function readTokens(file: string = TOKENS_FILE): Map<string, string> {
  const properties = parseCustomProperties(readFileSync(file, "utf8"));
  return new Map([...properties.keys()].map((name) => [name, resolveCustomProperty(properties, name)]));
}

/** A colour with channels from 0 to 255 and an opacity from 0 to 1. */
export interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Understands the two notations tokens.css uses: hexadecimal, and `rgb(r g b / a)`. */
export function parseColour(value: string): Colour {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const channel = (start: number) => Number.parseInt(full.slice(start, start + 2), 16);
    return { red: channel(0), green: channel(2), blue: channel(4), alpha: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const [, red, green, blue, alpha] = rgb;
    const opacity = alpha === undefined ? 1 : alpha.endsWith("%") ? Number.parseFloat(alpha) / 100 : Number(alpha);
    return { red: Number(red), green: Number(green), blue: Number(blue), alpha: opacity };
  }
  throw new Error(`"${value}" is not a colour in a notation that tokens.css uses.`);
}

/** What is seen when a colour that may be translucent lies on an opaque one. */
export function composite(foreground: Colour, background: Colour): Colour {
  const mix = (over: number, under: number) => over * foreground.alpha + under * (1 - foreground.alpha);
  return {
    red: mix(foreground.red, background.red),
    green: mix(foreground.green, background.green),
    blue: mix(foreground.blue, background.blue),
    alpha: 1,
  };
}

/** Relative luminance as WCAG 2.2 defines it. */
export function relativeLuminance(colour: Colour): number {
  const linear = (channel: number) => {
    const share = channel / 255;
    return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(colour.red) + 0.7152 * linear(colour.green) + 0.0722 * linear(colour.blue);
}

/** The WCAG 2.2 contrast ratio of a foreground on an opaque background, from 1 to 21. */
export function contrastRatio(foreground: Colour, background: Colour): number {
  if (background.alpha !== 1) throw new Error("A contrast ratio needs an opaque background.");
  const first = relativeLuminance(composite(foreground, background));
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
