// @ts-check
// Stopping a run stops everything the run started. These tests start the real launcher
// (scripts/emulators.mjs run) around a small process tree and interrupt it the way a timeout
// or a person does.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PORTAL_ROOT } from "./paths.mjs";
import { groupAlive, processAlive, signalGroup, stopGraceFrom, stopGroup, straysOf } from "./process-group.mjs";

const LAUNCHER = path.join(PORTAL_ROOT, "scripts", "emulators.mjs");
const TREE = path.join(PORTAL_ROOT, "scripts", "test-support", "process-tree.mjs");

/** @type {{ directory: string, pids: number[] }[]} */
const started = [];

afterEach(() => {
  for (const { directory, pids } of started.splice(0)) {
    // Whatever a failed test left behind must not outlive it.
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone, which is what the test was about.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // A process that has ended and has not been collected yet still answers. It runs nothing.
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z";
  } catch {
    return true;
  }
}

/**
 * Whether the child of the tree still answers on its port. The answer is decided by the
 * greeting of the tree's own socket, never by the port alone: once the child has gone, the
 * system may give the same port to a socket that another test opens, and that socket neither
 * sends the greeting nor belongs to the tree.
 * @param {{ port: number, child: number }} tree
 * @returns {Promise<boolean>}
 */
function listening(tree) {
  const greeting = `process-tree ${tree.child}\n`;
  return new Promise((resolve) => {
    let received = "";
    const socket = net.connect({ host: "127.0.0.1", port: tree.port });
    const finish = (/** @type {boolean} */ answer) => {
      socket.destroy();
      resolve(answer);
    };
    // A socket of another process may accept and say nothing: it is not the tree's.
    socket.setTimeout(2_000, () => finish(false));
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
      if (received.length >= greeting.length) finish(received.startsWith(greeting));
    });
    socket.once("end", () => finish(received.startsWith(greeting)));
    socket.once("error", () => finish(false));
  });
}

/**
 * @param {() => boolean} condition
 * @param {number} [timeoutMs]
 */
async function until(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("The condition did not come true in time.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Starts the launcher around the process tree and waits until the tree is up.
 * @param {Record<string, string>} [env]
 */
async function launch(env = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "eegml-process-group-"));
  const report = path.join(directory, "tree.json");
  const launcher = spawn(process.execPath, [LAUNCHER, "run", process.execPath, TREE, report], {
    stdio: "ignore",
    env: { ...process.env, PORTAL_STOP_GRACE_MS: "300", ...env },
  });
  /** @type {Promise<number | null>} */
  const exited = new Promise((resolve) => launcher.on("exit", (code) => resolve(code)));
  const record = { directory, pids: /** @type {number[]} */ ([launcher.pid]) };
  started.push(record);
  await until(() => existsSync(report) && readFileSync(report, "utf8").endsWith("}"));
  const tree = /** @type {{ parent: number, child: number, port: number }} */ (
    JSON.parse(readFileSync(report, "utf8"))
  );
  record.pids.push(tree.parent, tree.child);
  return { launcher, exited, tree };
}

describe("a run that is interrupted", () => {
  it.each(
    /** @type {const} */ ([
      ["SIGTERM", 143],
      ["SIGINT", 130],
    ]),
  )("stops the command and what the command started when the launcher receives %s", async (signal, status) => {
    const { launcher, exited, tree } = await launch();
    expect(alive(tree.parent)).toBe(true);
    expect(alive(tree.child)).toBe(true);
    expect(await listening(tree)).toBe(true);

    launcher.kill(signal);

    expect(await exited).toBe(status);
    expect(alive(tree.parent)).toBe(false);
    expect(alive(tree.child)).toBe(false);
    expect(await listening(tree)).toBe(false);
  });

  it("kills processes that ignore the interrupt and the termination signal, and only then ends", async () => {
    const { launcher, exited, tree } = await launch({ STUBBORN: "1" });
    const began = Date.now();

    launcher.kill("SIGTERM");

    expect(await exited).toBe(143);
    // The grace period of this test is 300 ms for each of the two polite signals.
    expect(Date.now() - began).toBeGreaterThanOrEqual(500);
    expect(alive(tree.parent)).toBe(false);
    expect(alive(tree.child)).toBe(false);
    expect(await listening(tree)).toBe(false);
  });
});

describe("a run whose command started a process outside its group", () => {
  it("stops that process too: it gets the later signals directly once the grace period is over", async () => {
    const { launcher, exited, tree } = await launch({ STRAY: "1" });
    const began = Date.now();

    launcher.kill("SIGINT");

    expect(await exited).toBe(130);
    // The interrupt went to the group alone, so the process outside it lived for the grace period.
    expect(Date.now() - began).toBeGreaterThanOrEqual(250);
    expect(alive(tree.parent)).toBe(false);
    expect(alive(tree.child)).toBe(false);
    expect(await listening(tree)).toBe(false);
  });

  it("kills it when it ignores every polite signal", async () => {
    const { launcher, exited, tree } = await launch({ STRAY: "1", STUBBORN: "1" });

    launcher.kill("SIGTERM");

    expect(await exited).toBe(143);
    expect(alive(tree.parent)).toBe(false);
    expect(alive(tree.child)).toBe(false);
    expect(await listening(tree)).toBe(false);
  });
});

describe("straysOf", () => {
  it("finds the descendants of a group's first process that have a group of their own, and no others", async () => {
    const { launcher, exited, tree } = await launch({ STRAY: "1" });
    try {
      // The launcher starts the tree in a group of its own, whose first process is the parent.
      expect(straysOf(tree.parent)).toEqual([tree.child]);
      expect(processAlive(tree.child)).toBe(true);
    } finally {
      launcher.kill("SIGTERM");
      await exited;
    }
    expect(processAlive(tree.child)).toBe(false);
    expect(straysOf(tree.parent)).toEqual([]);
  });

  it("finds none in a tree whose processes all stayed in the group", async () => {
    const { launcher, exited, tree } = await launch();
    try {
      expect(straysOf(tree.parent)).toEqual([]);
    } finally {
      launcher.kill("SIGTERM");
      await exited;
    }
  });
});

describe("a run that ends by itself", () => {
  it("ends with the status of the command and stops what the command left running", async () => {
    const { exited, tree } = await launch({ LEAVE_ORPHAN: "7" });

    expect(await exited).toBe(7);
    expect(alive(tree.child)).toBe(false);
    expect(await listening(tree)).toBe(false);
  });
});

describe("stopGroup", () => {
  it("resolves at once for a group that does not exist", async () => {
    // The highest process identifier Linux can give out is far below this one.
    expect(signalGroup(2 ** 30, 0)).toBe(false);
    expect(groupAlive(2 ** 30)).toBe(false);
    await expect(stopGroup(2 ** 30)).resolves.toBeUndefined();
  });
});

describe("stopGraceFrom", () => {
  it("is fifteen seconds unless PORTAL_STOP_GRACE_MS gives a positive number", () => {
    expect(stopGraceFrom({})).toBe(15_000);
    expect(stopGraceFrom({ PORTAL_STOP_GRACE_MS: "250" })).toBe(250);
    expect(stopGraceFrom({ PORTAL_STOP_GRACE_MS: "soon" })).toBe(15_000);
    expect(stopGraceFrom({ PORTAL_STOP_GRACE_MS: "0" })).toBe(15_000);
  });
});
