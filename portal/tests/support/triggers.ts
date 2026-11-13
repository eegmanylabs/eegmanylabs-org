// Switching the Firestore triggers of the functions emulator off and on, for the integration
// tests of the functions and the end-to-end tests. The sentinels are synthetic.
//
// Switching the triggers on is expensive in a way that grows. The functions emulator loads its
// triggers anew under names that carry a new generation number and registers them with the
// Firestore emulator, which keeps the registrations of every earlier generation. The Firestore
// emulator delivers each event from a single thread, once for every registration that matches,
// and the earlier ones answer nothing. Each switch on therefore adds deliveries to every later
// write: after twelve switches a burst of two hundred writes took four times as long to reach its
// sentinel (docs/TEST_REPORT.md). The suites therefore switch the triggers on as rarely as they
// can: a file that needs no trigger runs with them off, the files that need them run together
// with them on, and the state of the switch is remembered for the emulators of the run.
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import { HUB_URL, PORTS, setBackgroundTriggers } from "./emulators";

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** How long a switch of the triggers may take before it is made again. */
const SWITCH_TIMEOUT_MS = 90_000;
/** How many times a switch of the triggers is made before a set-up or a clean-up gives up. */
const SWITCH_ATTEMPTS = 3;
/**
 * How long the first trigger may take after the triggers were switched on. The emulator is idle
 * then, because they were switched off with its queue empty, so this is the start of one runtime.
 */
const WARM_TIMEOUT_MS = 60_000;

export type TriggerState = "on" | "off";

/**
 * Where the state of the switch is kept: one file for each port base, which names the process of
 * the emulator hub it describes. Emulators that start afresh have their triggers on, so a file
 * that names another process says nothing.
 */
const stateFile = () => path.join(os.tmpdir(), `portal-triggers-${PORTS.base}.json`);

async function hubProcess(): Promise<number | null> {
  try {
    const answer = (await (await fetch(HUB_URL, { signal: AbortSignal.timeout(10_000) })).json()) as { pid?: unknown };
    return typeof answer.pid === "number" ? answer.pid : null;
  } catch {
    return null;
  }
}

/** The state of the switch for the emulators that are running now. */
export async function triggerState(): Promise<TriggerState> {
  const pid = await hubProcess();
  try {
    const stored = JSON.parse(readFileSync(stateFile(), "utf8")) as { pid?: unknown; state?: unknown };
    if (pid !== null && stored.pid === pid && (stored.state === "on" || stored.state === "off")) return stored.state;
  } catch {
    // No state recorded for this base: the emulators started with their triggers on.
  }
  return "on";
}

async function recordState(state: TriggerState): Promise<void> {
  writeFileSync(stateFile(), JSON.stringify({ pid: await hubProcess(), state }));
}

/**
 * Switches the triggers off and waits for the hub to confirm. Switching them off waits for the
 * work the functions emulator holds, so it is the emulator's own signal that it is idle, and it
 * adds no registration. The hub gives up on that wait after a minute and then answers with an
 * error, so a refused switch is made again, a bounded number of times.
 */
export async function switchTriggersOff(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    if (await setBackgroundTriggers(false, SWITCH_TIMEOUT_MS)) {
      await recordState("off");
      return;
    }
    if (attempt >= SWITCH_ATTEMPTS) {
      throw new Error(
        "The emulator hub did not confirm that the triggers are off: work is still running in the functions emulator.",
      );
    }
  }
}

let sentinels = 0;

/** A synthetic document of a collection that the audit trigger records, at a path of its own. */
async function writeSentinel(kind: string) {
  sentinels += 1;
  const sentinel = adminDb.doc(`countCategories/zz-${kind}-${process.pid}-${sentinels}`);
  const now = Timestamp.now();
  await sentinel.set({
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:test",
    updatedBy: "system:test",
    archivedAt: null,
    writeContext: systemWriteContext(),
    key: "zzSentinel",
    label: "Sentinel",
    definition: "A sentinel.",
    position: 999,
    isCore: false,
  });
  return sentinel;
}

async function audited(documentPath: string): Promise<boolean> {
  return (await adminDb.collection("auditEvents").where("documentPath", "==", documentPath).limit(1).get()).size > 0;
}

/**
 * Switches the triggers on and waits until they answer: a sentinel write has been audited and the
 * sentinel removed. When the load of the triggers fails, for example because the discovery of the
 * functions timed out, the hub still answers that the switch was made and every trigger stays
 * off, so the sentinel is what proves the switch. It is waited for with a plain deadline: the
 * triggers were off with the queue empty, so no backlog can delay it, and a sentinel that is not
 * audited in time means that the switch did not take, which is made again.
 */
export async function switchTriggersOn(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    const switched = await setBackgroundTriggers(true, SWITCH_TIMEOUT_MS);
    const sentinel = await writeSentinel("warm");
    const deadline = Date.now() + WARM_TIMEOUT_MS;
    let answered = false;
    while (!answered && Date.now() < deadline) {
      answered = await audited(sentinel.path);
      if (!answered) await pause(100);
    }
    await sentinel.delete();
    if (answered) {
      await recordState("on");
      return;
    }
    if (attempt >= SWITCH_ATTEMPTS) {
      throw new Error(
        `The triggers did not answer within ${WARM_TIMEOUT_MS / 1000} s of being switched on, ${SWITCH_ATTEMPTS} times` +
          `${switched ? "" : ", and the hub did not confirm the switch"}. The functions emulator may have failed to load them.`,
      );
    }
    await switchTriggersOff();
  }
}

/**
 * Brings the triggers to a state, switching only when the emulators are in the other one. A file
 * that asks for the state it finds costs nothing.
 */
export async function ensureTriggers(state: TriggerState): Promise<void> {
  if ((await triggerState()) === state) return;
  if (state === "off") await switchTriggersOff();
  else await switchTriggersOn();
}

/**
 * Waits until the functions emulator has finished the work it holds, by switching the triggers
 * off, which waits for that work, and on again. Each switch on costs a registration (see above),
 * so this is for a set-up that runs once, such as the start of the end-to-end tests.
 */
export async function drainTriggers(): Promise<void> {
  await switchTriggersOff();
  await switchTriggersOn();
}
