// Manifests of a dataset (docs/DATA_MODEL.md, section 10, and docs/INTEGRATIONS.md, section 7).
// A manifest lists files by relative path with their size, modification time and, where the
// server or the laboratory supplies one, a checksum. Nothing here reads a recording: a checksum
// is only ever copied from a listing or a checksum file, never computed from data.
//
// | Status       | Meaning                                                                       |
// |--------------|-------------------------------------------------------------------------------|
// | `expected`   | A file of an expected manifest                                                |
// | `present`    | Listed, and either named by the expected manifest or listed with no expected manifest to compare with |
// | `missing`    | Named by the expected manifest and absent from a successful listing           |
// | `unexpected` | Listed and not named by the expected manifest                                 |
// | `duplicate`  | Listed again under the same path, or with the checksum of a file listed before |
// | `mismatch`   | Named by the expected manifest, with a size or a checksum that differs        |
//
// `missing` only ever comes from a listing that succeeded. A server that cannot be reached
// produces no listing at all, so an outage never marks a file as missing.
import type { ManifestFileStatus } from "../schemas/datasets";

/** A file as a listing or an expected manifest states it, before a status is given. */
export interface ManifestEntry {
  readonly relativePath: string;
  readonly sizeBytes?: number;
  readonly checksumAlgorithm?: string;
  readonly checksum?: string;
}

/** A file with the status the comparison gave it, and what was expected where it differs. */
export type ComparedEntry<T extends ManifestEntry> = T & {
  readonly status: ManifestFileStatus;
  readonly expectedSizeBytes?: number;
  readonly expectedChecksum?: string;
};

export interface ManifestComparison<T extends ManifestEntry> {
  /** The listed files, in their order, followed by the expected files that are missing. */
  readonly files: readonly ComparedEntry<T | ManifestEntry>[];
  readonly counts: Readonly<Partial<Record<ManifestFileStatus, number>>>;
}

/** The checksum algorithms the portal recognises, with the length of their hexadecimal digest. */
export const CHECKSUM_ALGORITHMS = { md5: 32, sha1: 40, sha256: 64, sha512: 128 } as const;
export type ChecksumAlgorithm = keyof typeof CHECKSUM_ALGORITHMS;

/** The names of the checksum files that a laboratory or a server keeps beside the data. */
export const CHECKSUM_FILE_NAMES: Readonly<Record<string, ChecksumAlgorithm>> = {
  md5sums: "md5",
  "md5sums.txt": "md5",
  sha1sums: "sha1",
  sha256sums: "sha256",
  "sha256sums.txt": "sha256",
  sha512sums: "sha512",
};

/** The checksum algorithm of a checksum file's name, or null when the name is not one. */
export function checksumFileAlgorithm(relativePath: string): ChecksumAlgorithm | null {
  const name = (relativePath.split("/").pop() ?? "").toLowerCase();
  return CHECKSUM_FILE_NAMES[name] ?? null;
}

/** An algorithm name in its canonical spelling (`SHA-256` becomes `sha256`), or null when it is not one the portal knows. */
export function normaliseAlgorithm(name: string): ChecksumAlgorithm | null {
  const folded = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return folded in CHECKSUM_ALGORITHMS ? (folded as ChecksumAlgorithm) : null;
}

/**
 * A relative path in its canonical form: Unicode NFC, forward slashes, no leading `./` or `/`,
 * and no empty segment. A path that climbs out of its root (`..`) is refused, with null.
 */
export function normalisePath(relativePath: string): string | null {
  const segments = relativePath
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) return null;
  return segments.join("/");
}

/** One problem with a manifest, naming the line or the position where it was found. */
export interface ManifestProblem {
  readonly position: number;
  readonly message: string;
}

/**
 * The problems of a list of files: a path that is empty or climbs out of the root, a size that
 * is no whole number, and a checksum that is not a digest of its algorithm.
 */
export function validateManifest(files: readonly ManifestEntry[]): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  files.forEach((file, index) => {
    const position = index + 1;
    if (normalisePath(file.relativePath) === null) {
      problems.push({ position, message: "The path is empty or leaves the folder of the dataset." });
    }
    if (file.sizeBytes !== undefined && (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)) {
      problems.push({ position, message: "The size is not a whole number of bytes." });
    }
    if ((file.checksum === undefined) !== (file.checksumAlgorithm === undefined)) {
      problems.push({ position, message: "A checksum needs its algorithm, and an algorithm its checksum." });
      return;
    }
    if (file.checksum !== undefined && file.checksumAlgorithm !== undefined) {
      const algorithm = normaliseAlgorithm(file.checksumAlgorithm);
      if (algorithm === null) {
        problems.push({
          position,
          message: `The checksum algorithm ${file.checksumAlgorithm} is not one the portal knows.`,
        });
      } else if (!new RegExp(`^[0-9a-fA-F]{${CHECKSUM_ALGORITHMS[algorithm]}}$`).test(file.checksum)) {
        problems.push({ position, message: `The checksum is not a ${algorithm} digest.` });
      }
    }
  });
  return problems;
}

