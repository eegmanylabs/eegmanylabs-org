// @ts-check
// Starting a command in a process group of its own, and stopping that whole group.
//
// The commands the portal's scripts start have children of their own: the Firebase tools start
// the emulators and the test script, which starts a test runner, a preview server and a
// browser. A signal sent to the first process alone leaves the rest running, where they keep
// ports busy for the next run. Everything here therefore signals the group, and follows up on
// processes that were started outside it.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

/** How long a group gets to stop after the interrupt before it is asked more firmly. */
export const STOP_GRACE_MS = 15_000;
/** How long a group gets after the termination signal before it is killed. */
export const TERMINATE_GRACE_MS = 5_000;
/** The longest `runToCompletion` takes to stop its group, for callers that wait for it. */
export const LONGEST_STOP_MS = STOP_GRACE_MS + TERMINATE_GRACE_MS + 2_000;

const POLL_MS = 50;

/** Conventional exit status of a process that ended because of a signal. */
const SIGNAL_STATUS = /** @type {const} */ ({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

/**
 * Sends a signal to every process of a group. Returns false when the group is already gone.
 * @param {number} groupId The process identifier of the group's first process.
 * @param {NodeJS.Signals | 0} signal
 */
export function signalGroup(groupId, signal) {
  try {
    process.kill(-groupId, signal);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH") return false;
    throw error;
  }
}

/**
 * State, parent and group of every process, read from /proc. Null where there is no /proc.
 * @returns {Map<number, { state: string, parent: number, group: number }> | null}
 */
function processTable() {
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return null;
  }
  const table = new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch {
      continue;
    }
    // "pid (name) state parent group ...": the name may contain spaces and brackets.
    const [state = "", parent, group] = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
    table.set(Number(entry), { state, parent: Number(parent), group: Number(group) });
  }
  return table;
}

// A process that has ended and that its parent has not collected yet still accepts signals.
// It runs nothing and holds no port, so it does not count as running. Linux shows the
// difference in /proc. Where there is no /proc, the answer of the signal stands.
const ENDED = "Z";

/**
 * Whether any process of a group is still running.
 * @param {number} groupId
 */
export function groupAlive(groupId) {
  if (!signalGroup(groupId, 0)) return false;
  const table = processTable();
  if (table === null) return true;
  for (const { state, group } of table.values()) {
    if (group === groupId && state !== ENDED) return true;
  }
  return false;
}

/**
 * Whether one process is still running.
 * @param {number} pid
 */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const table = processTable();
  return table === null || (table.has(pid) && table.get(pid)?.state !== ENDED);
}

/**
 * The processes that descend from the first process of a group and have left the group. The
 * Firestore emulator is one: the Firebase tools start it as the leader of a session of its
 * own, so a signal to the group does not reach it. Empty where there is no /proc.
 * @param {number} groupId
 * @returns {number[]}
 */
export function straysOf(groupId) {
  const table = processTable();
  if (table === null) return [];
  /** @type {Map<number, number[]>} */
  const children = new Map();
  for (const [pid, { parent }] of table) children.set(parent, [...(children.get(parent) ?? []), pid]);
  const strays = [];
  const queue = [groupId];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
    for (const child of children.get(pid) ?? []) {
      queue.push(child);
      if (table.get(child)?.group !== groupId) strays.push(child);
    }
  }
  return strays;
}

/**
 * @param {() => boolean} condition
 * @param {number} waitMs
 * @returns {Promise<boolean>} True as soon as the condition holds, false when the wait is over.
 */
function holdsWithin(condition, waitMs) {
  const deadline = Date.now() + waitMs;
  return new Promise((resolve) => {
    const check = () => {
      if (condition()) resolve(true);
      else if (Date.now() >= deadline) resolve(false);
      else setTimeout(check, POLL_MS);
    };
    check();
  });
}

/**
 * Stops a whole process group, and the processes its members started outside the group: an
 * interrupt first, so that every process can shut down cleanly, then a termination signal,
 * and finally a kill that cannot be ignored. Resolves when none of them is left.
 *
 * The interrupt goes to the group alone. A process that started something outside the group
 * is expected to stop it in its own way, as the Firebase tools stop their emulators. What is
 * still there after the grace period gets the later signals directly.
 * @param {number} groupId
 * @param {{ graceMs?: number, terminateGraceMs?: number, first?: NodeJS.Signals }} [options]
 */
