// The metadata scan of one storage reference (docs/INTEGRATIONS.md, section 7). It lists the
// files below the reference's path page by page, joins the checksums that the server holds,
// either for each object or in the checksum files a laboratory keeps beside its data, and never
// reads a recording. Each call to the server has a time limit, a call that fails because the
// server did not answer is tried once more after a pause, and the whole scan stops after a
// number of files that keeps it inside the time of one function call. A scan that fails gives no
// listing at all, so no file is ever reported missing because a server could not be reached.
import { checksumFileAlgorithm, checksumsOf, hasControlCharacter, normalisePath } from "@eegml/shared";
import {
  type ListedFile,
  type ListingPage,
  type StorageAdapter,
  StorageError,
  type StorageFailureKind,
  type StorageTarget,
} from "./types";

/** The most files one scan lists. A larger copy is described by an uploaded manifest instead. */
export const SCAN_MAX_FILES = 10_000;

/** The largest checksum file a scan reads. */
export const CHECKSUM_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** The pause before a call that found the server unreachable is tried again, in milliseconds. */
const RETRY_PAUSE_MS = 250;

export type ScanOutcome =
  | { readonly ok: true; readonly files: readonly ListedFile[]; readonly checksumFiles: number; readonly pages: number }
  | { readonly ok: false; readonly kind: StorageFailureKind; readonly message: string };

/** Runs one call to a server with a time limit, as a `StorageError` of the kind `timeout` when it is exceeded. */
export async function withTimeout<T>(call: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new StorageError("timeout", "The server answered too slowly, so the scan stopped.")),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([call(), limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One call, with its time limit, tried once more after a pause where the server did not answer. */
async function attempt<T>(call: () => Promise<T>, timeoutMs: number): Promise<T> {
  try {
    return await withTimeout(call, timeoutMs);
  } catch (error) {
    if (!(error instanceof StorageError) || error.kind !== "unreachable") throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    return withTimeout(call, timeoutMs);
  }
}

/** A failure as the scan reports it: the kind of a `StorageError`, and `failed` for anything else. */
export function failureOf(error: unknown): { kind: StorageFailureKind; message: string } {
  if (error instanceof StorageError) return { kind: error.kind, message: error.message };
  return { kind: "failed", message: "The answer of the server could not be read." };
}

/** The directory of a relative path, with no trailing slash, or the empty text at the root. */
const directoryOf = (relativePath: string) => relativePath.split("/").slice(0, -1).join("/");

export async function scanTarget(
  adapter: StorageAdapter,
  target: StorageTarget,
  timeoutMs: number,
): Promise<ScanOutcome> {
  try {
    const listed: ListedFile[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const from: string | null = cursor;
      const page: ListingPage = await attempt(() => adapter.list(target, from), timeoutMs);
      listed.push(...page.files);
      cursor = page.nextCursor;
      pages += 1;
      if (listed.length > SCAN_MAX_FILES) {
        return {
          ok: false,
          kind: "failed",
          message: `The copy holds more than ${SCAN_MAX_FILES} files. Describe it with a manifest made inside the institution.`,
        };
      }
    } while (cursor !== null);
    // A name comes from the server: one that holds a control character is never stored or used.
    if (listed.some((file) => hasControlCharacter(file.relativePath))) {
      return {
        ok: false,
        kind: "failed",
        message: "The server lists a file whose name holds a control character. Rename it and scan again.",
      };
    }

    // The checksum files a laboratory keeps beside its data, joined to the files of their directory.
    const checksums = new Map<string, { algorithm: string; checksum: string }>();
    let checksumFiles = 0;
    for (const file of listed) {
      const algorithm = checksumFileAlgorithm(file.relativePath);
      if (algorithm === null) continue;
      const text = await attempt(() => adapter.readText(target, file.relativePath, CHECKSUM_FILE_MAX_BYTES), timeoutMs);
      checksumFiles += 1;
      const directory = directoryOf(file.relativePath);
      for (const [relative, checksum] of checksumsOf(text, algorithm)) {
        const key = normalisePath(directory === "" ? relative : `${directory}/${relative}`);
        if (key !== null && !checksums.has(key)) checksums.set(key, checksum);
      }
    }
    const files = listed
      .filter((file) => checksumFileAlgorithm(file.relativePath) === null)
      .map((file): ListedFile => {
        if (file.checksum !== undefined) return file;
        const found = checksums.get(normalisePath(file.relativePath) ?? file.relativePath);
        return found === undefined ? file : { ...file, checksumAlgorithm: found.algorithm, checksum: found.checksum };
      });
    return { ok: true, files, checksumFiles, pages };
  } catch (error) {
    return { ok: false, ...failureOf(error) };
  }
}

/** Checks that a server answers, with the time limit of one call. */
export async function checkTarget(
  adapter: StorageAdapter,
  target: StorageTarget,
  timeoutMs: number,
): Promise<{ ok: true; message: string } | { ok: false; kind: StorageFailureKind; message: string }> {
  try {
    return { ok: true, message: await attempt(() => adapter.check(target), timeoutMs) };
  } catch (error) {
    return { ok: false, ...failureOf(error) };
  }
}
