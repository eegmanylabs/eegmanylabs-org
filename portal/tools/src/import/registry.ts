// The source registry as the repository states it (docs/SOURCE_REGISTRY.md, section 2).
//
// Everything here is public: a source is named by its letter and title only. The identifier and
// the address of a source document are private and come from the configuration file that
// config.ts reads, which is never committed (D-012).
import { COLLECTIONS } from "@eegml/shared";
import type { PrivateSource } from "./config";
import { createdFields, entryOf, type RunContext, updatedFields, validated } from "./context";
import type { DerivedSource, SourceTab } from "./model";
import { sameValue } from "./values";

export interface SourceDefinition {
  /** The key of the source: its letter in lower case. */
  readonly key: string;
  readonly letter: string;
  readonly title: string;
  readonly kind: "googleSheet" | "driveFile" | "repositoryTsv" | "quire" | "osf" | "other";
  readonly authority: "historical" | "live" | "reference";
  readonly syncPolicy: "oneOff" | "repeatable" | "scheduledPull" | "twoWay";
  /** Whether the source could be read without credentials when it was inspected. */
  readonly accessStatus: "unknown" | "public" | "restricted" | "unreachable";
  /** What a reader of the registry has to know before relying on the source or on its importer. */
  readonly notes?: string;
}

/**
 * The note on a source that could not be opened when its importer was written. The importer
 * checks the structure of the workbook first and stops with a report where it differs.
 */
export const SYNTHETIC_FIXTURES_ONLY =
  "The importer of this source is built against synthetic fixtures only. The workbook could not be opened, " +
  "so its layout is unverified, and the first run against the real file is a preview of its structure.";

/**
 * A family of sources that share one layout and one importer. The repository cannot list its
 * members, because the key of each is derived from a private identifier, so a member is
 * registered in the private configuration and its entry is written when it is first imported.
 *
 * | Key      | Members                                                              |
 * |----------|----------------------------------------------------------------------|
 * | `ctable` | The contributor sheets, one for each list of contributors of a manuscript |
 */
export interface SourceFamily extends Omit<DerivedSource, "notes"> {
  /** The option of the command line that names the member. */
  readonly selectedBy: string;
}

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
  {
    key: "ctable",
    title: "Contributor sheets",
    kind: "googleSheet",
    authority: "live",
    syncPolicy: "repeatable",
    accessStatus: "public",
    selectedBy: "--sheet",
  },
];

export function sourceFamily(key: string): SourceFamily | undefined {
  return SOURCE_FAMILIES.find((family) => family.key === key.toLowerCase());
}

/**
 * The sources of the programme. The importer of a source is no part of its entry here: an
 * importer names its source in its own module, so that adding one edits no shared file.
 *
 * | Key | Title                                           |
 * |-----|-------------------------------------------------|
 * | `a` | Historical replication coordination workbook    |
 * | `b` | Naming conventions                              |
 * | `c` | Community vocabulary                            |
 * | `d` | List of studies                                 |
 * | `e` | Prediction-market hypotheses                    |
 * | `f` | Recruitment and contact workbook                |
 * | `g` | Membership and contributor workbook             |
 * | `h` | Website structured data                         |
 * | `i` | Quire                                           |
 * | `j` | Linked documents                                |
 */
export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  {
    key: "a",
    letter: "A",
    title: "Historical replication coordination workbook",
    kind: "driveFile",
    authority: "historical",
    syncPolicy: "oneOff",
    accessStatus: "restricted",
    notes: SYNTHETIC_FIXTURES_ONLY,
  },
  {
    key: "b",
    letter: "B",
    title: "Naming conventions",
    kind: "googleSheet",
    authority: "reference",
    syncPolicy: "repeatable",
    accessStatus: "public",
  },
  {
    key: "c",
    letter: "C",
    title: "Community vocabulary",
    kind: "googleSheet",
    authority: "reference",
    syncPolicy: "scheduledPull",
    accessStatus: "public",
  },
  {
    key: "d",
    letter: "D",
    title: "List of studies",
    kind: "googleSheet",
    authority: "historical",
    syncPolicy: "repeatable",
    accessStatus: "public",
  },
  {
    key: "e",
    letter: "E",
    title: "Prediction-market hypotheses",
    kind: "googleSheet",
    authority: "live",
    syncPolicy: "repeatable",
    accessStatus: "public",
  },
  {
    key: "f",
    letter: "F",
    title: "Recruitment and contact workbook",
    kind: "googleSheet",
    authority: "live",
    syncPolicy: "repeatable",
    accessStatus: "public",
  },
  {
    key: "g",
    letter: "G",
    title: "Membership and contributor workbook",
    kind: "googleSheet",
    authority: "live",
    syncPolicy: "repeatable",
    accessStatus: "restricted",
    notes: SYNTHETIC_FIXTURES_ONLY,
  },
  {
    key: "h",
    letter: "H",
    title: "Website structured data",
    kind: "repositoryTsv",
    authority: "live",
    syncPolicy: "repeatable",
    accessStatus: "public",
  },
  {
    key: "i",
    letter: "I",
    title: "Quire",
    kind: "quire",
    authority: "live",
    syncPolicy: "oneOff",
    accessStatus: "unknown",
  },
  {
    key: "j",
    letter: "J",
    title: "Linked documents",
    kind: "other",
    authority: "reference",
    syncPolicy: "scheduledPull",
    accessStatus: "unknown",
  },
];

