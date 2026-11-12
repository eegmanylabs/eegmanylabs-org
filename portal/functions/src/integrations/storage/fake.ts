// The fake of the research data servers. It answers the storage interface from a small set of
// synthetic servers and reproduces what the design of docs/INTEGRATIONS.md, section 7, relies
// on: a server that is down, one that answers slowly, an account that is refused everywhere or
// below one path, a path that does not exist, listings that come in pages, checksums that only
// object storage states for each file, and checksum files that a laboratory keeps beside its
// data. Its state lives in memory for unit tests and in a file of the emulator run otherwise, so
// a test can take a server down while the functions of the emulator scan it.
import os from "node:os";
import path from "node:path";
import { normalisePath, type StorageProtocol } from "@eegml/shared";
import { type FakeStore, FileStore, MemoryStore } from "../google/fake/store";
import { initialStorageState } from "./fixtures";
import {
  type ListedFile,
  type ListingPage,
  type StorageAdapter,
  StorageError,
  type StorageRuntime,
  type StorageTarget,
} from "./types";

export interface FakeServerFile {
  size: number;
  /** ISO 8601 text. */
  modified: string;
  /** The checksum that object storage states for an object. Other protocols state none. */
  checksum?: { algorithm: string; value: string };
  /** The content of a small text file, such as a checksum file. A recording has none. */
  text?: string;
}

export interface FakeServer {
  protocol: StorageProtocol;
  /** `down` refuses every connection, as a server that is switched off or cut off does. */
  mode: "up" | "down";
  /** How long each answer takes, in milliseconds. */
  latencyMs: number;
  /** Whether the account is refused everywhere, as after a credential has been withdrawn. */
  denyAll: boolean;
  /** Paths below which the account is refused. */
  deniedPaths: string[];
  /** Every file of the server, by its full path without a leading slash. */
  files: Record<string, FakeServerFile>;
}

export interface StorageFakeState {
  schema: 1;
  /** How long one call may take before the scan gives up on it. Short, so that a test of a slow server is quick. */
  requestTimeoutMs: number;
  /** The files of one page of a listing. */
  pageSize: number;
  servers: Record<string, FakeServer>;
  /** Every call made, so a test can prove that a scan reads checksum files and never a recording. */
  reads: string[];
}

const join = (...parts: readonly (string | null)[]) =>
  normalisePath(parts.filter((part): part is string => part !== null && part !== "").join("/")) ?? "";

const delay = (milliseconds: number) =>
  milliseconds <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** The state of the fake, and the adapter that serves every protocol from it. */
export class StorageFake {
  constructor(private readonly store: FakeStore<StorageFakeState>) {}

  /** Reads or changes the state, for tests and for the seed. */
  transact<T>(change: (state: StorageFakeState) => T): T {
    return this.store.transact(change);
  }

  setMode(host: string, mode: FakeServer["mode"]): void {
    this.transact((state) => {
      this.server(state, host).mode = mode;
    });
  }

  setLatency(host: string, latencyMs: number): void {
    this.transact((state) => {
      this.server(state, host).latencyMs = latencyMs;
    });
  }

  setDenied(host: string, denyAll: boolean, deniedPaths: readonly string[] = []): void {
    this.transact((state) => {
      const server = this.server(state, host);
      server.denyAll = denyAll;
      server.deniedPaths = [...deniedPaths];
    });
  }

  putFile(host: string, fullPath: string, file: FakeServerFile): void {
    this.transact((state) => {
      this.server(state, host).files[join(fullPath)] = file;
    });
  }

  removeFile(host: string, fullPath: string): void {
    this.transact((state) => {
      delete this.server(state, host).files[join(fullPath)];
    });
  }

  /** The reads of file content so far: the paths of the text files read. */
  contentReads(): string[] {
    return this.transact((state) => [...state.reads]);
  }

