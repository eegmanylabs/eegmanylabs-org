import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { requireEmulatorTarget, requireRunningEmulators, ToolRefusal } from "./environment";

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

describe("requireRunningEmulators", () => {
  const servers: net.Server[] = [];

  /** Listens on a port the system chooses and returns its address. */
  async function listen(): Promise<string> {
    const server = net.createServer();
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  }

  /** An address where nothing listens: a port that was open a moment ago and is closed again. */
  async function closedAddress(): Promise<string> {
    const address = await listen();
    const server = servers.pop() as net.Server;
    await new Promise((resolve) => server.close(resolve));
    return address;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it("passes when both emulators accept connections", async () => {
    const target = { projectId: "demo-eegml", firestoreHost: await listen(), authHost: await listen() };
    await expect(requireRunningEmulators(target, {})).resolves.toBeUndefined();
  });

  it("refuses, naming the port base and the way to start them, when nothing is listening", async () => {
    const target = { projectId: "demo-eegml", firestoreHost: await closedAddress(), authHost: await closedAddress() };
    const refusal = await requireRunningEmulators(target, { PORTAL_PORT_BASE: "9300" }).catch((error) => error);
    expect(refusal).toBeInstanceOf(ToolRefusal);
    expect(refusal.message).toContain("the emulators of PORTAL_PORT_BASE=9300 are not running");
    expect(refusal.message).toContain(`${target.firestoreHost} (Firestore)`);
    expect(refusal.message).toContain(`${target.authHost} (Authentication)`);
    expect(refusal.message).toContain("`npm run emulators`");
  });

  it("names only the emulator that is down", async () => {
    const target = { projectId: "demo-eegml", firestoreHost: await listen(), authHost: await closedAddress() };
    const refusal = await requireRunningEmulators(target, {}).catch((error) => error);
    expect(refusal).toBeInstanceOf(ToolRefusal);
    expect(refusal.message).toContain("(Authentication)");
    expect(refusal.message).not.toContain("(Firestore)");
    expect(refusal.message).not.toContain("PORTAL_PORT_BASE");
  });

  it("refuses an address that is not a host and a port", async () => {
    const target = { projectId: "demo-eegml", firestoreHost: "not-an-address", authHost: await listen() };
    await expect(requireRunningEmulators(target, {})).rejects.toBeInstanceOf(ToolRefusal);
  });
});
