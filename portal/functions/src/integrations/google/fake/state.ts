// The state of the Google Workspace fake: a small Drive with folders, spreadsheets and documents,
// its change log and push channels, and the faults a test has arranged. It is plain JSON, so it
// can live in memory or in a file that several processes share.
import type { SheetScalar } from "@eegml/shared";
import type { GoogleService } from "../types";

/** One cell: its value, its formula, and its formatting and note, which the fake holds so tests can prove they survive. */
export interface FakeCell {
  v: SheetScalar;
  /** The formula as entered. `v` is then the computed value, which the fake does not recalculate. */
  f?: string;
  /** Formatting, kept as given and never read: number format, colours, bold and so on. */
  fmt?: Record<string, unknown>;
  note?: string;
}

export interface FakeMetadata {
  id: number;
  key: string;
  value: string;
}

export interface FakeRow {
  cells: (FakeCell | null)[];
  /** Developer metadata on the row, which moves with the row when rows are inserted or deleted above it. */
  meta: FakeMetadata[];
}

export interface FakeTab {
  sheetId: number;
  title: string;
  /** Row 0 is the header. */
  rows: FakeRow[];
  /** Developer metadata on columns, by column index. */
  columnMeta: (FakeMetadata & { column: number })[];
}

export interface FakeSpreadsheet {
  timeZone: string;
  tabs: FakeTab[];
  meta: FakeMetadata[];
}

export interface FakeNamedRange {
  id: string;
  name: string;
  /** Each piece as [start, end) in document indexes, which count from 1. */
  pieces: [number, number][];
}

export interface FakeDocument {
  body: string;
  revision: number;
  namedRanges: FakeNamedRange[];
  suggestions: [number, number][];
}

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  /** The shared drive that holds the item, where one does. */
  driveId?: string;
  trashed: boolean;
  /** Milliseconds since the epoch. */
  modifiedTime: number;
  version: number;
  ownerName?: string;
  lastModifier: string;
  /** Whether the portal's account can open the item: shared with it, or inside a folder that is. */
  shared: boolean;
  /** The addresses of the people who may edit the item, on top of what its folders give them. */
  editors?: string[];
  sheet?: FakeSpreadsheet;
  doc?: FakeDocument;
}

export interface FakeChannel {
  id: string;
  resourceId: string;
  token: string;
  address: string;
  expiration: number;
  stopped: boolean;
  messageNumber: number;
}

/** A push notification as Drive would send it: headers only, no body. */
export interface FakeNotification {
  channelId: string;
  token: string;
  messageNumber: number;
  resourceState: "sync" | "change";
  resourceId: string;
}

/** A fault a test has arranged: the next `remaining` calls that match answer with this error. */
export interface FakeFault {
  service: GoogleService;
  /** The method to fail, or every method of the service where absent. */
  method?: string;
  status: number;
  reason?: string;
  retryAfterMs?: number;
  remaining: number;
}

export interface FakeQuotaWindow {
  /** The start of the current minute, in milliseconds since the epoch. */
  start: number;
  reads: number;
  writes: number;
}

export interface FakeState {
  schema: 1;
  /** The address of the account the fake answers as. Synthetic, on example.org. */
  account: string;
  files: Record<string, FakeFile>;
  /** The change log: one entry for each change to a file the account can see, or a removal. */
  changes: { seq: number; fileId: string; removed: boolean; time: number }[];
  channels: Record<string, FakeChannel>;
  /** Notifications that have been "sent", for a test to deliver to the receiver. */
  outbox: FakeNotification[];
  faults: FakeFault[];
  /** Services that answer every call with 503 until the outage ends. */
  outage: GoogleService[];
  /** Requests a minute for one user, as the Sheets and Docs quotas count them. */
  quotaPerMinute: number;
  quota: Partial<Record<GoogleService, FakeQuotaWindow>>;
  /** Whether a sort moves row metadata with the rows. Undocumented, so tests try both. */
  metadataFollowsSort: boolean;
  /** Whether replacing the content of a named range removes the range, which the vendor leaves unstated. */
  replaceDropsRange: boolean;
  nextId: number;
}