export function sourceDefinition(key: string): SourceDefinition | undefined {
  return SOURCE_DEFINITIONS.find((definition) => definition.key === key.toLowerCase());
}

/** The private location of each source by key, where the private configuration names one. */
export type PrivateLocations = Readonly<Record<string, PrivateSource | undefined>>;

interface WantedDocument {
  readonly entry: ReturnType<typeof entryOf>;
  readonly path: string;
  /** What the repository, the source or the private configuration says. A difference is written. */
  readonly fields: Record<string, unknown>;
  /** What a new document starts with and no later run touches. */
  readonly initial: Record<string, unknown>;
}

/**
 * Writes the source registry: the entry of every source that the repository defines, the entry
 * of a source that the importer itself defines, the tabs of the source that was just read, each
 * with the key of the importer that read it, and, where the private configuration names them,
 * the locations. A document is written only when it is missing or when what is said about it has
 * changed, so a repeated run writes nothing. Returns the number of documents written.
 */
export async function syncRegistry(
  context: RunContext,
  importerKey: string,
  tabs: readonly SourceTab[],
  locations: PrivateLocations,
  derived: readonly DerivedSource[] = [],
): Promise<number> {
  const { db, now, sourceKey } = context;
  const definitions: readonly DerivedSource[] = [...SOURCE_DEFINITIONS, ...derived];
  const wanted: WantedDocument[] = [
    ...definitions.map((definition) => ({
      entry: entryOf("sources"),
      path: COLLECTIONS.sources.docPath(definition.key),
      fields: {
        key: definition.key,
        title: definition.title,
        kind: definition.kind,
        authority: definition.authority,
        syncPolicy: definition.syncPolicy,
        accessStatus: definition.accessStatus,
        ...(definition.notes === undefined ? {} : { notes: definition.notes }),
      },
      initial: { lastFetchedAt: null },
    })),
    ...tabs.map((tab) => ({
      entry: entryOf("sourceTabs"),
      path: COLLECTIONS.sourceTabs.docPath(sourceKey, tab.tabKey),
      fields: {
        sourceKey,
        tabKey: tab.tabKey,
        name: tab.name,
        ...(tab.sheetId === undefined ? {} : { sheetId: tab.sheetId }),
        visibility: tab.visibility,
        ...(tab.headerRow === undefined ? {} : { headerRow: tab.headerRow }),
        rowCount: tab.rows.filter((row) => row.rowClass === "data").length,
        importerKey,
      },
      // The time at which the tab was first seen or last seen to have changed. The batches say when it was read.
      initial: { lastSeenAt: now },
    })),
  ];
  for (const definition of definitions) {
    const location = locations[definition.key];
    if (location?.url === undefined && location?.externalId === undefined) continue;
    wanted.push({
      entry: entryOf("sourceLocation"),
      path: COLLECTIONS.sourceLocation.docPath(definition.key),
      fields: {
        ...(location.url === undefined ? {} : { url: location.url }),
        ...(location.externalId === undefined ? {} : { externalId: location.externalId }),
      },
      initial: {},
    });
  }

  const snapshots = await db.getAll(...wanted.map((document) => db.doc(document.path)));
  const batch = db.batch();
  let writes = 0;
  for (const [index, { entry, path, fields, initial }] of wanted.entries()) {
    const stored = snapshots[index]?.data();
    if (stored === undefined) {
      batch.create(
        db.doc(path),
        validated(entry, path, { ...createdFields(now), schemaVersion: entry.schemaVersion, ...initial, ...fields }),
      );
    } else if (Object.entries(fields).some(([field, value]) => !sameValue(stored[field], value))) {
      const changed = "lastSeenAt" in initial ? { lastSeenAt: now } : {};
      batch.update(db.doc(path), { ...fields, ...changed, ...updatedFields(now) });
    } else {
      continue;
    }
    writes += 1;
  }
  if (writes > 0) await batch.commit();
  return writes;
}