export async function stopGroup(groupId, options = {}) {
  const { graceMs = STOP_GRACE_MS, terminateGraceMs = TERMINATE_GRACE_MS, first = "SIGINT" } = options;
  // Noted before each signal, while the parents that lead to them are still alive.
  /** @type {Set<number>} */
  const strays = new Set();
  const noteStrays = () => {
    for (const pid of straysOf(groupId)) strays.add(pid);
  };
  /** @param {NodeJS.Signals} signal */
  const signalStrays = (signal) => {
    for (const pid of strays) {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  };
  const gone = () => !groupAlive(groupId) && ![...strays].some(processAlive);

  noteStrays();
  if (!signalGroup(groupId, first) && strays.size === 0) return;
  if (first !== "SIGINT") signalStrays(first);
  if (await holdsWithin(gone, graceMs)) return;
  if (first !== "SIGTERM") {
    noteStrays();
    signalGroup(groupId, "SIGTERM");
    signalStrays("SIGTERM");
    if (await holdsWithin(gone, terminateGraceMs)) return;
  }
  noteStrays();
  signalGroup(groupId, "SIGKILL");
  signalStrays("SIGKILL");
  await holdsWithin(gone, 5_000);
}

/**
 * The grace period of this run. Tests shorten it through PORTAL_STOP_GRACE_MS.
 * @param {Record<string, string | undefined>} [env]
 */
export function stopGraceFrom(env = process.env) {
  const value = Number(env.PORTAL_STOP_GRACE_MS);
  return Number.isFinite(value) && value > 0 ? value : STOP_GRACE_MS;
}

/**
 * Runs a command in a process group of its own and ends this process with the command's status.
 *
 * A termination signal to this process stops the whole group, however deep its process tree
 * is, and this process only ends once the group is gone. When the command ends by itself and
 * leaves processes behind, those are stopped as well. `cleanup` runs last, when nothing of the
 * group is running any more.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   spawnOptions?: import("node:child_process").SpawnOptions,
 *   cleanup?: () => void,
 *   onStartFailure?: (error: Error) => void,
 * }} [options]
 */
export function runToCompletion(command, args, options = {}) {
  const { spawnOptions = {}, cleanup = () => {}, onStartFailure } = options;
  const graceMs = stopGraceFrom();
  // A group of its own: Ctrl-C in a terminal then reaches the group once, through the handler
  // below, and the group can be addressed as a whole.
  const child = spawn(command, args, { stdio: "inherit", ...spawnOptions, detached: true });
  const groupId = child.pid;

  /** @type {number | null} */
  let childStatus = null;
  /** @type {NodeJS.Signals | null} */
  let stopSignal = null;
  let finishing = false;

  const finish = () => {
    if (finishing) return;
    finishing = true;
    try {
      cleanup();
    } finally {
      process.exit(
        stopSignal ? SIGNAL_STATUS[/** @type {keyof typeof SIGNAL_STATUS} */ (stopSignal)] : (childStatus ?? 1),
      );
    }
  };

  for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
    process.on(signal, () => {
      if (groupId === undefined) return;
      if (stopSignal !== null) {
        // Asked again: stop waiting for a clean shutdown.
        signalGroup(groupId, "SIGKILL");
        return;
      }
      stopSignal = signal;
      const terminateGraceMs = Math.min(TERMINATE_GRACE_MS, graceMs);
      void stopGroup(groupId, { graceMs, terminateGraceMs }).then(finish);
    });
  }

  child.on("error", (error) => {
    if (onStartFailure) onStartFailure(error);
    else console.error(`Could not start ${command}: ${error.message}`);
    childStatus = 1;
    finish();
  });
  child.on("exit", (code, signal) => {
    childStatus = code ?? (signal ? 1 : 0);
    if (stopSignal !== null || groupId === undefined) return;
    // The command ended by itself. Anything it left running goes too, without the long grace.
    void stopGroup(groupId, { first: "SIGTERM", graceMs: Math.min(TERMINATE_GRACE_MS, graceMs) }).then(finish);
  });
}
