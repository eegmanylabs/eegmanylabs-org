// The vocabulary of the import framework (docs/MIGRATION_PLAN.md, section 2): what an importer
// reads, what it plans and what the framework does with the plan.
//
// An importer never writes. It reads its input into tabs of classified rows, and from those rows
// it produces a plan: the documents it intends to write and the reconciliation items it wants
// raised. The framework stores the rows as source records, compares the plan with the database
// and applies it.
import type { CollectionKey, EntityRef, ReconciliationKind } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import type { PrivateConfig, PrivateSource } from "./config";
import type { IdentityResolver } from "./identity";
import type { ItemBuilders } from "./reconcile";
import type { StudyResolver } from "./studies";

/**
 * The class of a row. Every non-empty row of a tab falls into exactly one.
 *
 * | Class         | A row that                                                        | Stored as a source record |
 * |---------------|-------------------------------------------------------------------|---------------------------|
 * | `header`      | names the columns                                                 | yes                       |
 * | `banner`      | groups columns or introduces the tab                              | yes                       |
 * | `data`        | is one record of the tab                                          | yes                       |
 * | `annotation`  | is a preamble, a footer, a footnote or a stray cell               | yes                       |
 * | `derived`     | is computed from data rows, such as a total                       | yes                       |
 * | `placeholder` | reserves a position without naming a record                       | yes                       |
 * | `filler`      | holds nothing except default values, such as unticked checkboxes  | no, counted               |
 * | `blank`       | holds nothing                                                     | no, counted               |
 */
export const ROW_CLASSES = [
  "header",
  "banner",
  "data",
  "annotation",
  "derived",
  "placeholder",
  "filler",
  "blank",
] as const;
export type RowClass = (typeof ROW_CLASSES)[number];
export type StoredRowClass = Exclude<RowClass, "filler" | "blank">;

/** One value of a raw cell record. */
export type RawScalar = string | number | boolean | null;

/**
 * The record of one cell as a source record stores it: null for an empty cell, the value alone
 * for a file of plain text, or the value with what else the source uses as data.
 *
 * | Key | Holds                                                        |
 * |-----|--------------------------------------------------------------|
 * | `v` | The stored value: for a formula, its cached result           |
 * | `t` | The stored type                                              |
 * | `f` | The formula text                                             |
 * | `l` | The hyperlink target                                         |
 *
 * An importer adds a formatting key only where its source carries meaning in that formatting.
 */
export type RawCell = RawScalar | { readonly [key: string]: RawScalar };

export interface SourceRow {
  readonly rowClass: StoredRowClass;
  /** The row in the file. Provenance only, and no part of any key. */
  readonly rowNumber: number;
  /**
   * The natural key of the row within its tab, never the row number alone. It is unique within
   * the tab and is passed through a keyed hash by the importer when it is personal.
   */
  readonly rowKey: string;
  /** The raw cell records in column order, which is the order the row hash takes them in. */
  readonly cells: readonly RawCell[];
  /** The name under which each cell is stored: a header for a text file, a column letter for a workbook. */
  readonly labels: readonly string[];
  /** True for a cell that is recorded by itself, such as a footnote beside a data row. It counts as no row. */
  readonly cellLevel?: boolean;
  /**
   * The special-category cells of the row, verbatim, by the name of each cell. They are stored
   * apart from the source record, where no client can read them. In `cells` the importer puts a
   * marker with a keyed hash in their place, so that a changed value is a new revision of the
   * row and nothing in the record, its hash or its identifier lets a reader confirm a guess.
   */
  readonly special?: Readonly<Record<string, RawCell>>;
}

export interface SourceTab {
  readonly tabKey: string;
  /** The title exactly as the source writes it. */
  readonly name: string;
  readonly visibility: "visible" | "hidden" | "veryHidden";
  /** The identifier the source itself gives the tab, where it has one. */
  readonly sheetId?: string;
  readonly headerRow?: number;
  readonly rows: readonly SourceRow[];
  /** The rows that are counted and not stored. */
  readonly fillerRows: number;
  readonly blankRows: number;
}

/** A structural failure that stops a source, or a part of it, from being imported. */
export interface StructureIssue {
  /** A stable key of the check that failed, for example `header`. */
  readonly check: string;
  /** The tab the failure is in, or null for the source as a whole. */
  readonly tabKey: string | null;
  /** What failed, in words that quote no cell content. */
  readonly message: string;
  /** What was expected and what was found, which enter the fingerprint of the item raised for the failure. */
  readonly expected: string;
  readonly found: string;
}

export interface InputFile {
  readonly name: string;
  readonly sha256: string;
}

/** What an importer read. */
export interface SourceReading {
  /** SHA-256 over everything that was read. It identifies the file and decides nothing. */
  readonly contentHash: string;
  readonly inputFiles: readonly InputFile[];
  readonly tabs: readonly SourceTab[];
  /** Failures that block the import. Where there is one, the plan stage does not run. */
  readonly issues: readonly StructureIssue[];
}

export interface ImportInput {
  /** The file or the directory to read. */
  readonly path: string;
  /** The date of the export, as the operator states it. */
  readonly observedOn: string;
  /** The commit at which a source held in a repository was read. */
  readonly commit?: string;
}

/** What an importer may use while it reads. A reading never contacts the database. */
export interface ReadContext {
  /**
   * The secret of the keyed hash, for a row key that is built from a personal value such as the
   * name of a contact. It never reaches a log or a document.
   */
  readonly secret: string;
}

/** A source row together with the source record that holds it. */
export interface RecordedRow extends SourceRow {
  readonly tabKey: string;
  readonly recordId: string;
  readonly rawHash: string;
}

