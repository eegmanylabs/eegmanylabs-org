// The manifest of a backup: every document, every account and every stored object, each with a
// hash of its content, so that a restore can be compared with what was backed up.
//
// A manifest names paths, identifiers and hashes, and never a value. It holds no address, no
// name and no content of a document, so it may sit beside a rehearsal report without becoming
// personal data itself. The comparison is pure, so the tests can feed it synthetic manifests.
import { createHash } from "node:crypto";

/** The format of a manifest file. A later change of the canonical form raises it. */
export const MANIFEST_FORMAT = "eegml-backup-manifest/1";

export interface ManifestEntry {
  /** The path of a document, the uid of an account, or the name of a stored object. */
  readonly key: string;
  /** SHA-256 of the canonical form of the content. */
  readonly sha256: string;
}

export interface BackupManifest {
  readonly format: typeof MANIFEST_FORMAT;
  readonly projectId: string;
  readonly takenAt: string;
  readonly documents: readonly ManifestEntry[];
  readonly accounts: readonly ManifestEntry[];
  readonly objects: readonly ManifestEntry[];
}

export type ManifestKind = "documents" | "accounts" | "objects";
export const MANIFEST_KINDS: readonly ManifestKind[] = ["documents", "accounts", "objects"];

export interface KindDifference {
  /** In the backup and absent from the restore. */
  readonly missing: readonly string[];
  /** In both, with different content. */
  readonly changed: readonly string[];
  /** In the restore and absent from the backup. */
  readonly unexpected: readonly string[];
}

export type ManifestDifference = Readonly<Record<ManifestKind, KindDifference>>;

/**
 * A canonical text for a value: keys of maps sorted, and each kind of value tagged, so that a
 * timestamp, a text and a number that print alike still hash apart.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
  toDate(): Date;
}
interface ReferenceLike {
  readonly path: string;
  readonly firestore: unknown;
}
interface GeoPointLike {
  readonly latitude: number;
  readonly longitude: number;
  isEqual(other: unknown): boolean;
}

function isTimestamp(value: object): value is TimestampLike {
  return "seconds" in value && "nanoseconds" in value && "toDate" in value;
}
function isReference(value: object): value is ReferenceLike {
  return "path" in value && "firestore" in value && typeof (value as { path: unknown }).path === "string";
}
function isGeoPoint(value: object): value is GeoPointLike {
  return "latitude" in value && "longitude" in value && "isEqual" in value;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $number: "NaN" };
    if (!Number.isFinite(value)) return { $number: value > 0 ? "Infinity" : "-Infinity" };
    return { $number: value };
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return { $number: value.toString() };
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Date) return { $time: value.toISOString() };
  if (typeof value === "object") {
    if (isTimestamp(value)) return { $timestamp: [value.seconds, value.nanoseconds] };
    if (isReference(value)) return { $reference: value.path };
    if (isGeoPoint(value)) return { $geo: [value.latitude, value.longitude] };
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return { $map: entries.map(([name, inner]) => [name, canonicalValue(inner)]) };
  }
  throw new TypeError(`A manifest cannot hash a value of type ${typeof value}.`);
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Sorts entries by key and refuses a key that appears twice. */
export function sortedEntries(entries: readonly ManifestEntry[]): ManifestEntry[] {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index]?.key === sorted[index - 1]?.key) {
      throw new Error(`The manifest names ${sorted[index]?.key} twice.`);
    }
  }
  return sorted;
}

function compareKind(backup: readonly ManifestEntry[], restored: readonly ManifestEntry[]): KindDifference {
  const before = new Map(backup.map((entry) => [entry.key, entry.sha256]));
  const after = new Map(restored.map((entry) => [entry.key, entry.sha256]));
  const missing: string[] = [];
  const changed: string[] = [];
  const unexpected: string[] = [];
  for (const [key, hash] of before) {
    const other = after.get(key);
    if (other === undefined) missing.push(key);
    else if (other !== hash) changed.push(key);
  }
  for (const key of after.keys()) if (!before.has(key)) unexpected.push(key);
  return { missing: missing.sort(), changed: changed.sort(), unexpected: unexpected.sort() };
}

/** What differs between the manifest of a backup and the manifest of its restore. */
export function compareManifests(backup: BackupManifest, restored: BackupManifest): ManifestDifference {
  return {
    documents: compareKind(backup.documents, restored.documents),
    accounts: compareKind(backup.accounts, restored.accounts),
    objects: compareKind(backup.objects, restored.objects),
  };
}

export function differenceCount(difference: ManifestDifference): number {
  return MANIFEST_KINDS.reduce(
    (total, kind) =>
      total + difference[kind].missing.length + difference[kind].changed.length + difference[kind].unexpected.length,
    0,
  );
}

/** Reads a manifest file and refuses one of another format or shape. */
export function parseManifest(text: string): BackupManifest {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null) throw new Error("A manifest is a JSON object.");
  const record = value as Record<string, unknown>;
  if (record.format !== MANIFEST_FORMAT) throw new Error(`A manifest has the format ${MANIFEST_FORMAT}.`);
  if (typeof record.projectId !== "string" || typeof record.takenAt !== "string") {
    throw new Error("A manifest names its project and the time it was taken.");
  }
  const entries = (name: ManifestKind): ManifestEntry[] => {
    const list = record[name];
    if (!Array.isArray(list)) throw new Error(`A manifest lists its ${name}.`);
    return sortedEntries(
      list.map((item: unknown) => {
        const entry = item as Partial<ManifestEntry> | null;
        if (
          typeof entry?.key !== "string" ||
          typeof entry.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(entry.sha256)
        ) {
          throw new Error(`An entry of ${name} has a key and a SHA-256.`);
        }
        return { key: entry.key, sha256: entry.sha256 };
      }),
    );
  };
  return {
    format: MANIFEST_FORMAT,
    projectId: record.projectId,
    takenAt: record.takenAt,
    documents: entries("documents"),
    accounts: entries("accounts"),
    objects: entries("objects"),
  };
}
