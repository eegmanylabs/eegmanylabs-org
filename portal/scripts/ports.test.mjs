// @ts-check
import { describe, expect, it } from "vitest";
import { buildFirebaseConfig } from "./firebase-config.mjs";
import { firebaseConfigPath, runDirectory, runTemporaryDirectory, webOutputDirectory } from "./paths.mjs";
import { DEFAULT_PORT_BASE, emulatorEnvironment, portsFor, resolvePortBase } from "./ports.mjs";

describe("resolvePortBase", () => {
  it("defaults to 9100", () => {
    expect(DEFAULT_PORT_BASE).toBe(9100);
    expect(resolvePortBase({})).toBe(9100);
    expect(resolvePortBase({ PORTAL_PORT_BASE: "" })).toBe(9100);
  });

  it("reads PORTAL_PORT_BASE", () => {
    expect(resolvePortBase({ PORTAL_PORT_BASE: "9300" })).toBe(9300);
  });

  it.each(["abc", "9100.5", "80", "65500", "-1"])("refuses the value %j", (value) => {
    expect(() => resolvePortBase({ PORTAL_PORT_BASE: value })).toThrow(/PORTAL_PORT_BASE/);
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

  it("gives two bases that are 200 apart no port in common", () => {
    const first = new Set(Object.values(portsFor(9100)));
    for (const port of Object.values(portsFor(9300))) expect(first.has(port)).toBe(false);
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
  /** @type {any} */
  const config = buildFirebaseConfig(portsFor(9300));

  it("keeps the rules, indexes and functions source of the template", () => {
    expect(config.firestore).toEqual({ rules: "firestore.rules", indexes: "firestore.indexes.json" });
    expect(config.storage).toEqual({ rules: "storage.rules" });
    expect(config.functions[0].source).toBe("functions");
  });

  it("binds every emulator to the loopback address on a port derived from the base", () => {
    const { ui, singleProjectMode, ...emulators } = config.emulators;
    expect(ui).toEqual({ enabled: false });
    expect(singleProjectMode).toBe(false);
    expect(Object.keys(emulators).sort()).toEqual(
      ["auth", "eventarc", "firestore", "functions", "hub", "logging", "storage", "tasks"].sort(),
    );
    for (const emulator of Object.values(emulators)) {
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