  private server(state: StorageFakeState, host: string): FakeServer {
    const server = state.servers[host];
    if (server === undefined) throw new Error(`The fake has no server ${host}.`);
    return server;
  }

  /** The adapter of one protocol: every protocol is served alike, from the server the target names. */
  adapter(): StorageAdapter {
    return {
      check: async (target) => {
        const server = await this.answer(target);
        return `The synthetic ${server.protocol} server ${target.host} answered.`;
      },
      list: async (target, cursor) => {
        const server = await this.answer(target);
        const root = join(target.basePath, target.path);
        this.refuseDenied(server, root);
        const prefix = root === "" ? "" : `${root}/`;
        const below = Object.keys(server.files)
          .filter((name) => name.startsWith(prefix))
          .sort();
        if (below.length === 0) throw new StorageError("notFound", "The path does not exist on the server.");
        const start = cursor === null ? 0 : Number(cursor);
        const { pageSize } = this.transact((state) => ({ pageSize: state.pageSize }));
        const page = below.slice(start, start + pageSize);
        const files: ListedFile[] = page.map((name) => {
          const file = server.files[name] as FakeServerFile;
          return {
            relativePath: name.slice(prefix.length),
            sizeBytes: file.size,
            modifiedAt: file.modified,
            ...(server.protocol === "s3" && file.checksum !== undefined
              ? { checksumAlgorithm: file.checksum.algorithm, checksum: file.checksum.value }
              : {}),
          };
        });
        return {
          files,
          nextCursor: start + pageSize < below.length ? String(start + pageSize) : null,
        } satisfies ListingPage;
      },
      readText: async (target, relativePath, maxBytes) => {
        const server = await this.answer(target);
        const full = join(target.basePath, target.path, relativePath);
        this.refuseDenied(server, full);
        const file = server.files[full];
        if (file === undefined) throw new StorageError("notFound", "The file does not exist on the server.");
        if (file.text === undefined)
          throw new StorageError("failed", "The fake serves the content of text files only.");
        if (file.text.length > maxBytes)
          throw new StorageError("failed", "The file is larger than a checksum file may be.");
        this.transact((state) => {
          state.reads.push(`${target.host}:${full}`);
        });
        return file.text;
      },
    };
  }

  /** Waits as the server does, then refuses as it does: unknown, down or refusing the account. */
  private async answer(target: StorageTarget): Promise<FakeServer> {
    const server = this.transact((state) => state.servers[target.host]);
    if (server === undefined) throw new StorageError("unreachable", "No server answers at this address.");
    await delay(server.latencyMs);
    if (server.mode === "down") throw new StorageError("unreachable", "The server did not answer.");
    if (server.denyAll) throw new StorageError("permissionDenied", "The server refused the account.");
    return server;
  }

  private refuseDenied(server: FakeServer, fullPath: string): void {
    if (server.deniedPaths.some((denied) => fullPath === join(denied) || fullPath.startsWith(`${join(denied)}/`))) {
      throw new StorageError("permissionDenied", "The server refused the account for this path.");
    }
  }

  /** The runtime of the fake, which serves every protocol and gives a call the fake's time limit. */
  runtime(): StorageRuntime {
    const adapter = this.adapter();
    const requestTimeoutMs = this.transact((state) => state.requestTimeoutMs);
    return { kind: "fake", adapterFor: () => adapter, requestTimeoutMs };
  }
}

/** A fake in memory, for unit tests. */
export function memoryStorageFake(): StorageFake {
  return new StorageFake(new MemoryStore(initialStorageState()));
}

/** The file that holds the fake's state in an emulator run, in the run's own temporary directory. */
export function storageFakeStatePath(): string {
  return path.join(os.tmpdir(), "eegml-storage-fake", "state.json");
}

/** The fake of an emulator run, over the run's state file. */
export function emulatorStorageFake(): StorageFake {
  return new StorageFake(new FileStore(storageFakeStatePath(), initialStorageState));
}
