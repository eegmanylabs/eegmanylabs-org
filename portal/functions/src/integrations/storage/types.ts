// The interface through which the portal reaches a research data server (docs/INTEGRATIONS.md,
// section 7). It has three operations and none of them reads a recording: check that the server
// answers, list the files below a path with their sizes and modification times (and a checksum
// where the protocol states one for each file, as object storage does), and read a small text
// file, which the scan uses only for the checksum files a laboratory keeps beside its data. Each
// protocol has one implementation in `real/`, written from its documentation and never executed,
// and the fake in `fake/` serves the emulator and every test.
import type { StorageProtocol } from "@eegml/shared";

/** Where a copy is and how its server is reached. The credential is the name of a secret, never its value. */
export interface StorageTarget {
  readonly protocol: StorageProtocol;
  readonly host: string;
  readonly port: number | null;
  readonly basePath: string | null;
  /** The path of the copy below the base path, or a full address. */
  readonly path: string;
  readonly credentialRef: string | null;
}

/** One file of a listing. The checksum is present only where the server itself states it. */
export interface ListedFile {
  readonly relativePath: string;
  readonly sizeBytes: number;
  /** ISO 8601 text, where the server gives the time of the last change. */
  readonly modifiedAt: string | null;
  readonly checksumAlgorithm?: string;
  readonly checksum?: string;
}

export interface ListingPage {
  readonly files: readonly ListedFile[];
  /** Where the next page starts, or null after the last page. */
  readonly nextCursor: string | null;
}

/**
 * Why a call to a server failed.
 *
 * | Kind               | Meaning                                                              |
 * |--------------------|----------------------------------------------------------------------|
 * | `unreachable`      | The server did not answer, or refused the connection                 |
 * | `permissionDenied` | The server answered and refused the account or the path              |
 * | `timeout`          | The server answered too slowly for the time a call may take          |
 * | `notFound`         | The path does not exist on the server                                |
 * | `failed`           | Anything else, such as an answer the adapter could not read          |
 */
export type StorageFailureKind = "unreachable" | "permissionDenied" | "timeout" | "notFound" | "failed";

export class StorageError extends Error {
  constructor(
    readonly kind: StorageFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export interface StorageAdapter {
  /** Resolves with a short description of the answer, or rejects with a `StorageError`. */
  check(target: StorageTarget): Promise<string>;
  /** One page of the files below the target's path, by relative path. */
  list(target: StorageTarget, cursor: string | null): Promise<ListingPage>;
  /** A small text file below the target's path, refused beyond `maxBytes`. */
  readText(target: StorageTarget, relativePath: string, maxBytes: number): Promise<string>;
}

/** The adapters of the protocols, and how long one call may take. */
export interface StorageRuntime {
  readonly kind: "fake" | "real";
  adapterFor(protocol: StorageProtocol): StorageAdapter | null;
  readonly requestTimeoutMs: number;
}
