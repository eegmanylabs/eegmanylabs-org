// The fetch stage (docs/MIGRATION_PLAN.md, section 2): obtains a source as a file and records
// its SHA-256, the retrieval time and the route by which it came. While a sheet is readable by
// anyone with the link, the route is the anonymous XLSX export. The address comes from the
// private configuration and is never printed.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ToolRefusal } from "../environment";
import { sha256OfBytes } from "./values";
import { readWorkbook } from "./workbook";

export interface FetchedExport {
  /** Where the export was written. */
  readonly filePath: string;
  /** Where the record of the fetch was written, beside the export. */
  readonly recordPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly retrievedAt: string;
  /** The number of tabs of the workbook, hidden ones included. */
  readonly tabs: number;
}

export interface FetchOptions {
  readonly sourceKey: string;
  readonly exportUrl: string;
  readonly directory: string;
  readonly now?: Date;
  readonly fetchImplementation?: typeof fetch;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Downloads the export of a link-readable sheet and writes it, with the record of the fetch, to a private directory. */
export async function fetchExport(options: FetchOptions): Promise<FetchedExport> {
  const now = options.now ?? new Date();
  const url = new URL(options.exportUrl);
  // An export travels encrypted. Plain HTTP is accepted for this machine alone, which is what the tests use.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new ToolRefusal(`Refusing to fetch source ${options.sourceKey}: its export address does not use HTTPS.`);
  }
  let response: Response;
  try {
    response = await (options.fetchImplementation ?? fetch)(url, { redirect: "follow" });
  } catch {
    throw new ToolRefusal(`Could not fetch source ${options.sourceKey}: the host of its export address did not answer.`);
  }
  if (!response.ok) {
    throw new ToolRefusal(
      `Could not fetch source ${options.sourceKey}: the export answered with status ${response.status}. ` +
        "A status of 401 or 403 means that the sheet is no longer readable by anyone with the link.",
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let tabs: number;
  try {
    tabs = readWorkbook(bytes).sheets.length;
  } catch {
    // A sign-in page arrives with status 200 and is no workbook.
    throw new ToolRefusal(`Could not fetch source ${options.sourceKey}: what the export address returned is no Excel workbook.`);
  }
  const sha256 = sha256OfBytes(bytes);
  const retrievedAt = now.toISOString();
  const stem = `${options.sourceKey}-${retrievedAt.replace(/[-:.]/g, "")}`;
  mkdirSync(options.directory, { recursive: true });
  const filePath = path.join(options.directory, `${stem}.xlsx`);
  const recordPath = path.join(options.directory, `${stem}.json`);
  writeFileSync(filePath, bytes);
  writeFileSync(
    recordPath,
    `${JSON.stringify({ sourceKey: options.sourceKey, sha256, bytes: bytes.length, retrievedAt, route: "anonymousExport", tabs }, null, 2)}\n`,
  );
  return { filePath, recordPath, sha256, bytes: bytes.length, retrievedAt, tabs };
}