/** One document that an importer intends to write. */
export interface DocumentSpec {
  readonly collection: CollectionKey;
  /** The identifiers of the document path, in the order of the path of the collection. */
  readonly ids: readonly string[];
  /** Fields that are set when the document is created and that no import touches afterwards. */
  readonly fixed?: Readonly<Record<string, unknown>>;
  /**
   * Fields that follow the source. A field is set only while it is empty or still holds what
   * this source wrote last time. Undefined says that the source holds no value now.
   */
  readonly owned?: Readonly<Record<string, unknown>>;
  /** Owned fields whose divergence raises no item, because another item already covers it. */
  readonly silent?: readonly string[];
  /** Array fields to which the import adds the members that are missing. It removes none. */
  readonly union?: Readonly<Record<string, readonly unknown[]>>;
  /** The source records behind the document. The first one supplies every owned field unless `fieldSources` says otherwise. */
  readonly sourceRecordIds: readonly string[];
  readonly fieldSources?: Readonly<Record<string, string>>;
}

export interface PlannedDocument extends Required<Omit<DocumentSpec, "fieldSources">> {
  readonly path: string;
  readonly fieldSources: Readonly<Record<string, string>>;
}

export interface ItemCandidate {
  /** The key that entered the fingerprint: the claim source and the hash of the normalised value. */
  readonly key: string;
  readonly valueSource?: string;
  readonly sourceRecordId?: string;
}

/** One reconciliation item that an importer wants raised. */
export interface PlannedItem {
  readonly fingerprint: string;
  readonly kind: ReconciliationKind;
  /** What the item is about. It enters the fingerprint and is not stored. */
  readonly subject: string;
  readonly entityRefs: readonly EntityRef[];
  readonly field?: string;
  readonly candidates: readonly ItemCandidate[];
  /** True for an item that explains why a batch cannot be applied. It is written at preview. */
  readonly blocking: boolean;
  /**
   * The key of the question itself, for a question that every source of a family states as far
   * as it knows it. A statement with further candidates supersedes the earlier statements of the
   * same question, whichever member of the family made them.
   */
  readonly subjectKey?: string;
}

export interface BlockingCheck {
  readonly check: string;
  readonly message: string;
}

/** What an importer hands back: everything it intends, and nothing written. */
export interface ImportPlan {
  readonly documents: readonly PlannedDocument[];
  readonly items: readonly PlannedItem[];
  /** Data rows that are kept as source records only, each with the reason. */
  readonly rawOnly: ReadonlyMap<string, string>;
  /** Data rows whose own record waits in the queue, although other documents may name them. */
  readonly held: ReadonlySet<string>;
  readonly blocking: readonly BlockingCheck[];
}

/** What an importer may use while it plans. It reads the database through the resolvers only. */
export interface PlanContext {
  readonly sourceKey: string;
  readonly input: ImportInput;
  /** Every stored row of the reading, by tab, each with its source record. */
  readonly rows: ReadonlyMap<string, readonly RecordedRow[]>;
  /** The secret of the keyed hash. It never reaches a log or a document. */
  readonly secret: string;
  readonly studies: StudyResolver;
  readonly identities: IdentityResolver;
  /** The builders of reconciliation items, bound to the secret. */
  readonly items: ItemBuilders;
  /** For reads that no resolver covers. An importer never writes through it. */
  readonly db: Firestore;
}

/**
 * The registry entry of a source whose key the repository cannot list, because the key is
 * derived from a private identifier: a contributor sheet. Everything in it is public.
 */
export interface DerivedSource {
  readonly key: string;
  readonly title: string;
  readonly kind: "googleSheet" | "driveFile" | "repositoryTsv" | "quire" | "osf" | "other";
  readonly authority: "historical" | "live" | "reference";
  readonly syncPolicy: "oneOff" | "repeatable" | "scheduledPull" | "twoWay";
  readonly accessStatus: "unknown" | "public" | "restricted" | "unreachable";
  readonly notes?: string;
}

/** What the operator selects where one importer serves a family of sources. */
export interface SourceSelection {
  /** The name of the member in the private configuration, as `--sheet` states it. */
  readonly selector: string | undefined;
  readonly config: PrivateConfig;
}

/**
 * One importer. A module in `sources/` exports its definition as `importer`, and the framework
 * finds it there, so adding an importer adds one file and edits none.
 */
export interface ImporterDefinition {
  /** The key of the importer, which the source registry names. */
  readonly key: string;
  /**
   * The key of the source in the registry: the lower-case letter for a lettered source. For an
   * importer that serves a family of sources it is the key of the family until `select` has
   * bound the importer to one member.
   */
  readonly sourceKey: string;
  readonly summary: string;
  /** What `--input` names, for the usage text. */
  readonly inputDescription: string;
  /**
   * For an importer that serves a family of sources, each a source of its own, as the
   * contributor sheets are: the importer of the one member that the operator selects. It
   * refuses a member that the private configuration does not register.
   */
  readonly select?: (selection: SourceSelection) => ImporterDefinition;
  /** The registry entry of the source, for a source that the repository cannot list. Its key is `sourceKey`. */
  readonly source?: DerivedSource;
  /** The private location of such a source. It reaches the location document of the registry and nothing else. */
  readonly location?: PrivateSource;
  /** Reads the input and classifies every row. Never contacts the database. */
  read(input: ImportInput, context: ReadContext): Promise<SourceReading>;
  /** Interprets the rows and returns the plan. */
  plan(context: PlanContext): Promise<ImportPlan>;
}
