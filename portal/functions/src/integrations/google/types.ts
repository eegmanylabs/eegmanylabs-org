// The interfaces through which the portal reaches Google Drive, Sheets and Docs
// (docs/INTEGRATIONS.md, sections 1 and 3). The logic that decides what to do (the planner, the
// document generator, the job runner) depends on these interfaces alone. Two implementations
// exist: the in-memory fake of `fake/`, which serves every test and the emulator, and the real
// adapters of `real/`, written from the vendor documentation and never run.
//
// The shapes follow the REST resources they stand for, narrowed to the fields the portal reads:
// a Drive `File` and `Change`, a Sheets grid with its developer metadata, a Docs document with
// its named ranges. The real adapters translate the REST JSON to these shapes and back.
import type { SheetScalar } from "@eegml/shared";

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const DOCS_MIME_TYPE = "application/vnd.google-apps.document";
export const SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

/** A channel on the Drive change log lasts a week at most. */
export const MAX_CHANNEL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The developer metadata one tab may hold, counted in characters of keys and values. */
export const METADATA_BUDGET = 30_000;

/** A Drive file or folder: the fields of the `File` resource the portal asks for. */
export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** The shared drive that holds the item, where one does. */
  readonly driveId?: string;
  readonly parents: readonly string[];
  readonly trashed: boolean;
  readonly webViewLink: string;
  /** RFC 3339. */
  readonly modifiedTime: string;
  /** A number that Drive raises on every change to the file, as a decimal string. */
  readonly version: string;
  /** Empty for an item in a shared drive, which has no individual owner. */
  readonly owners: readonly { readonly displayName: string }[];
  readonly lastModifyingUser?: { readonly displayName: string; readonly me: boolean };
  readonly capabilities: { readonly canEdit: boolean; readonly canListChildren: boolean };
}

/** One entry of the Drive change feed. A removal does not say whether the file was deleted or access was lost. */
export interface DriveChange {
  readonly fileId: string;
  readonly removed: boolean;
  readonly time: string;
  readonly file?: DriveFile;
}

export interface DriveChangePage {
  readonly changes: readonly DriveChange[];
  readonly nextPageToken?: string;
  /** Present on the last page: the token from which the next read starts. */
  readonly newStartPageToken?: string;
}

export interface DriveChannelRequest {
  readonly id: string;
  /** Sent back in every notification. Only its hash is stored. */
  readonly token: string;
  /** The public HTTPS address of the receiver. */
  readonly address: string;
  /** Milliseconds since the epoch. Drive caps a channel on the change log at one week. */
  readonly expiration: number;
}

/** One permission on a Drive item: who has access, and with which role. */
export interface DrivePermission {
  readonly type: "user" | "group" | "domain" | "anyone";
  /** `owner`, `organizer`, `fileOrganizer`, `writer`, `commenter` or `reader`. */
  readonly role: string;
  /** The address of a user or a group; absent for a domain or for anyone with the link. */
  readonly emailAddress?: string;
}

export interface DriveAdapter {
  /** The account the adapter acts as. */
  about(): Promise<{ readonly emailAddress: string }>;
  getFile(fileId: string): Promise<DriveFile>;
  /** Who has access to an item, as the portal's account may see it. */
  listPermissions(fileId: string): Promise<readonly DrivePermission[]>;
  /** Direct children of a folder, folders first, one page of up to `pageSize` items. */
  listChildren(
    folderId: string,
    pageToken?: string,
    pageSize?: number,
  ): Promise<{ readonly files: readonly DriveFile[]; readonly nextPageToken?: string }>;
  /** Copies a file into a folder. Refused outside a shared drive, where the account would own the copy. */
  copyFile(fileId: string, name: string, parentId: string): Promise<DriveFile>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<DriveChangePage>;
  watchChanges(
    pageToken: string,
    channel: DriveChannelRequest,
  ): Promise<{ readonly resourceId: string; readonly expiration: number }>;
  stopChannel(channelId: string, resourceId: string): Promise<void>;
}

/** One cell of a grid: the unformatted computed value, and the formula where one was entered. */
export interface GridCell {
  readonly value: SheetScalar;
  readonly formula?: string;
}

/** A developer metadata entry, as the Sheets interface describes one. */
export interface DeveloperMetadata {
  readonly metadataId: number;
  readonly metadataKey: string;
  readonly metadataValue: string;
  readonly location:
    | { readonly kind: "spreadsheet" }
    | { readonly kind: "row"; readonly sheetId: number; readonly index: number }
    | { readonly kind: "column"; readonly sheetId: number; readonly index: number };
}