/** A checksum in canonical form: its algorithm's name and the digest in lower case. */
function checksumKey(entry: ManifestEntry): string | null {
  if (entry.checksum === undefined || entry.checksumAlgorithm === undefined) return null;
  const algorithm = normaliseAlgorithm(entry.checksumAlgorithm);
  return algorithm === null ? null : `${algorithm}:${entry.checksum.toLowerCase()}`;
}

/** Whether two statements of one file disagree, on the size or on a checksum of the same algorithm. */
function differs(listed: ManifestEntry, expected: ManifestEntry): boolean {
  if (listed.sizeBytes !== undefined && expected.sizeBytes !== undefined && listed.sizeBytes !== expected.sizeBytes) {
    return true;
  }
  const listedChecksum = checksumKey(listed);
  const expectedChecksum = checksumKey(expected);
  if (listedChecksum === null || expectedChecksum === null) return false;
  const [listedAlgorithm] = listedChecksum.split(":");
  const [expectedAlgorithm] = expectedChecksum.split(":");
  return listedAlgorithm === expectedAlgorithm && listedChecksum !== expectedChecksum;
}

/** The key under which two paths count as the same file: the canonical path, folded for case. */
const pathKey = (relativePath: string) => (normalisePath(relativePath) ?? relativePath).toLowerCase();

/**
 * Compares a listing with an expected manifest, or gives every listed file the status `present`
 * where there is no expected manifest. A file listed twice under one path, whatever its case,
 * and a file whose checksum equals that of a file listed before it, are duplicates: the copy at
 * an expected path is the original wherever there is one.
 */
export function compareManifest<T extends ManifestEntry>(
  listed: readonly T[],
  expected: readonly ManifestEntry[] | null,
): ManifestComparison<T> {
  const expectedByPath = new Map<string, ManifestEntry>();
  for (const entry of expected ?? []) {
    const key = pathKey(entry.relativePath);
    if (!expectedByPath.has(key)) expectedByPath.set(key, entry);
  }
  // Originals first: a file at an expected path keeps its place against a copy elsewhere.
  const order = listed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aExpected = expectedByPath.has(pathKey(a.entry.relativePath)) ? 0 : 1;
      const bExpected = expectedByPath.has(pathKey(b.entry.relativePath)) ? 0 : 1;
      return aExpected - bExpected || a.index - b.index;
    });
  const seenPaths = new Set<string>();
  const seenChecksums = new Set<string>();
  const statuses: ComparedEntry<T>[] = new Array(listed.length);
  for (const { entry, index } of order) {
    const key = pathKey(entry.relativePath);
    const checksum = checksumKey(entry);
    const duplicate = seenPaths.has(key) || (checksum !== null && seenChecksums.has(checksum));
    seenPaths.add(key);
    if (checksum !== null) seenChecksums.add(checksum);
    const match = expectedByPath.get(key);
    if (duplicate) {
      statuses[index] = { ...entry, status: "duplicate" };
    } else if (expected === null) {
      statuses[index] = { ...entry, status: "present" };
    } else if (match === undefined) {
      statuses[index] = { ...entry, status: "unexpected" };
    } else if (differs(entry, match)) {
      statuses[index] = {
        ...entry,
        status: "mismatch",
        ...(match.sizeBytes === undefined ? {} : { expectedSizeBytes: match.sizeBytes }),
        ...(match.checksum === undefined ? {} : { expectedChecksum: match.checksum.toLowerCase() }),
      };
    } else {
      statuses[index] = { ...entry, status: "present" };
    }
  }
  const missing: ComparedEntry<ManifestEntry>[] = [];
  for (const [key, entry] of expectedByPath) {
    if (!seenPaths.has(key)) {
      missing.push({
        relativePath: normalisePath(entry.relativePath) ?? entry.relativePath,
        ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
        ...(entry.checksum === undefined || entry.checksumAlgorithm === undefined
          ? {}
          : { checksumAlgorithm: entry.checksumAlgorithm, checksum: entry.checksum }),
        status: "missing",
      });
    }
  }
  const files = [...statuses, ...missing];
  return { files, counts: countStatuses(files) };
}

/** The number of files of each status. A status that no file has is absent. */
export function countStatuses(
  files: readonly { readonly status: ManifestFileStatus }[],
): Partial<Record<ManifestFileStatus, number>> {
  const counts: Partial<Record<ManifestFileStatus, number>> = {};
  for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1;
  return counts;
}

/** Whether a comparison found nothing wrong: nothing missing, unexpected, duplicated or different. */
export function manifestMatches(counts: Readonly<Partial<Record<ManifestFileStatus, number>>>): boolean {
  return (
    (counts.missing ?? 0) === 0 &&
    (counts.unexpected ?? 0) === 0 &&
    (counts.duplicate ?? 0) === 0 &&
    (counts.mismatch ?? 0) === 0
  );
}

