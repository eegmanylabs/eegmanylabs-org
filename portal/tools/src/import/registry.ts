// The source registry as the repository states it (docs/SOURCE_REGISTRY.md, section 2).
//
// Everything here is public: a source is named by its letter and title only. The identifier and
// the address of a source document are private and come from the configuration file that
// config.ts reads, which is never committed (D-012).
import { COLLECTIONS } from "@eegml/shared";
import { createdFields, entryOf, type RunContext, updatedFields, validated } from "./context";
import type { PrivateSource } from "./config";
import type { SourceTab } from "./model";
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
  /** The key of the importer of the source, or null while none is built. */
  readonly importerKey: string | null;
}

/**
 * | Key | Title                                           | Importer            |
 * |-----|-------------------------------------------------|---------------------|
 * | `a` | Historical replication coordination workbook    | none yet            |
 * | `b` | Naming conventions                              | `namingConventions` |
 * | `c` | Community vocabulary                            | none yet            |
 * | `d` | List of studies                                 | none yet            |
 * | `e` | Prediction-market hypotheses                    | none yet            |
 * | `f` | Recruitment and contact workbook                | none yet            |
 * | `g` | Membership and contributor workbook             | none yet            |
 * | `h` | Website structured data                         | `websiteData`       |
 * | `i` | Quire                                           | none yet            |
 * | `j` | Linked documents                                | none yet            |
 */
export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  { key: "a", letter: "A", title: "Historical replication coordination workbook", kind: "driveFile", authority: "historical", syncPolicy: "oneOff", accessStatus: "restricted", importerKey: null },
  { key: "b", letter: "B", title: "Naming conventions", kind: "googleSheet", authority: "reference", syncPolicy: "repeatable", accessStatus: "public", importerKey: "namingConventions" },
  { key: "c", letter: "C", title: "Community vocabulary", kind: "googleSheet", authority: "reference", syncPolicy: "scheduledPull", accessStatus: "public", importerKey: null },
  { key: "d", letter: "D", title: "List of studies", kind: "googleSheet", authority: "historical", syncPolicy: "repeatable", accessStatus: "public", importerKey: null },
  { key: "e", letter: "E", title: "Prediction-market hypotheses", kind: "googleSheet", authority: "live", syncPolicy: "repeatable", accessStatus: "public", importerKey: null },
  { key: "f", letter: "F", title: "Recruitment and contact workbook", kind: "googleSheet", authority: "live", syncPolicy: "repeatable", accessStatus: "public", importerKey: null },
  { key: "g", letter: "G", title: "Membership and contributor workbook", kind: "googleSheet", authority: "live", syncPolicy: "repeatable", accessStatus: "restricted", importerKey: null },
  { key: "h", letter: "H", title: "Website structured data", kind: "repositoryTsv", authority: "live", syncPolicy: "repeatable", accessStatus: "public", importerKey: "websiteData" },
  { key: "i", letter: "I", title: "Quire", kind: "quire", authority: "live", syncPolicy: "oneOff", accessStatus: "unknown", importerKey: null },
  { key: "j", letter: "J", title: "Linked documents", kind: "other", authority: "reference", syncPolicy: "scheduledPull", accessStatus: "unknown", importerKey: null },
];

export function sourceDefinition(key: string): SourceDefinition | undefined {
  return SOURCE_DEFINITIONS.find((definition) => definition.key === key.toLowerCase());
}

/**
 * Writes the registry entry of a source, its tabs and, where the private configuration names
 * them, its location. A document is written only when it is missing or when what the repository
 * or the source says about it has changed, so a repeated run writes nothing. Returns the number
 * of documents written.
 */
export async function syncRegistry(
  context: RunContext,
  definition: SourceDefinition,
  tabs: readonly SourceTab[],
  location: PrivateSource | undefined,
): Promise<number> {
  const { db, now } = context;
  const wanted: { readonly entry: ReturnType<typeof entryOf>; readonly path: string; readonly fields: Record<string, unknown>; readonly initial: Record<string, unknown> }[] = [
    {
      entry: entryOf("sources"),
      path: COLLECTIONS.sources.docPath(definition.key),
      fields: {
        key: definition.key,
        title: definition.title,
        kind: definition.kind,
        authority: definition.authority,
        syncPolicy: definition.syncPolicy,
        accessStatus: definition.accessStatus,
      },
      initial: { lastFetchedAt: null },
    },
    ...tabs.map((tab) => ({
      entry: entryOf("sourceTabs"),
      path: COLLECTIONS.sourceTabs.docPath(definition.key, tab.tabKey),
      fields: {
        sourceKey: definition.key,
        tabKey: tab.tabKey,
        name: tab.name,
        ...(tab.sheetId === undefined ? {} : { sheetId: tab.sheetId }),
        visibility: tab.visibility,
        ...(tab.headerRow === undefined ? {} : { headerRow: tab.headerRow }),
        rowCount: tab.rows.filter((row) => row.rowClass === "data").length,
        ...(definition.importerKey === null ? {} : { importerKey: definition.importerKey }),
      },
      // The time at which the tab was first seen or last seen to have changed. The batches say when it was read.
      initial: { lastSeenAt: now },
    })),
  ];
  const address = location?.url === undefined && location?.externalId === undefined ? undefined : location;
  if (address !== undefined) {
    wanted.push({
      entry: entryOf("sourceLocation"),
      path: COLLECTIONS.sourceLocation.docPath(definition.key),
      fields: {
        ...(address.url === undefined ? {} : { url: address.url }),
        ...(address.externalId === undefined ? {} : { externalId: address.externalId }),
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
      batch.create(db.doc(path), validated(entry, path, { ...createdFields(now), schemaVersion: entry.schemaVersion, ...initial, ...fields }));
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
