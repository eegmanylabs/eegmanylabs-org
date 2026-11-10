import { describe, expect, it } from "vitest";
import { requireEmulatorTarget, ToolRefusal } from "./environment";

const emulators = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:9180",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
};

describe("requireEmulatorTarget", () => {
  it("accepts the emulators and defaults to the demonstration project", () => {
    expect(requireEmulatorTarget(emulators)).toEqual({
      projectId: "demo-eegml",
      firestoreHost: "127.0.0.1:9180",
      authHost: "127.0.0.1:9199",
    });
  });

  it("refuses when no emulator variable is set", () => {
    expect(() => requireEmulatorTarget({})).toThrow(ToolRefusal);
    expect(() => requireEmulatorTarget({})).toThrow(
      /FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are not set/,
    );
  });

  it.each([
    ["FIRESTORE_EMULATOR_HOST", { FIREBASE_AUTH_EMULATOR_HOST: emulators.FIREBASE_AUTH_EMULATOR_HOST }],
    ["FIREBASE_AUTH_EMULATOR_HOST", { FIRESTORE_EMULATOR_HOST: emulators.FIRESTORE_EMULATOR_HOST }],
    ["FIRESTORE_EMULATOR_HOST", { ...emulators, FIRESTORE_EMULATOR_HOST: "  " }],
  ])("refuses when only %s is missing", (name, env) => {
    expect(() => requireEmulatorTarget(env)).toThrow(new RegExp(`${name} is not set`));
  });

  it("refuses a project that is not a demonstration project, even with the emulators set", () => {
    expect(() => requireEmulatorTarget({ ...emulators, GCLOUD_PROJECT: "eegmanylabs-portal" })).toThrow(
      /not a demonstration project/,
    );
  });
});
