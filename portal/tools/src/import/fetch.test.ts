// Unit tests of the fetch stage, against a server on this machine that serves a synthetic
// workbook. The workbook is invented, and no request leaves the machine.
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolRefusal } from "../environment";
import { fetchExport } from "./fetch";
import { namingWorkbook } from "./fixtures/workbooks";
import { readWorkbook } from "./workbook";

let server: Server;
let origin = "";
let workbook: Uint8Array;
const requests: string[] = [];
const directory = mkdtempSync(path.join(tmpdir(), "eegml-import-fetch-"));

beforeAll(async () => {
  workbook = await namingWorkbook();
  server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/export?format=xlsx") {
      response.writeHead(200, { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      response.end(workbook);
    } else if (request.url === "/moved") {
      response.writeHead(302, { location: "/export?format=xlsx" });
      response.end();
    } else if (request.url === "/sign-in") {
      // A sheet that is no longer shared answers with a page, and with status 200.
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>Sign in to continue</html>");
    } else {
      response.writeHead(403);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

describe("fetchExport", () => {
  it("downloads the export unchanged and records its hash, its size, the time and the route", async () => {
    const now = new Date("2026-11-09T14:16:48.000Z");
    const fetched = await fetchExport({ sourceKey: "b", exportUrl: `${origin}/export?format=xlsx`, directory, now });
    const sha256 = createHash("sha256").update(workbook).digest("hex");
    expect(fetched).toMatchObject({ sha256, bytes: workbook.length, retrievedAt: "2026-11-09T14:16:48.000Z", tabs: 1 });
    expect(path.basename(fetched.filePath)).toBe("b-20261109T141648000Z.xlsx");
    const stored = readFileSync(fetched.filePath);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(sha256);
    expect(readWorkbook(stored).sheets[0]?.name).toBe("Sheet1");
    // The record names the source by its key and never by its address.
    const record = readFileSync(fetched.recordPath, "utf8");
    expect(JSON.parse(record)).toEqual({
      sourceKey: "b",
      sha256,
      bytes: workbook.length,
      retrievedAt: "2026-11-09T14:16:48.000Z",
      route: "anonymousExport",
      tabs: 1,
    });
    expect(record).not.toContain("127.0.0.1");
  });

  it("follows a redirect to the export", async () => {
    const fetched = await fetchExport({
      sourceKey: "b",
      exportUrl: `${origin}/moved`,
      directory: path.join(directory, "moved"),
    });
    expect(fetched.tabs).toBe(1);
    expect(requests).toEqual(expect.arrayContaining(["/moved", "/export?format=xlsx"]));
  });

  it("refuses an answer that is no workbook, and writes nothing", async () => {
    const target = path.join(directory, "sign-in");
    await expect(fetchExport({ sourceKey: "b", exportUrl: `${origin}/sign-in`, directory: target })).rejects.toThrow(
      /no Excel workbook/,
    );
    await expect(fetchExport({ sourceKey: "b", exportUrl: `${origin}/refused`, directory: target })).rejects.toThrow(
      /status 403/,
    );
    expect(() => readdirSync(target)).toThrow();
  });

  it("never prints the address, and refuses an address that is not encrypted unless it is this machine", async () => {
    const failure = await fetchExport({ sourceKey: "b", exportUrl: `${origin}/refused`, directory }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ToolRefusal);
    expect((failure as Error).message).not.toContain(origin);
    await expect(
      fetchExport({ sourceKey: "b", exportUrl: "http://sheets.example.org/export", directory }),
    ).rejects.toThrow(/HTTPS/);
    const unreachable = () => Promise.reject(new Error("no route"));
    await expect(
      fetchExport({
        sourceKey: "b",
        exportUrl: "https://sheets.example.org/export",
        directory,
        fetchImplementation: unreachable,
      }),
    ).rejects.toThrow(/did not answer/);
  });
});