/** The files that a listing found of what was expected: present, or present with a difference. */
export function receivedCount(counts: Readonly<Partial<Record<ManifestFileStatus, number>>>): number {
  return (counts.present ?? 0) + (counts.mismatch ?? 0);
}

export interface ParsedManifest {
  readonly files: readonly ManifestEntry[];
  readonly problems: readonly ManifestProblem[];
}

const CHECKSUM_LINE = /^([0-9a-fA-F]{32,128})\s+\*?(.+)$/;

function algorithmOfDigest(digest: string): ChecksumAlgorithm | null {
  const found = Object.entries(CHECKSUM_ALGORITHMS).find(([, length]) => length === digest.length);
  return found === undefined ? null : (found[0] as ChecksumAlgorithm);
}

/** Splits one line of comma-separated values, with double quotes around a value that holds a comma. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else current += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(current.trim());
      current = "";
    } else current += character;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Reads a manifest written as text, in one of two forms: the output of `sha256sum` or `md5sum`
 * (a digest and a path on each line, the algorithm told by the length of the digest), or
 * comma-separated values with a header row that names `path` and, optionally, `size`,
 * `checksum` and `algorithm`. Blank lines and lines that begin with `#` are skipped.
 */
export function parseManifestText(text: string, defaultAlgorithm: ChecksumAlgorithm | null = null): ParsedManifest {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const files: ManifestEntry[] = [];
  const problems: ManifestProblem[] = [];
  const firstLine = lines.findIndex((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  if (firstLine === -1) return { files, problems: [{ position: 1, message: "The manifest lists no file." }] };
  const header = csvCells(lines[firstLine] ?? "").map((cell) => cell.toLowerCase());
  const pathColumn = header.indexOf("path");
  if (pathColumn !== -1) {
    const sizeColumn = header.indexOf("size");
    const checksumColumn = header.indexOf("checksum");
    const algorithmColumn = header.indexOf("algorithm");
    for (let index = firstLine + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const cells = csvCells(line);
      const relativePath = cells[pathColumn] ?? "";
      const sizeText = sizeColumn === -1 ? "" : (cells[sizeColumn] ?? "");
      const checksum = checksumColumn === -1 ? "" : (cells[checksumColumn] ?? "");
      const algorithmText = algorithmColumn === -1 ? "" : (cells[algorithmColumn] ?? "");
      const algorithm =
        algorithmText !== "" ? normaliseAlgorithm(algorithmText) : checksum === "" ? null : algorithmOfDigest(checksum);
      if (sizeText !== "" && !/^\d+$/.test(sizeText)) {
        problems.push({ position: index + 1, message: "The size is not a whole number of bytes." });
        continue;
      }
      if (checksum !== "" && algorithm === null) {
        problems.push({ position: index + 1, message: "The algorithm of the checksum is not stated or not known." });
        continue;
      }
      files.push({
        relativePath,
        ...(sizeText === "" ? {} : { sizeBytes: Number(sizeText) }),
        ...(checksum === "" || algorithm === null
          ? {}
          : { checksumAlgorithm: algorithm, checksum: checksum.toLowerCase() }),
      });
    }
  } else {
    for (let index = firstLine; index < lines.length; index += 1) {
      const line = (lines[index] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      const match = CHECKSUM_LINE.exec(line);
      const digest = match?.[1];
      const relativePath = match?.[2];
      const algorithm = digest === undefined ? null : (algorithmOfDigest(digest) ?? defaultAlgorithm);
      if (digest === undefined || relativePath === undefined || algorithm === null) {
        problems.push({
          position: index + 1,
          message: "The line is neither a digest followed by a path nor a row under a header that names path.",
        });
        continue;
      }
      files.push({ relativePath: relativePath.trim(), checksumAlgorithm: algorithm, checksum: digest.toLowerCase() });
    }
  }
  return { files, problems: [...problems, ...validateManifest(files)] };
}

/** The checksums of a checksum file, by canonical path, for a scan to join to its listing. */
export function checksumsOf(
  text: string,
  algorithm: ChecksumAlgorithm,
): Map<string, { algorithm: string; checksum: string }> {
  const found = new Map<string, { algorithm: string; checksum: string }>();
  for (const file of parseManifestText(text, algorithm).files) {
    const key = normalisePath(file.relativePath);
    if (key !== null && file.checksum !== undefined) {
      found.set(key, { algorithm: file.checksumAlgorithm ?? algorithm, checksum: file.checksum });
    }
  }
  return found;
}

/** The most bytes one chunk of a manifest takes, which keeps a chunk far below the limit of a document. */
export const MANIFEST_CHUNK_MAX_BYTES = 500 * 1024;

/**
 * Splits the files of a manifest into chunks of at most `maxFiles` files and about `maxBytes`
 * bytes each, measured on their serialised form.
 */
export function chunkManifest<T>(files: readonly T[], maxFiles: number, maxBytes = MANIFEST_CHUNK_MAX_BYTES): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of files) {
    const size = JSON.stringify(file).length + 1;
    if (current.length > 0 && (current.length >= maxFiles || bytes + size > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
