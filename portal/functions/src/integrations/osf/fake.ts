// The fake of OSF. It serves the OSF interface from a few synthetic resources and reproduces what
// the design of docs/INTEGRATIONS.md, section 5, relies on: a resource that is not public, one
// that was deleted, a registration that was withdrawn, a limit on the rate of requests that asks
// the portal to wait, and an outage. Its state lives in memory for unit tests and in a file of
// the emulator run otherwise, so a test can take OSF down while the functions of the emulator
// read it. Every resource here is synthetic.
import os from "node:os";
import path from "node:path";
import { type FakeStore, FileStore, MemoryStore } from "../google/fake/store";
import { type OsfAdapter, OsfError, type OsfResource } from "./types";

/** A resource of the fake: what OSF answers, which a test may change, and whether it is public. */
export type FakeOsfResource = { -readonly [K in keyof OsfResource]: OsfResource[K] } & {
  /** Whether anyone may read it. A resource that is not public answers as OSF answers a stranger. */
  public: boolean;
};

export interface OsfFakeState {
  schema: 1;
  /** `down` answers every request with an error of OSF's own, as during an outage. */
  mode: "up" | "down";
  /** How many further requests are refused because of the rate limit, each asking to wait `retryAfterSeconds`. */
  rateLimitedRequests: number;
  retryAfterSeconds: number;
  resources: Record<string, FakeOsfResource>;
  /** Every identifier asked for, so a test can prove what the portal read and when. */
  reads: string[];
}

/** Synthetic identifiers of the fake, which the demonstration world links to. */
export const FAKE_OSF = {
  stage1Registration: "zq7k2",
  project: "a3bcd",
  privateProject: "p9xyz",
  withdrawnRegistration: "w4thd",
  preprint: "pr3pt",
} as const;

export function initialOsfState(): OsfFakeState {
  return {
    schema: 1,
    mode: "up",
    rateLimitedRequests: 0,
    retryAfterSeconds: 1,
    reads: [],
    resources: {
      [FAKE_OSF.stage1Registration]: {
        id: FAKE_OSF.stage1Registration,
        kind: "registration",
        title: "Synthetic Stage 1 registration of a replication",
        dateModified: "2026-03-02T10:00:00.000Z",
        dateRegistered: "2026-03-01T09:30:00.000Z",
        withdrawn: false,
        public: true,
      },
      [FAKE_OSF.project]: {
        id: FAKE_OSF.project,
        kind: "node",
        title: "Synthetic project of a replication",
        dateModified: "2026-05-10T08:00:00.000Z",
        dateRegistered: null,
        withdrawn: false,
        public: true,
      },
      [FAKE_OSF.privateProject]: {
        id: FAKE_OSF.privateProject,
        kind: "node",
        title: "Synthetic private project",
        dateModified: "2026-05-11T08:00:00.000Z",
        dateRegistered: null,
        withdrawn: false,
        public: false,
      },
      [FAKE_OSF.withdrawnRegistration]: {
        id: FAKE_OSF.withdrawnRegistration,
        kind: "registration",
        title: "Synthetic withdrawn registration",
        dateModified: "2026-04-01T08:00:00.000Z",
        dateRegistered: "2026-02-01T08:00:00.000Z",
        withdrawn: true,
        public: true,
      },
      [FAKE_OSF.preprint]: {
        id: FAKE_OSF.preprint,
        kind: "preprint",
        title: "Synthetic preprint of a replication",
        dateModified: "2026-06-01T08:00:00.000Z",
        dateRegistered: null,
        withdrawn: false,
        public: true,
      },
    },
  };
}

export class OsfFake {
  constructor(private readonly store: FakeStore<OsfFakeState>) {}

  transact<T>(change: (state: OsfFakeState) => T): T {
    return this.store.transact(change);
  }

  setMode(mode: OsfFakeState["mode"]): void {
    this.transact((state) => {
      state.mode = mode;
    });
  }

  /** Refuses the next `requests` requests with the rate limit, each asking to wait `retryAfterSeconds`. */
  limitRate(requests: number, retryAfterSeconds = 1): void {
    this.transact((state) => {
      state.rateLimitedRequests = requests;
      state.retryAfterSeconds = retryAfterSeconds;
    });
  }

  /** Makes a resource public or not, as its owner can on OSF. */
  setPublic(id: string, isPublic: boolean): void {
    this.transact((state) => {
      const resource = state.resources[id];
      if (resource === undefined) throw new Error(`The fake has no resource ${id}.`);
      resource.public = isPublic;
    });
  }

  /** Deletes a resource, as its owner can on OSF. */
  remove(id: string): void {
    this.transact((state) => {
      delete state.resources[id];
    });
  }

  /** Withdraws a registration, which keeps its page and says so. */
  withdraw(id: string): void {
    this.transact((state) => {
      const resource = state.resources[id];
      if (resource === undefined || resource.kind !== "registration") throw new Error(`No registration ${id}.`);
      resource.withdrawn = true;
    });
  }

  reads(): string[] {
    return this.transact((state) => [...state.reads]);
  }

  adapter(): OsfAdapter {
    return {
      resource: async (id) => {
        // The answer is decided inside one change of the state and thrown after it, so the
        // record of the read and the use of the rate limit are kept whatever the answer.
        const answer = this.transact((state): OsfResource | OsfError => {
          state.reads.push(id);
          if (state.mode === "down") return new OsfError("unavailable", "OSF answered with an error.", 503);
          if (state.rateLimitedRequests > 0) {
            state.rateLimitedRequests -= 1;
            return new OsfError("rateLimited", "OSF asked the portal to slow down.", 429, state.retryAfterSeconds);
          }
          const resource = state.resources[id];
          if (resource === undefined) return new OsfError("notFound", "No OSF resource has this identifier.", 404);
          if (!resource.public) return new OsfError("restricted", "The OSF resource is not public.", 403);
          const { public: _public, ...found } = resource;
          return found;
        });
        if (answer instanceof OsfError) throw answer;
        return answer;
      },
    };
  }
}

/** A fake in memory, for unit tests. */
export function memoryOsfFake(): OsfFake {
  return new OsfFake(new MemoryStore(initialOsfState()));
}

/** The file that holds the fake's state in an emulator run, in the run's own temporary directory. */
export function osfFakeStatePath(): string {
  return path.join(os.tmpdir(), "eegml-osf-fake", "state.json");
}

/** The fake of an emulator run, over the run's state file. */
export function emulatorOsfFake(): OsfFake {
  return new OsfFake(new FileStore(osfFakeStatePath(), initialOsfState));
}
