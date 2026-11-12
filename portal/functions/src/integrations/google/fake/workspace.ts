// The Google Workspace fake: Drive, Sheets and Docs in memory, written from the vendor
// documentation (docs/INTEGRATIONS.md, section 3.7). It earns its place by reproducing the
// awkward parts the design relies on, and a pass against it shows that the portal's logic is
// right and nothing about Google:
//
// | Service | Behaviour the fake reproduces                                                       |
// |---------|-------------------------------------------------------------------------------------|
// | Drive   | A version that rises on every change; one change-log entry per change; a removal when access is lost; channels that expire after a week at most and messages with headers only, sent again on every change; refusal to create a file outside a shared drive |
// | Sheets  | Raw writes that skip nulls and leave formats, formulas elsewhere and notes alone; row metadata that follows inserted and deleted rows and is resolved when a write lands; a switch for whether it follows a sort; the 30,000-character metadata budget; refusal of a file that is not a native spreadsheet |
// | Docs    | Indexes in UTF-16 units from 1 that shift within a batch; rejection of a whole batch for one bad request; named ranges that grow, split and vanish; refusal on a stale revision |
// | All     | A quota of requests a minute answered with 429 (403 for Drive), outages answered with 503, and faults a test arranges |
//
// Every method takes its own step through the store, so the processes of an emulator run see
// one consistent state. The methods whose names begin with a verb of a person (`editCell`,
// `insertRow`, `revokeAccess`) are what a test does as the people who keep the files.
import type { SheetScalar } from "@eegml/shared";
import {
  type DeveloperMetadata,
  DOCS_MIME_TYPE,
  type DocsAdapter,
  type DocsDocument,
  type DocsRequest,
  DRIVE_FOLDER_MIME_TYPE,
  type DriveAdapter,
  type DriveChangePage,
  type DriveChannelRequest,
  type DriveFile,
  ExternalServiceError,
  type GoogleService,
  type GridCell,
  MAX_CHANNEL_LIFETIME_MS,
  METADATA_BUDGET,
  type RowWrite,
  SHEETS_MIME_TYPE,
  type SheetsAdapter,
  type SheetsRequest,
  type SpreadsheetInfo,
  type TabGrid,
  type WorkspaceAdapters,
} from "../types";
import type {
  FakeCell,
  FakeDocument,
  FakeFault,
  FakeFile,
  FakeMetadata,
  FakeNotification,
  FakeState,
  FakeTab,
} from "./state";
import type { FakeStore } from "./store";

/** The name a person's edit is attributed to. Synthetic. */
export const PERSON_NAME = "Synthetic Sheet Editor";

const CHANGE_PAGE_SIZE = 100;

type Kind = "read" | "write";

function notFound(service: GoogleService, id: string): ExternalServiceError {
  return new ExternalServiceError(service, 404, "notFound", `File not found: ${id}.`);
}

function badRequest(service: GoogleService, message: string, reason = "badRequest"): ExternalServiceError {
  return new ExternalServiceError(service, 400, reason, message);
}

/**
 * The address the fake gives an item. It is on example.org, never Google's, so that a link in the
 * emulator never leads to a Google page for an identifier that does not exist there.
 */
export const FAKE_VIEW_ORIGIN = "https://synthetic-drive.example.org";

function webViewLink(file: FakeFile): string {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) return `${FAKE_VIEW_ORIGIN}/folders/${file.id}`;
  if (file.mimeType === DOCS_MIME_TYPE) return `${FAKE_VIEW_ORIGIN}/document/${file.id}`;
  if (file.mimeType === SHEETS_MIME_TYPE) return `${FAKE_VIEW_ORIGIN}/spreadsheets/${file.id}`;
  return `${FAKE_VIEW_ORIGIN}/file/${file.id}`;
}

function cellOf(cell: FakeCell | null | undefined): GridCell | undefined {
  if (cell === null || cell === undefined) return undefined;
  return cell.f === undefined ? { value: cell.v } : { value: cell.v, formula: cell.f };
}

function metadataCharacters(tab: FakeTab): number {
  const count = (meta: FakeMetadata) => meta.key.length + meta.value.length;
  return (
    tab.rows.reduce((total, row) => total + row.meta.reduce((sum, meta) => sum + count(meta), 0), 0) +
    tab.columnMeta.reduce((total, meta) => total + count(meta), 0)
  );
}

/** Where a position moves when the text [start, end) is deleted. */
function afterDelete(position: number, start: number, end: number): number {
  if (position <= start) return position;
  if (position >= end) return position - (end - start);
  return start;
}

