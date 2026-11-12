// Where a fake keeps its state. Unit tests keep it in memory. In the emulator, every function
// runs in a process of its own and a browser test edits the "external" side from yet another,
// so the state is a JSON file in the run's temporary directory, read and written under a lock.
// The fake of Google Workspace and the fake of the storage servers both keep their state this
// way. Nothing here is ever used outside the emulator and the tests.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FakeState } from "./state";

export interface FakeStore<S = FakeState> {
  /** Runs `change` on the current state and keeps what it leaves, as one step no other process interleaves with. */
  transact<T>(change: (state: S) => T): T;
}

/** A store in memory, for unit tests. */
export class MemoryStore<S = FakeState> implements FakeStore<S> {
  constructor(private state: S) {}

  transact<T>(change: (state: S) => T): T {
    // A copy, so that a change that throws half-way leaves the state as it was.
    const draft = structuredClone(this.state);
    const result = change(draft);
    this.state = draft;
    return result;
  }
}

const LOCK_WAIT_MS = 10_000;
const STALE_LOCK_MS = 15_000;

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * A store in a JSON file, shared by the processes of one emulator run. A lock directory makes
 * each change atomic: `mkdir` either creates it or fails, on every platform. A lock older than
 * a change could take is taken to belong to a process that died, and is broken.
 */
export class FileStore<S = FakeState> implements FakeStore<S> {
  private readonly lock: string;

  constructor(
    private readonly file: string,
    private readonly initial: () => S,
  ) {
    this.lock = `${file}.lock`;
  }

  transact<T>(change: (state: S) => T): T {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        mkdirSync(this.lock);
        break;
      } catch {
        if (this.lockIsStale()) {
          rmSync(this.lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error(`The state of the fake in ${this.file} is locked.`);
        sleepSync(5);
      }
    }
    try {
      const state = this.read();
      const result = change(state);
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(state));
      renameSync(temporary, this.file);
      return result;
    } finally {
      rmSync(this.lock, { recursive: true, force: true });
    }
  }

  private read(): S {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as S;
    } catch {
      return this.initial();
    }
  }

  private lockIsStale(): boolean {
    try {
      return Date.now() - statSync(this.lock).mtimeMs > STALE_LOCK_MS;
    } catch {
      return false;
    }
  }
}

/**
 * The file that holds the fake's state in an emulator run. The launcher gives every run a
 * temporary directory of its own (`scripts/emulators.mjs`), which the functions and the test
 * runners inherit, so two runs never share it and nothing of it outlives the run.
 */
export function fakeStatePath(): string {
  return path.join(os.tmpdir(), "eegml-google-workspace-fake", "state.json");
}

/** Removes the fake's state, so that the next use starts again from the synthetic fixtures. */
export function resetFakeState(file: string = fakeStatePath()): void {
  rmSync(path.dirname(file), { recursive: true, force: true });
}
