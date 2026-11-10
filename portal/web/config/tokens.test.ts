import { describe, expect, it } from "vitest";
import {
  composite,
  contrastRatio,
  parseColour,
  parseCustomProperties,
  readTokens,
  relativeLuminance,
  resolveCustomProperty,
} from "./tokens.ts";

const white = parseColour("#ffffff");
const black = parseColour("#000000");

describe("parseCustomProperties", () => {
  it("reads the declarations of every :root block and nothing outside them", () => {
    const css = `
      :root { --paper: #fcf9f7; --sans: "DM Sans Variable", Arial, sans-serif; }
      /* :root { --ghost: #000000; } */
      @theme { --color-background: var(--background); }
      :root {
        --background: var(--paper);
      }
    `;
    expect([...parseCustomProperties(css)]).toEqual([
      ["paper", "#fcf9f7"],
      ["sans", '"DM Sans Variable", Arial, sans-serif'],
      ["background", "var(--paper)"],
    ]);
  });
});

describe("resolveCustomProperty", () => {
  const properties = new Map([
    ["ink", "#302a2a"],
    ["fg", "var(--ink)"],
    ["text", "var( --fg )"],
    ["loop-a", "var(--loop-b)"],
    ["loop-b", "var(--loop-a)"],
  ]);

  it("follows references until a value is reached", () => {
    expect(resolveCustomProperty(properties, "text")).toBe("#302a2a");
  });

  it("names a token that does not exist", () => {
    expect(() => resolveCustomProperty(properties, "missing")).toThrow("--missing");
  });

  it("refuses a token that refers to itself", () => {
    expect(() => resolveCustomProperty(properties, "loop-a")).toThrow(/refers to itself/);
  });
});

describe("parseColour", () => {
  it.each([
    ["#302a2a", { red: 48, green: 42, blue: 42, alpha: 1 }],
    ["#FFF", { red: 255, green: 255, blue: 255, alpha: 1 }],
    ["rgb(48 42 42 / 0.35)", { red: 48, green: 42, blue: 42, alpha: 0.35 }],
    ["rgb(255 255 255 / 76%)", { red: 255, green: 255, blue: 255, alpha: 0.76 }],
    ["rgb(0, 128, 255)", { red: 0, green: 128, blue: 255, alpha: 1 }],
  ])("understands %s", (value, colour) => {
    expect(parseColour(value)).toEqual(colour);
  });

  it.each(["coral", "#12345", "hsl(0 0% 0%)", "var(--ink)"])("refuses %s", (value) => {
    expect(() => parseColour(value)).toThrow(/not a colour/);
  });
});

describe("contrastRatio", () => {
  it("gives the two ends of the scale", () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBe(1);
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
  });

  it("does not depend on which of the two is the lighter one", () => {
    const coral = parseColour("#d84b4d");
    expect(contrastRatio(coral, white)).toBe(contrastRatio(white, coral));
  });

  it("gives the two figures that decision D-018 records", () => {
    expect(contrastRatio(white, parseColour("#d84b4d"))).toBeCloseTo(4.17, 2);
    expect(contrastRatio(white, parseColour("#a9353a"))).toBeCloseTo(6.45, 2);
  });

  it("measures a translucent foreground as it appears on its background", () => {
    const halfWhite = parseColour("rgb(255 255 255 / 0.5)");
    expect(composite(halfWhite, black)).toEqual({ red: 127.5, green: 127.5, blue: 127.5, alpha: 1 });
    expect(contrastRatio(halfWhite, black)).toBeLessThan(contrastRatio(white, black));
    expect(contrastRatio(parseColour("rgb(255 255 255 / 0)"), black)).toBe(1);
  });

  it("refuses a background that is not opaque", () => {
    expect(() => contrastRatio(black, parseColour("rgb(255 255 255 / 0.5)"))).toThrow(/opaque/);
  });
});

describe("readTokens", () => {
  it("reads the portal's tokens with every reference resolved", () => {
    const tokens = readTokens();
    expect(tokens.get("ink-950")).toBe("#302a2a");
    expect(tokens.get("fg")).toBe("#302a2a");
    expect(tokens.get("accent-strong")).toBe("#a9353a");
    expect(tokens.get("focus-ring")).toBe("#d84b4d");
    for (const value of tokens.values()) expect(value).not.toContain("var(");
  });
});