export class FakeWorkspace {
  constructor(
    private readonly store: FakeStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** The adapters of the three services, backed by this workspace. */
  adapters(): WorkspaceAdapters {
    return { drive: this.drive(), sheets: this.sheets(), docs: this.docs(), kind: "fake" };
  }

  // ---------------------------------------------------------------- the shared machinery

  /**
   * Counts the request against the quota and applies any outage or fault, in a step of its own
   * so that a fault is used up even though the request then fails.
   */
  private admit(service: GoogleService, method: string, kind: Kind): void {
    const failure = this.store.transact((state): ExternalServiceError | null => {
      if (state.outage.includes(service)) {
        return new ExternalServiceError(service, 503, "backendError", "The service is currently unavailable.");
      }
      const fault = state.faults.find(
        (candidate) =>
          candidate.service === service &&
          (candidate.method === undefined || candidate.method === method) &&
          candidate.remaining > 0,
      );
      if (fault !== undefined) {
        fault.remaining -= 1;
        state.faults = state.faults.filter((candidate) => candidate.remaining > 0);
        return new ExternalServiceError(
          service,
          fault.status,
          fault.reason ?? null,
          `Arranged fault: ${fault.status}.`,
          fault.retryAfterMs ?? null,
        );
      }
      const minute = Math.floor(this.now() / 60_000) * 60_000;
      const window = state.quota[service];
      const current = window === undefined || window.start !== minute ? { start: minute, reads: 0, writes: 0 } : window;
      const used = kind === "read" ? current.reads : current.writes;
      if (used >= state.quotaPerMinute) {
        state.quota[service] = current;
        return service === "drive"
          ? new ExternalServiceError(service, 403, "userRateLimitExceeded", "User rate limit exceeded.")
          : new ExternalServiceError(
              service,
              429,
              "RATE_LIMIT_EXCEEDED",
              "Quota exceeded for quota metric requests per minute per user.",
            );
      }
      state.quota[service] =
        kind === "read" ? { ...current, reads: current.reads + 1 } : { ...current, writes: current.writes + 1 };
      return null;
    });
    if (failure !== null) throw failure;
  }

  private visible(state: FakeState, service: GoogleService, id: string): FakeFile {
    const file = state.files[id];
    if (file === undefined || !file.shared || file.trashed) throw notFound(service, id);
    return file;
  }

  /** Records a change to a file: a new version, a change-log entry and a message on every live channel. */
  private touch(state: FakeState, file: FakeFile, by: string): void {
    file.version += 1;
    file.modifiedTime = this.now();
    file.lastModifier = by;
    this.logChange(state, file.id, false);
  }

  private logChange(state: FakeState, fileId: string, removed: boolean): void {
    const seq = (state.changes.at(-1)?.seq ?? 0) + 1;
    state.changes.push({ seq, fileId, removed, time: this.now() });
    for (const channel of Object.values(state.channels)) {
      if (channel.stopped || channel.expiration <= this.now()) continue;
      channel.messageNumber += 1;
      state.outbox.push({
        channelId: channel.id,
        token: channel.token,
        messageNumber: channel.messageNumber,
        resourceState: "change",
        resourceId: channel.resourceId,
      });
    }
  }

  private nextId(state: FakeState, prefix: string): string {
    state.nextId += 1;
    return `${prefix}-${state.nextId}`;
  }

  private driveFile(state: FakeState, file: FakeFile): DriveFile {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.driveId === undefined ? {} : { driveId: file.driveId }),
      parents: file.parents,
      trashed: file.trashed,
      webViewLink: webViewLink(file),
      modifiedTime: new Date(file.modifiedTime).toISOString(),
      version: String(file.version),
      owners: file.ownerName === undefined ? [] : [{ displayName: file.ownerName }],
      lastModifyingUser: { displayName: file.lastModifier, me: file.lastModifier === state.account },
      capabilities: { canEdit: true, canListChildren: file.mimeType === DRIVE_FOLDER_MIME_TYPE },
    };
  }

  private spreadsheet(state: FakeState, id: string): { file: FakeFile; sheet: NonNullable<FakeFile["sheet"]> } {
    const file = this.visible(state, "sheets", id);
    if (file.sheet === undefined) {
      throw badRequest("sheets", "This operation is not supported for this document.", "failedPrecondition");
    }
    return { file, sheet: file.sheet };
  }

  private tab(sheet: NonNullable<FakeFile["sheet"]>, sheetId: number): FakeTab {
    const tab = sheet.tabs.find((candidate) => candidate.sheetId === sheetId);
    if (tab === undefined) throw badRequest("sheets", `No grid with id: ${sheetId}.`);
    return tab;
  }

  private document(state: FakeState, id: string): { file: FakeFile; doc: FakeDocument } {
    const file = this.visible(state, "docs", id);
    if (file.doc === undefined) throw badRequest("docs", "This operation is not supported for this document.");
    return { file, doc: file.doc };
  }

  // ---------------------------------------------------------------- Drive

  private drive(): DriveAdapter {
    return {
      about: async () => {
        this.admit("drive", "about", "read");
        return this.store.transact((state) => ({ emailAddress: state.account }));
      },
      getFile: async (fileId) => {
        this.admit("drive", "getFile", "read");
        return this.store.transact((state) => this.driveFile(state, this.visible(state, "drive", fileId)));
      },
      listPermissions: async (fileId) => {
        this.admit("drive", "listPermissions", "read");
        return this.store.transact((state) => {
          // Edit rights given on a folder reach every item inside it, as in Drive.
          const editors = new Set<string>();
          const seen = new Set<string>();
          for (let current: FakeFile | undefined = this.visible(state, "drive", fileId); current !== undefined; ) {
            if (seen.has(current.id)) break;
            seen.add(current.id);
            for (const editor of current.editors ?? []) editors.add(editor);
            const parent: string | undefined = current.parents[0];
            current = parent === undefined ? undefined : state.files[parent];
          }
          return [
            { type: "user" as const, role: "reader", emailAddress: state.account },
            ...[...editors].sort().map((emailAddress) => ({ type: "user" as const, role: "writer", emailAddress })),
          ];
        });
      },
      listChildren: async (folderId, pageToken, pageSize = 100) => {
        this.admit("drive", "listChildren", "read");
        return this.store.transact((state) => {
          const folder = this.visible(state, "drive", folderId);
          if (folder.mimeType !== DRIVE_FOLDER_MIME_TYPE) throw badRequest("drive", "The item is not a folder.");
          const children = Object.values(state.files)
            .filter((file) => file.parents.includes(folderId) && file.shared && !file.trashed)
            .sort(
              (a, b) =>
                Number(b.mimeType === DRIVE_FOLDER_MIME_TYPE) - Number(a.mimeType === DRIVE_FOLDER_MIME_TYPE) ||
                a.name.localeCompare(b.name),
            );
          const start = pageToken === undefined ? 0 : Number(pageToken);
          const page = children.slice(start, start + pageSize).map((file) => this.driveFile(state, file));
          const next = start + pageSize;
          return next < children.length ? { files: page, nextPageToken: String(next) } : { files: page };
        });
      },
      copyFile: async (fileId, name, parentId) => {
        this.admit("drive", "copyFile", "write");
        return this.store.transact((state) => {
          const source = this.visible(state, "drive", fileId);
          const parent = this.visible(state, "drive", parentId);
          if (parent.driveId === undefined) {
            // Service accounts have no storage quota and cannot own files.
            throw new ExternalServiceError(
              "drive",
              403,
              "storageQuotaExceeded",
              "Service Accounts do not have storage quota. Use shared drives.",
            );
          }
          const copy: FakeFile = {
            ...structuredClone(source),
            id: this.nextId(state, "fake-copy"),
            name,
            parents: [parentId],
            driveId: parent.driveId,
            version: 1,
            modifiedTime: this.now(),
            lastModifier: state.account,
            shared: true,
          };
          delete copy.ownerName;
          state.files[copy.id] = copy;
          this.logChange(state, copy.id, false);
          return this.driveFile(state, copy);
        });
      },
      getStartPageToken: async () => {
        this.admit("drive", "getStartPageToken", "read");
        return this.store.transact((state) => String((state.changes.at(-1)?.seq ?? 0) + 1));
      },
      listChanges: async (pageToken): Promise<DriveChangePage> => {
        this.admit("drive", "listChanges", "read");
        return this.store.transact((state) => {
          const from = Number(pageToken);
          if (!Number.isInteger(from) || from < 1) throw badRequest("drive", "Invalid page token.");
          const pending = state.changes.filter((change) => change.seq >= from);
          const page = pending.slice(0, CHANGE_PAGE_SIZE);
          const changes = page.map((change) => {
            const file = state.files[change.fileId];
            const gone = change.removed || file === undefined || !file.shared || file.trashed;
            return gone || file === undefined
              ? { fileId: change.fileId, removed: true, time: new Date(change.time).toISOString() }
              : {
                  fileId: change.fileId,
                  removed: false,
                  time: new Date(change.time).toISOString(),
                  file: this.driveFile(state, file),
                };
          });
          const last = page.at(-1)?.seq ?? from - 1;
          return pending.length > page.length
            ? { changes, nextPageToken: String(last + 1) }
            : { changes, newStartPageToken: String((state.changes.at(-1)?.seq ?? 0) + 1) };
        });
      },
      watchChanges: async (_pageToken, channel: DriveChannelRequest) => {
        this.admit("drive", "watchChanges", "write");
        return this.store.transact((state) => {
          if (state.channels[channel.id] !== undefined) throw badRequest("drive", "Channel id not unique.");
          const expiration = Math.min(channel.expiration, this.now() + MAX_CHANNEL_LIFETIME_MS);
          const resourceId = this.nextId(state, "fake-resource");
          state.channels[channel.id] = {
            id: channel.id,
            resourceId,
            token: channel.token,
            address: channel.address,
            expiration,
            stopped: false,
            messageNumber: 1,
          };
          state.outbox.push({
            channelId: channel.id,
            token: channel.token,
            messageNumber: 1,
            resourceState: "sync",
            resourceId,
          });
          return { resourceId, expiration };
        });
      },
      stopChannel: async (channelId, resourceId) => {
        this.admit("drive", "stopChannel", "write");
        this.store.transact((state) => {
          const channel = state.channels[channelId];
          if (channel === undefined || channel.resourceId !== resourceId) throw notFound("drive", channelId);
          channel.stopped = true;
        });
      },
    };
  }

  // ---------------------------------------------------------------- Sheets

  private sheets(): SheetsAdapter {
    return {
      getSpreadsheet: async (spreadsheetId): Promise<SpreadsheetInfo> => {
        this.admit("sheets", "getSpreadsheet", "read");
        return this.store.transact((state) => {
          const { file, sheet } = this.spreadsheet(state, spreadsheetId);
          return {
            spreadsheetId,
            title: file.name,
            timeZone: sheet.timeZone,
            sheets: sheet.tabs.map((tab) => ({ sheetId: tab.sheetId, title: tab.title })),
            metadata: sheet.meta.map((meta) => ({
              metadataId: meta.id,
              metadataKey: meta.key,
              metadataValue: meta.value,
              location: { kind: "spreadsheet" as const },
            })),
          };
        });
      },
      readTab: async (spreadsheetId, sheetId): Promise<TabGrid> => {
        this.admit("sheets", "readTab", "read");
        return this.store.transact((state) => {
          const tab = this.tab(this.spreadsheet(state, spreadsheetId).sheet, sheetId);
          const metadata: DeveloperMetadata[] = [
            ...tab.rows.flatMap((row, index) =>
              row.meta.map((meta) => ({
                metadataId: meta.id,
                metadataKey: meta.key,
                metadataValue: meta.value,
                location: { kind: "row" as const, sheetId, index },
              })),
            ),
            ...tab.columnMeta.map((meta) => ({
              metadataId: meta.id,
              metadataKey: meta.key,
              metadataValue: meta.value,
              location: { kind: "column" as const, sheetId, index: meta.column },
            })),
          ];
          return {
            sheetId,
            title: tab.title,
            rows: tab.rows.map((row) => row.cells.map(cellOf)),
            metadata,
            metadataCharacters: metadataCharacters(tab),
          };
        });
      },
      writeRows: async (spreadsheetId, writes: readonly RowWrite[]) => {
        this.admit("sheets", "writeRows", "write");
        return this.store.transact((state) => {
          const { file, sheet } = this.spreadsheet(state, spreadsheetId);
          // Every address is resolved before anything is written, as one request either lands whole or fails.
          const targets = writes.map((write) => {
            const tab = this.tab(sheet, write.sheetId);
            if (write.row.kind === "position") {
              if (write.row.index < 0 || write.row.index >= tab.rows.length) {
                throw badRequest("sheets", `Row ${write.row.index} is outside the grid.`);
              }
              return { tab, index: write.row.index, values: write.values };
            }
            const { metadataKey, metadataValue } = write.row;
            const matches = tab.rows.flatMap((row, index) =>
              row.meta.some((meta) => meta.key === metadataKey && meta.value === metadataValue) ? [index] : [],
            );
            if (matches.length !== 1) throw badRequest("sheets", "The data filter matched no single row.");
            return { tab, index: matches[0] ?? 0, values: write.values };
          });
          const results = targets.map(({ tab, index, values }) => {
            const row = tab.rows[index];
            if (row === undefined) throw badRequest("sheets", "The row is outside the grid.");
            values.forEach((value, column) => {
              if (value === null) return; // A null is skipped, as the values interface documents.
              const existing = row.cells[column] ?? null;
              const written: SheetScalar = value === "" ? null : value;
              // Raw input is stored as given: a text that looks like a formula stays text.
              const next: FakeCell = { v: written };
              if (existing?.fmt !== undefined) next.fmt = existing.fmt;
              if (existing?.note !== undefined) next.note = existing.note;
              while (row.cells.length <= column) row.cells.push(null);
              row.cells[column] = next;
            });
            return row.cells.map((cell) => cellOf(cell) ?? { value: null });
          });
          this.touch(state, file, state.account);
          return results;
        });
      },
      appendRows: async (spreadsheetId, sheetId, rows) => {
        this.admit("sheets", "appendRows", "write");
        return this.store.transact((state) => {
          const { file, sheet } = this.spreadsheet(state, spreadsheetId);
          const tab = this.tab(sheet, sheetId);
          // The table ends at the last row that holds a value.
          let end = tab.rows.length;
          while (end > 1 && (tab.rows[end - 1]?.cells ?? []).every((cell) => cell === null || cell.v === null))
            end -= 1;
          tab.rows.splice(
            end,
            0,
            ...rows.map((values) => ({
              cells: values.map((value): FakeCell | null =>
                value === null ? null : { v: value === "" ? null : value },
              ),
              meta: [],
            })),
          );
          this.touch(state, file, state.account);
          return end;
        });
      },
      batchUpdate: async (spreadsheetId, requests: readonly SheetsRequest[]) => {
        this.admit("sheets", "batchUpdate", "write");
        this.store.transact((state) => {
          const { file, sheet } = this.spreadsheet(state, spreadsheetId);
          const draft = structuredClone(sheet);
          for (const request of requests) {
            if ("createDeveloperMetadata" in request) {
              const { metadataKey, metadataValue, location } = request.createDeveloperMetadata;
              state.nextId += 1;
              const meta = { id: state.nextId, key: metadataKey, value: metadataValue };
              if (location.kind === "spreadsheet") draft.meta.push(meta);
              else {
                const tab = this.tab(draft, location.sheetId);
                if (location.kind === "column") tab.columnMeta.push({ ...meta, column: location.index });
                else {
                  const row = tab.rows[location.index];
                  if (row === undefined) throw badRequest("sheets", "The row is outside the grid.");
                  row.meta.push(meta);
                }
                if (metadataCharacters(tab) > METADATA_BUDGET) {
                  throw badRequest("sheets", "The developer metadata of the sheet would exceed 30,000 characters.");
                }
              }
            } else {
              const id =
                "updateDeveloperMetadata" in request
                  ? request.updateDeveloperMetadata.metadataId
                  : request.deleteDeveloperMetadata.metadataId;
              let found = false;
              const visit = (list: FakeMetadata[]) => {
                for (const [index, meta] of list.entries()) {
                  if (meta.id !== id) continue;
                  found = true;
                  if ("updateDeveloperMetadata" in request) meta.value = request.updateDeveloperMetadata.metadataValue;
                  else list.splice(index, 1);
                  return;
                }
              };
              visit(draft.meta);
              for (const tab of draft.tabs) {
                visit(tab.columnMeta);
                for (const row of tab.rows) visit(row.meta);
                if ("updateDeveloperMetadata" in request && metadataCharacters(tab) > METADATA_BUDGET) {
                  throw badRequest("sheets", "The developer metadata of the sheet would exceed 30,000 characters.");
                }
              }
              if (!found) throw badRequest("sheets", `No developer metadata with id ${id}.`);
            }
          }
          file.sheet = draft;
          this.touch(state, file, state.account);
        });
      },
    };
  }

  // ---------------------------------------------------------------- Docs

  private docs(): DocsAdapter {
    return {
      getDocument: async (documentId): Promise<DocsDocument> => {
        this.admit("docs", "getDocument", "read");
        return this.store.transact((state) => {
          const { file, doc } = this.document(state, documentId);
          return {
            documentId,
            title: file.name,
            revisionId: String(doc.revision),
            body: doc.body,
            namedRanges: doc.namedRanges.map((range) => ({
              name: range.name,
              namedRangeId: range.id,
              ranges: range.pieces.map(([startIndex, endIndex]) => ({ startIndex, endIndex })),
            })),
            suggestions: doc.suggestions.map(([startIndex, endIndex]) => ({ startIndex, endIndex })),
          };
        });
      },
      batchUpdate: async (documentId, requests: readonly DocsRequest[], requiredRevisionId) => {
        this.admit("docs", "batchUpdate", "write");
        return this.store.transact((state) => {
          const { file, doc } = this.document(state, documentId);
          if (requiredRevisionId !== String(doc.revision)) {
            throw badRequest("docs", "The document was modified after the required revision.", "failedPrecondition");
          }
          // Applied to a copy, so that one bad request rejects the whole batch.
          const draft = structuredClone(doc);
          const createdRangeIds: (string | null)[] = [];
          for (const request of requests) createdRangeIds.push(this.applyDocsRequest(state, draft, request));
          draft.revision += 1;
          file.doc = draft;
          this.touch(state, file, state.account);
          return { revisionId: String(draft.revision), createdRangeIds };
        });
      },
    };
  }

  private applyDocsRequest(state: FakeState, doc: FakeDocument, request: DocsRequest): string | null {
    if ("insertText" in request) {
      insertText(doc, request.insertText.index, request.insertText.text);
      return null;
    }
    if ("deleteContentRange" in request) {
      deleteText(doc, request.deleteContentRange.range.startIndex, request.deleteContentRange.range.endIndex);
      return null;
    }
    if ("createNamedRange" in request) {
      const { name, range } = request.createNamedRange;
      if (range.startIndex < 1 || range.endIndex <= range.startIndex || range.endIndex > doc.body.length + 1) {
        throw badRequest("docs", "Invalid range for a named range.");
      }
      const id = this.nextId(state, "fake-range");
      doc.namedRanges.push({ id, name, pieces: [[range.startIndex, range.endIndex]] });
      return id;
    }
    if ("deleteNamedRange" in request) {
      const before = doc.namedRanges.length;
      doc.namedRanges = doc.namedRanges.filter((range) => range.id !== request.deleteNamedRange.namedRangeId);
      if (doc.namedRanges.length === before) throw badRequest("docs", "No named range with that id.");
      return null;
    }
    const { namedRangeId, text } = request.replaceNamedRangeContent;
    const range = doc.namedRanges.find((candidate) => candidate.id === namedRangeId);
    const first = range?.pieces[0];
    if (range === undefined || first === undefined) throw badRequest("docs", "No named range with that id.");
    // The first piece takes the text, and every other piece is deleted with its content.
    for (const [start, end] of [...range.pieces.slice(1)].sort((a, b) => b[0] - a[0])) deleteText(doc, start, end);
    const [start, end] = range.pieces[0] ?? first;
    deleteText(doc, start, end);
    insertText(doc, start, text);
    doc.namedRanges = doc.namedRanges.filter((candidate) => candidate.id !== namedRangeId);
    if (!state.replaceDropsRange)
      doc.namedRanges.push({ id: namedRangeId, name: range.name, pieces: [[start, start + text.length]] });
    return null;
  }

  // ---------------------------------------------------------------- what tests and people do

  /** The state as it stands, for a test to look at. */
  snapshot(): FakeState {
    return this.store.transact((state) => structuredClone(state));
  }

  /** Sets a cell as a person typing in the sheet would: the value, or a formula with its computed value. */
  editCell(fileId: string, sheetId: number, row: number, column: number, value: SheetScalar, formula?: string): void {
    this.personEdits(fileId, (file) => {
      const tab = this.tab(this.requireSheet(file), sheetId);
      const target = tab.rows[row];
      if (target === undefined) throw new RangeError(`Row ${row} does not exist.`);
      while (target.cells.length <= column) target.cells.push(null);
      const existing = target.cells[column];
      const cell: FakeCell = { v: value };
      if (formula !== undefined) cell.f = formula;
      if (existing?.fmt !== undefined) cell.fmt = existing.fmt;
      if (existing?.note !== undefined) cell.note = existing.note;
      target.cells[column] = cell;
    });
  }

  /** Sets the cell of the row whose value in `keyColumn` is `key`. */
  editCellByKey(
    fileId: string,
    sheetId: number,
    keyColumn: number,
    key: string,
    column: number,
    value: SheetScalar,
  ): void {
    const row = this.rowIndexOfKey(fileId, sheetId, keyColumn, key);
    this.editCell(fileId, sheetId, row, column, value);
  }

  rowIndexOfKey(fileId: string, sheetId: number, keyColumn: number, key: string): number {
    return this.store.transact((state) => {
      const file = state.files[fileId];
      if (file === undefined) throw new RangeError(`No file ${fileId}.`);
      const index = this.tab(this.requireSheet(file), sheetId).rows.findIndex(
        (row, position) => position > 0 && row.cells[keyColumn]?.v === key,
      );
      if (index < 0) throw new RangeError(`No row with the key ${key}.`);
      return index;
    });
  }

  /** Inserts a row as a person would. Metadata below moves down with its rows. */
  insertRow(fileId: string, sheetId: number, at: number, values: readonly SheetScalar[]): void {
    this.personEdits(fileId, (file) => {
      this.tab(this.requireSheet(file), sheetId).rows.splice(at, 0, {
        cells: values.map((value) => (value === null ? null : { v: value })),
        meta: [],
      });
    });
  }

  /** Deletes a row as a person would. Its metadata is deleted with it. */
  deleteRow(fileId: string, sheetId: number, at: number): void {
    this.personEdits(fileId, (file) => {
      this.tab(this.requireSheet(file), sheetId).rows.splice(at, 1);
    });
  }

  /**
   * Sorts the data rows by one column as a person would. Whether metadata follows the rows is
   * undocumented, so the state says: with `metadataFollowsSort` false it stays at its positions.
   */
  sortRows(fileId: string, sheetId: number, column: number, descending = false): void {
    this.personEdits(fileId, (file, state) => {
      const tab = this.tab(this.requireSheet(file), sheetId);
      const [header, ...data] = tab.rows;
      if (header === undefined) return;
      const positions = data.map((row) => row.meta);
      const text = (row: (typeof data)[number]) => String(row.cells[column]?.v ?? "");
      data.sort((a, b) => (descending ? -1 : 1) * text(a).localeCompare(text(b)));
      if (!state.metadataFollowsSort) {
        for (const [index, row] of data.entries()) row.meta = positions[index] ?? [];
      }
      tab.rows = [header, ...data];
    });
  }

  /** The values of a row as they stand, for assertions. */
  rowValues(fileId: string, sheetId: number, row: number): (FakeCell | null)[] {
    return this.store.transact((state) => {
      const file = state.files[fileId];
      if (file === undefined) throw new RangeError(`No file ${fileId}.`);
      return structuredClone(this.tab(this.requireSheet(file), sheetId).rows[row]?.cells ?? []);
    });
  }

  /** Takes away the access of the portal's account, as an owner who stops sharing a file would. */
  revokeAccess(fileId: string): void {
    this.store.transact((state) => {
      const ids = new Set([fileId]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const file of Object.values(state.files)) {
          if (!ids.has(file.id) && file.parents.some((parent) => ids.has(parent))) {
            ids.add(file.id);
            grew = true;
          }
        }
      }
      for (const id of ids) {
        const file = state.files[id];
        if (file === undefined || !file.shared) continue;
        file.shared = false;
        this.logChange(state, id, true);
      }
    });
  }

  /** Gives a person edit rights on an item, as its owner would in the sharing dialog. */
  shareWithEditor(fileId: string, emailAddress: string): void {
    this.store.transact((state) => {
      const file = state.files[fileId];
      if (file === undefined) throw new RangeError(`No file ${fileId}.`);
      file.editors = [...new Set([...(file.editors ?? []), emailAddress.toLowerCase()])];
    });
  }

  /** Shares a file with the portal's account again. */
  restoreAccess(fileId: string): void {
    this.store.transact((state) => {
      const file = state.files[fileId];
      if (file === undefined) throw new RangeError(`No file ${fileId}.`);
      file.shared = true;
      this.logChange(state, fileId, false);
    });
  }

  setOutage(service: GoogleService, down: boolean): void {
    this.store.transact((state) => {
      state.outage = down ? [...new Set([...state.outage, service])] : state.outage.filter((item) => item !== service);
    });
  }

  arrangeFault(fault: Omit<FakeFault, "remaining"> & { readonly times?: number }): void {
    const { times, ...rest } = fault;
    this.store.transact((state) => {
      state.faults.push({ ...rest, remaining: times ?? 1 });
    });
  }

  setQuotaPerMinute(requests: number): void {
    this.store.transact((state) => {
      state.quotaPerMinute = requests;
    });
  }

  setBehaviour(behaviour: { readonly metadataFollowsSort?: boolean; readonly replaceDropsRange?: boolean }): void {
    this.store.transact((state) => {
      if (behaviour.metadataFollowsSort !== undefined) state.metadataFollowsSort = behaviour.metadataFollowsSort;
      if (behaviour.replaceDropsRange !== undefined) state.replaceDropsRange = behaviour.replaceDropsRange;
    });
  }

  /** The notifications sent since the last call, which a test delivers to the receiver. */
  takeNotifications(): FakeNotification[] {
    return this.store.transact((state) => state.outbox.splice(0, state.outbox.length));
  }

  /** The text of a document as it stands. */
  documentText(fileId: string): string {
    return this.store.transact((state) => this.requireDoc(state.files[fileId]).body);
  }

  /** Replaces the first occurrence of a text in a document, as a person typing would. */
  replaceInDocument(fileId: string, find: string, replacement: string): void {
    this.personEdits(fileId, (file) => {
      const doc = this.requireDoc(file);
      const at = doc.body.indexOf(find);
      if (at < 0 || find === "") throw new RangeError("The text is not in the document.");
      // The replacement takes the place of the text, inside every range that held it.
      const start = at + 1;
      const end = start + find.length;
      const delta = replacement.length - find.length;
      const move = (position: number) =>
        position <= start
          ? position
          : position >= end
            ? position + delta
            : start + Math.min(position - start, replacement.length);
      doc.body = doc.body.slice(0, start - 1) + replacement + doc.body.slice(end - 1);
      for (const range of doc.namedRanges) {
        range.pieces = range.pieces
          .map(([from, to]): [number, number] => [move(from), move(to)])
          .filter(([from, to]) => to > from);
      }
      doc.namedRanges = doc.namedRanges.filter((range) => range.pieces.length > 0);
      doc.revision += 1;
    });
  }

  /** Splits a named range in two at an index, as certain edits do in Docs. */
  splitNamedRange(fileId: string, name: string, at: number): void {
    this.personEdits(fileId, (file) => {
      const doc = this.requireDoc(file);
      const range = doc.namedRanges.find((candidate) => candidate.name === name);
      const piece = range?.pieces.find(([start, end]) => start < at && at < end);
      if (range === undefined || piece === undefined) throw new RangeError("No piece of the range spans the index.");
      range.pieces = range.pieces.flatMap((candidate) =>
        candidate === piece
          ? ([
              [piece[0], at],
              [at, piece[1]],
            ] as [number, number][])
          : [candidate],
      );
      doc.revision += 1;
    });
  }

  private requireSheet(file: FakeFile): NonNullable<FakeFile["sheet"]> {
    if (file.sheet === undefined) throw new RangeError(`${file.id} is not a spreadsheet.`);
    return file.sheet;
  }

  private requireDoc(file: FakeFile | undefined): FakeDocument {
    if (file?.doc === undefined) throw new RangeError("Not a document.");
    return file.doc;
  }

  private personEdits(fileId: string, edit: (file: FakeFile, state: FakeState) => void): void {
    this.store.transact((state) => {
      const file = state.files[fileId];
      if (file === undefined) throw new RangeError(`No file ${fileId}.`);
      edit(file, state);
      this.touch(state, file, PERSON_NAME);
    });
  }
}