/** One tab read in one request: entered and computed values, and the metadata of its rows and columns. */
export interface TabGrid {
  readonly sheetId: number;
  readonly title: string;
  /** Row 0 is the header. A missing cell is undefined. */
  readonly rows: readonly (readonly (GridCell | undefined)[])[];
  readonly metadata: readonly DeveloperMetadata[];
  /** The characters the tab's metadata uses, of a budget of 30,000. */
  readonly metadataCharacters: number;
}

export interface SpreadsheetInfo {
  readonly spreadsheetId: string;
  readonly title: string;
  readonly timeZone: string;
  readonly sheets: readonly { readonly sheetId: number; readonly title: string }[];
  readonly metadata: readonly DeveloperMetadata[];
}

/** Where a row write lands: the row whose metadata holds the value, or a row position. */
export type RowAddress =
  | { readonly kind: "metadata"; readonly metadataKey: string; readonly metadataValue: string }
  | { readonly kind: "position"; readonly index: number };

export interface RowWrite {
  readonly sheetId: number;
  readonly row: RowAddress;
  /** One value for each column from the first. Null skips a cell, and an empty string clears it. */
  readonly values: readonly (string | number | boolean | null)[];
}

export type SheetsRequest =
  | {
      readonly createDeveloperMetadata: {
        readonly metadataKey: string;
        readonly metadataValue: string;
        readonly location: DeveloperMetadata["location"];
      };
    }
  | { readonly updateDeveloperMetadata: { readonly metadataId: number; readonly metadataValue: string } }
  | { readonly deleteDeveloperMetadata: { readonly metadataId: number } };

export interface SheetsAdapter {
  getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetInfo>;
  readTab(spreadsheetId: string, sheetId: number): Promise<TabGrid>;
  /**
   * Writes rows raw: nothing is parsed as if typed, so no formula is injected and no format
   * changes. The answer holds each written row as it reads after the write, for the
   * read-back check. A row named by metadata is resolved to its position when the write lands.
   */
  writeRows(spreadsheetId: string, writes: readonly RowWrite[]): Promise<readonly (readonly GridCell[])[]>;
  /** Appends rows after the last row of the tab, raw. Answers the index of the first new row. */
  appendRows(
    spreadsheetId: string,
    sheetId: number,
    rows: readonly (readonly (string | number | boolean | null)[])[],
  ): Promise<number>;
  batchUpdate(spreadsheetId: string, requests: readonly SheetsRequest[]): Promise<void>;
}

export interface DocsRange {
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * A Docs document, read with suggestions shown inline. `body` is its plain text, and index `i`
 * of the interface is `body[i - 1]`: indexes count UTF-16 code units from 1.
 */
export interface DocsDocument {
  readonly documentId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly body: string;
  readonly namedRanges: readonly {
    readonly name: string;
    readonly namedRangeId: string;
    readonly ranges: readonly DocsRange[];
  }[];
  /** The ranges of pending suggestions. */
  readonly suggestions: readonly DocsRange[];
}

export type DocsRequest =
  | { readonly insertText: { readonly index: number; readonly text: string } }
  | { readonly deleteContentRange: { readonly range: DocsRange } }
  | { readonly createNamedRange: { readonly name: string; readonly range: DocsRange } }
  | { readonly deleteNamedRange: { readonly namedRangeId: string } }
  | { readonly replaceNamedRangeContent: { readonly namedRangeId: string; readonly text: string } };

export interface DocsAdapter {
  getDocument(documentId: string): Promise<DocsDocument>;
  /**
   * Applies every request or none, in order, each seeing the indexes the one before left. With
   * `requiredRevisionId`, a document that changed since that revision is refused with a 400.
   */
  batchUpdate(
    documentId: string,
    requests: readonly DocsRequest[],
    requiredRevisionId: string,
  ): Promise<{ readonly revisionId: string; readonly createdRangeIds: readonly (string | null)[] }>;
}

/** The three adapters of one Google identity. */
export interface WorkspaceAdapters {
  readonly drive: DriveAdapter;
  readonly sheets: SheetsAdapter;
  readonly docs: DocsAdapter;
  /** `fake` in the emulator and in tests, `real` once a service account is configured. */
  readonly kind: "fake" | "real";
}

/** The service an error came from. */
export type GoogleService = "drive" | "sheets" | "docs";

/**
 * An answer of a Google interface other than success. `status` is the HTTP status, and
 * `reason` the reason that Drive gives a 403 or that the error body names.
 */
export class ExternalServiceError extends Error {
  constructor(
    readonly service: GoogleService,
    readonly status: number,
    readonly reason: string | null,
    message: string,
    /** The wait the server asked for, where it named one. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ExternalServiceError";
  }
}
