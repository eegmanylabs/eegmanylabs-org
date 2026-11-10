// @ts-check
import { describe, expect, it } from "vitest";
import { buildFirebaseConfig } from "./firebase-config.mjs";
import { firebaseConfigPath, runDirectory, runTemporaryDirectory, webOutputDirectory } from "./paths.mjs";
import {
  DEFAULT_PORT_BASE,
  emulatorEnvironment,
  nearestPortBases,
  PORT_BASE_STEP,
  portsFor,
  resolvePortBase,
} from "./ports.mjs";

describe("resolvePortBase", () => {
  it("defaults to 9100", () => {
    expect(DEFAULT_PORT_BASE).toBe(9100);
    expect(resolvePortBase({})).toBe(9100);
    expect(resolvePortBase({ PORTAL_PORT_BASE: "" })).toBe(9100);
  });

  it("reads PORTAL_PORT_BASE", () => {
    expect(resolvePortBase({ PORTAL_PORT_BASE: "9300" })).toBe(9300);
  });

  it.each(["abc", "9100.5", "80", "1000", "65500", "65400", "-1"])("refuses the value %j", (value) => {
    expect(() => resolvePortBase({ PORTAL_PORT_BASE: value })).toThrow(/PORTAL_PORT_BASE/);
  });

  it.each([
    ["9150", "9100 and 9200"],
    ["9101", "9100 and 9200"],
    ["9299", "9200 and 9300"],
  ])("refuses the value %j, which is no multiple of 100, and names the nearest values: %s", (value, nearest) => {
    expect(() => resolvePortBase({ PORTAL_PORT_BASE: value })).toThrow(
      `must be a multiple of 100, but it is "${value}". The nearest valid values are ${nearest}.`,
    );
  });

  it.each(["1100", "9200", "9300", "65300"])("accepts the multiple of 100 %j", (value) => {
    expect(resolvePortBase({ PORTAL_PORT_BASE: value })).toBe(Number(value));
  });
});

describe("nearestPortBases", () => {
  it("gives the base at or below a number and the one above it, inside the valid range", () => {
    expect(PORT_BASE_STEP).toBe(100);
    expect(nearestPortBases(9150)).toEqual([9100, 9200]);
    expect(nearestPortBases(9200)).toEqual([9200, 9300]);
    expect(nearestPortBases(5)).toEqual([1100, 1200]);
    expect(nearestPortBases(70_000)).toEqual([65200, 65300]);
  });
});

describe("portsFor", () => {
  it("derives the documented ports from the base", () => {
    expect(portsFor(9100)).toMatchObject({
      base: 9100,
      functions: 9101,
      firestore: 9180,
      storage: 9197,
      auth: 9199,
      preview: 9250,
      dev: 9251,
    });
  });

  it("keeps every emulator port inside base..base+99 and gives every service a port of its own", () => {
    const { base, preview, dev, secondOrigin, ...emulators } = portsFor(9300);
    for (const port of Object.values(emulators)) {
      expect(port).toBeGreaterThanOrEqual(base);
      expect(port).toBeLessThanOrEqual(base + 99);
    }
    const all = [preview, dev, secondOrigin, ...Object.values(emulators)];
    expect(new Set(all).size).toBe(all.length);
  });

  it.each([
    [9100, 9200],
    [9100, 9300],
    [9200, 9300],
    [9100, 9000],
  ])("gives the bases %i and %i no port in common", (one, another) => {
    const first = new Set(Object.values(portsFor(one)));
    for (const port of Object.values(portsFor(another))) expect(first.has(port)).toBe(false);
  });

  it("keeps the offsets of the web servers, taken modulo 100, away from every emulator offset", () => {
    // This is what makes neighbouring bases safe: base+150 is offset 50 of the next base.
    const { base, preview, dev, secondOrigin, ...emulators } = portsFor(9100);
    const emulatorOffsets = new Set(Object.values(emulators).map((port) => port - base));
    for (const port of [preview, dev, secondOrigin]) {
      expect(emulatorOffsets.has((port - base) % PORT_BASE_STEP)).toBe(false);
    }
  });
});

describe("emulatorEnvironment", () => {
  it("names the emulators of the given base and the demonstration project", () => {
    expect(emulatorEnvironment(portsFor(9300), "demo-eegml")).toEqual({
      PORTAL_PORT_BASE: "9300",
      GCLOUD_PROJECT: "demo-eegml",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:9380",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9399",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9397",
    });
  });
});

describe("buildFirebaseConfig", () => {
  const config = buildFirebaseConfig(portsFor(9300));

  it("keeps the rules, indexes and functions source of the template", () => {
    expect(config.firestore).toEqual({ rules: "firestore.rules", indexes: "firestore.indexes.json" });
    expect(config.storage).toEqual({ rules: "storage.rules" });
    expect(config.functions).toMatchObject([{ source: "functions" }]);
  });

  it("binds every emulator to the loopback address on a port derived from the base", () => {
    const { ui, singleProjectMode, ...emulators } = config.emulators;
    expect(ui).toEqual({ enabled: false });
    expect(singleProjectMode).toBe(false);
    const names = /** @type {const} */ ([
      "auth",
      "eventarc",
      "firestore",
      "functions",
      "hub",
      "logging",
      "storage",
      "tasks",
    ]);
    expect(Object.keys(emulators).sort()).toEqual([...names].sort());
    for (const name of names) {
      const emulator = config.emulators[name];
      expect(emulator.host).toBe("127.0.0.1");
      expect(emulator.port).toBeGreaterThanOrEqual(9300);
      expect(emulator.port).toBeLessThanOrEqual(9399);
    }
    expect(config.emulators.firestore.websocketPort).toBe(9381);
  });
});

describe("the files of a run", () => {
  it("are all keyed by the port base, so two runs never share one", () => {
    for (const locate of [runDirectory, runTemporaryDirectory, firebaseConfigPath]) {
      expect(locate(9100)).not.toBe(locate(9300));
      expect(locate(9300)).toContain("9300");
    }
    expect(webOutputDirectory("emulator", 9100)).not.toBe(webOutputDirectory("emulator", 9300));
  });

  it("puts staging and production builds in directories of their own", () => {
    expect(webOutputDirectory("staging", 9100)).toMatch(/web\/out\/staging$/);
    expect(webOutputDirectory("production", 9300)).toMatch(/web\/out\/production$/);
  });
});