/** Inserts text at a document index, moving or growing the named ranges around it. */
function insertText(doc: FakeDocument, index: number, text: string): void {
  if (!Number.isInteger(index) || index < 1 || index > doc.body.length + 1) {
    throw badRequest("docs", "Index must be inside the bounds of an existing paragraph.");
  }
  doc.body = doc.body.slice(0, index - 1) + text + doc.body.slice(index - 1);
  const shift = (position: number) => (position >= index ? position + text.length : position);
  for (const range of doc.namedRanges) {
    // Text inserted strictly inside a range grows it. Text inserted at its start lands before it.
    range.pieces = range.pieces.map(([start, end]) => [shift(start), end > index ? end + text.length : end]);
  }
  doc.suggestions = doc.suggestions.map(([start, end]) => [shift(start), end > index ? end + text.length : end]);
}

/** Deletes the text [start, end), shrinking the named ranges over it and removing those it empties. */
function deleteText(doc: FakeDocument, start: number, end: number): void {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end <= start || end > doc.body.length + 1) {
    throw badRequest("docs", "Invalid deletion range.");
  }
  doc.body = doc.body.slice(0, start - 1) + doc.body.slice(end - 1);
  const move = (position: number) => afterDelete(position, start, end);
  for (const range of doc.namedRanges) {
    range.pieces = range.pieces
      .map(([from, to]): [number, number] => [move(from), move(to)])
      .filter(([from, to]) => to > from);
  }
  doc.namedRanges = doc.namedRanges.filter((range) => range.pieces.length > 0);
  doc.suggestions = doc.suggestions
    .map(([from, to]): [number, number] => [move(from), move(to)])
    .filter(([from, to]) => to > from);
}
