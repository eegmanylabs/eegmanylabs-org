// Integration tests of citations:verify against the Firestore emulator. The replications and
// manuscripts come from the synthetic website data, and the registry of DOIs is a function or a
// local server of the test: no request leaves this machine. Every work and DOI here is invented.
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { DocumentData } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { firstAuthorPart, type RetrievedWork } from "../../tools/src/citations/compare";
import type { CrossrefAnswer } from "../../tools/src/citations/crossref";
import { CITATION_CHECK_ACTOR, verifyCitations } from "../../tools/src/commands/citations-verify";
import { writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";
import {
  allDocuments,
  differences,
  documentsOf,
  freshDatabase,
  removeTemporaryDirectories,
  run,
  schemaProblems,
  temporaryDirectory,
} from "./import-support";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const directory = () => writeWebsiteFixture(temporaryDirectory());

/** What the registry holds for a stored document when it agrees with it in every field. */
function agreeing(collection: "replications" | "manuscripts", data: DocumentData): RetrievedWork {
  const replication = collection === "replications";
  const year = replication ? (data.originalYear as number) : (data.publishedAt.toDate() as Date).getUTCFullYear();
  return {
    doi: String(replication ? data.originalDoi : data.doi).toLowerCase(),
    title: String(replication ? data.originalTitle : data.title),
    subtitle: null,
    years: [year],
    firstAuthorFamily: firstAuthorPart(String(replication ? data.originalAuthors : data.authorsShort)),
    firstAuthorGiven: null,
    containerTitle: "Journal of Synthetic Results",
    type: "journal-article",
  };
}

/** A registry that agrees with every stored document, except where the test says otherwise by DOI. */
async function registry(overrides: Readonly<Record<string, CrossrefAnswer>> = {}) {
  const works = new Map<string, CrossrefAnswer>();
  for (const collection of ["replications", "manuscripts"] as const) {
    for (const data of (await documentsOf(collection)).values()) {
      const doi = collection === "replications" ? data.originalDoi : data.doi;
      if (typeof doi === "string") works.set(doi, { status: "found", work: agreeing(collection, data) });
    }
  }
  const asked: string[] = [];
  const lookUp = (doi: string): Promise<CrossrefAnswer> => {
    asked.push(doi);
    return Promise.resolve(overrides[doi] ?? works.get(doi) ?? { status: "notFound" });
  };
  return { lookUp, asked, works };
}

const check = (lookUp: (doi: string) => Promise<CrossrefAnswer>, dryRun = false) =>
  verifyCitations(adminDb, { lookUp, pauseMs: 0, now: NOW, dryRun });

async function replicationWithDoi(): Promise<[string, DocumentData][]> {
  return [...(await documentsOf("replications"))].filter(([, data]) => typeof data.originalDoi === "string");
}

beforeEach(async () => {
  await freshDatabase();
  await run(website, directory(), "apply");
});
afterAll(removeTemporaryDirectories);

describe("citations:verify", () => {
  it("records a citation that agrees as verified, with what the registry returned and when", async () => {
    const { lookUp, asked } = await registry();
    const report = await check(lookUp);
    const replications = await replicationWithDoi();
    expect(replications.length).toBeGreaterThan(2);
    expect(report.counts.replications).toMatchObject({
      withDoi: replications.length,
      verified: replications.length,
      mismatch: 0,
      notFound: 0,
      notChecked: 0,
      written: replications.length,
    });
    expect(report.mismatches).toEqual([]);
    // One DOI is asked once.
    expect(new Set(asked).size).toBe(asked.length);
    expect(report.requests).toBe(asked.length);
    for (const [, data] of replications) {
      expect(data).toMatchObject({
        citationStatus: "verified",
        citationSource: "Crossref",
        citationMetadata: {
          title: data.originalTitle,
          years: [data.originalYear],
          comparison: { title: "same", year: "same", firstAuthor: "same" },
        },
        updatedBy: CITATION_CHECK_ACTOR,
      });
      expect(data.citationCheckedAt.toDate()).toEqual(NOW);
    }
    const manuscripts = [...(await documentsOf("manuscripts")).values()].filter((data) => typeof data.doi === "string");
    expect(report.counts.manuscripts).toMatchObject({ withDoi: manuscripts.length, verified: manuscripts.length });
    for (const data of manuscripts) {
      expect(data).toMatchObject({
        citationStatus: "verified",
        citationMetadata: { source: "Crossref", checkedAt: NOW.toISOString() },
      });
    }
    expect(await schemaProblems()).toEqual([]);
  });

  it("records a difference as a mismatch, names the field, and never touches the stored reference", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const { lookUp, works } = await registry();
    const held = works.get(stored.originalDoi as string);
    if (held?.status !== "found") throw new Error("The registry of the test holds no work for the first replication.");
    const other: CrossrefAnswer = {
      status: "found",
      work: { ...held.work, years: [1900], title: "A title that the portal does not hold" },
    };
    const before = await allDocuments();
    const report = await check((doi) => (doi === stored.originalDoi ? Promise.resolve(other) : lookUp(doi)));
    expect(report.mismatches).toEqual([{ path: `replications/${first}`, fields: ["title", "year"] }]);
    const after = (await adminDb.doc(`replications/${first}`).get()).data() ?? {};
    expect(after).toMatchObject({
      citationStatus: "mismatch",
      citationMetadata: {
        title: "A title that the portal does not hold",
        years: [1900],
        comparison: { title: "differs", year: "differs", firstAuthor: "same" },
      },
    });
    // The check writes its own fields and the standard fields of a write. Everything else stays as it was.
    const own = ["citationStatus", "citationCheckedAt", "citationSource", "citationMetadata", "updatedAt", "updatedBy"];
    for (const [field, value] of Object.entries(before.get(`replications/${first}`)?.data ?? {})) {
      if (!own.includes(field) && field !== "writeContext") expect(after[field], field).toEqual(value);
    }
    expect(after).toMatchObject({
      originalTitle: stored.originalTitle,
      originalYear: stored.originalYear,
      originalAuthors: stored.originalAuthors,
      originalReference: stored.originalReference,
      originalDoi: stored.originalDoi,
    });
    // Nothing but replications and manuscripts is written.
    const { created, removed, rewritten } = differences(before, await allDocuments());
    expect([created, removed]).toEqual([[], []]);
    expect(rewritten.every((documentPath) => /^(replications|manuscripts)\/[^/]+$/.test(documentPath))).toBe(true);
  });

  it("records a DOI that the registry does not hold as not found", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const { lookUp } = await registry({ [stored.originalDoi as string]: { status: "notFound" } });
    const report = await check(lookUp);
    expect(report.notFound).toEqual([`replications/${first}`]);
    expect(report.counts.replications.notFound).toBe(1);
    expect((await adminDb.doc(`replications/${first}`).get()).data()).toMatchObject({
      citationStatus: "notFound",
      citationMetadata: { doi: stored.originalDoi },
    });
  });

  it("keeps a citation unverified where another agency registered the DOI, and names the agency", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const { lookUp } = await registry({
      [stored.originalDoi as string]: { status: "otherAgency", agency: "datacite" },
    });
    const report = await check(lookUp);
    expect(report.otherAgency).toEqual([`replications/${first}`]);
    expect(report.counts.replications).toMatchObject({ otherAgency: 1, notFound: 0, mismatch: 0 });
    expect((await adminDb.doc(`replications/${first}`).get()).data()).toMatchObject({
      citationStatus: "unverified",
      citationMetadata: { doi: stored.originalDoi, registrationAgency: "datacite" },
    });
    expect((await check(lookUp)).counts.replications.written).toBe(0);
  });

  it("leaves a citation that could not be checked unverified and unwritten", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const before = (await adminDb.doc(`replications/${first}`).get()).updateTime;
    const { lookUp } = await registry({
      [stored.originalDoi as string]: { status: "unavailable", reason: "status503" },
    });
    const report = await check(lookUp);
    expect(report.counts.replications.notChecked).toBe(1);
    const after = await adminDb.doc(`replications/${first}`).get();
    expect(after.get("citationStatus")).toBe("unverified");
    expect(after.get("citationMetadata")).toBeUndefined();
    expect(after.updateTime).toEqual(before);
  });

  it("keeps a citation unverified where the registry returns no author, and records what it returned", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const { lookUp, works } = await registry();
    const held = works.get(stored.originalDoi as string);
    if (held?.status !== "found") throw new Error("The registry of the test holds no work for the first replication.");
    const anonymous: CrossrefAnswer = { status: "found", work: { ...held.work, firstAuthorFamily: null } };
    const report = await check((doi) => (doi === stored.originalDoi ? Promise.resolve(anonymous) : lookUp(doi)));
    expect(report.counts.replications.incomplete).toBe(1);
    expect((await adminDb.doc(`replications/${first}`).get()).data()).toMatchObject({
      citationStatus: "unverified",
      citationMetadata: { comparison: { title: "same", year: "same", firstAuthor: "notRetrieved" } },
    });
  });

  it("writes nothing on a second run, nothing on a dry run, and survives a new import of the source", async () => {
    const { lookUp } = await registry();
    const dry = await check(lookUp, true);
    expect(dry.counts.replications.written).toBeGreaterThan(0);
    expect(
      [...(await documentsOf("replications")).values()].every((data) => data.citationStatus === "unverified"),
    ).toBe(true);

    await check(lookUp);
    const settled = await allDocuments();
    const second = await check(lookUp);
    expect(second.counts.replications).toMatchObject({ written: 0, unchanged: second.counts.replications.withDoi });
    expect(second.counts.manuscripts).toMatchObject({ written: 0, unchanged: second.counts.manuscripts.withDoi });
    expect(differences(settled, await allDocuments())).toEqual({ created: [], removed: [], rewritten: [] });

    // The importer sets the status when it creates a replication and never afterwards, so the check stands.
    expect((await run(website, directory(), "apply")).documentsWritten).toBe(0);
    expect([...(await replicationWithDoi()).values()].every(([, data]) => data.citationStatus === "verified")).toBe(
      true,
    );
  });
});

describe("the command line of citations:verify", () => {
  const seen: { readonly url: string; readonly headers: IncomingHttpHeaders }[] = [];
  let server: Server | undefined;
  /** Runs the command in a process of its own, without blocking this one, which serves the registry of the test. */
  const cli = (args: readonly string[], env: Record<string, string | undefined> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(
        path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "citations:verify", ...args],
        {
          cwd: path.join(PORTAL_ROOT, "tools"),
          env: { ...process.env, GCLOUD_PROJECT: undefined, ...emulatorEnvironment(PORTS, PROJECT_ID), ...env },
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  afterAll(() => server?.close());

  it("asks a registry for each DOI, prints counts and paths only, and says when a citation could not be checked", async () => {
    const [[first, stored] = ["", {} as DocumentData]] = await replicationWithDoi();
    const { works } = await registry();
    server = createServer((request, response) => {
      seen.push({ url: request.url ?? "", headers: request.headers });
      const doi = decodeURIComponent((request.url ?? "").replace(/^\/works\//, ""));
      const held = works.get(doi);
      if (doi === stored.originalDoi) {
        response.writeHead(503).end();
      } else if (held?.status === "found") {
        const { work } = held;
        const message = {
          DOI: work.doi,
          title: [work.title],
          issued: { "date-parts": [[work.years[0]]] },
          author: [{ family: work.firstAuthorFamily, sequence: "first" }],
        };
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ message }));
      } else {
        response.writeHead(404).end("Resource not found.");
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/works/`;

    const result = await cli(["--api", api]);
    expect(result.status, result.stderr).toBe(3);
    expect(result.stdout).toMatch(/replications: \d+ with a DOI, \d+ without\. \d+ verified, 0 mismatch, 0 not found/);
    expect(result.stdout).toContain("1 citations could not be checked and stay as they were.");
    expect((await adminDb.doc(`replications/${first}`).get()).get("citationStatus")).toBe("unverified");
    // A request names a DOI and a generic client. It carries no cookie, no credential and no address of anybody.
    expect(seen.length).toBeGreaterThan(2);
    for (const request of seen) {
      expect(request.url).toMatch(/^\/works\/10\./);
      expect(request.headers["user-agent"]).toBe("citation-check/1.0");
      expect(Object.keys(request.headers).filter((name) => /cookie|authorization|from|referer/i.test(name))).toEqual(
        [],
      );
    }
    // Nothing of a reference is printed: no title and no author.
    for (const data of (await documentsOf("replications")).values()) {
      expect(result.stdout).not.toContain(String(data.originalTitle));
    }
  });

  it("refuses a registry over plain HTTP, an unknown option, and a target that is no emulator", async () => {
    const plain = await cli(["--api", "http://registry.example.org/works/"]);
    expect(plain.status).toBe(2);
    expect(plain.stderr).toContain("does not use HTTPS");
    expect((await cli(["--everything"])).status).toBe(2);
    expect((await cli(["--api"])).status).toBe(2);
    const noEmulator = await cli([], { FIRESTORE_EMULATOR_HOST: undefined, FIREBASE_AUTH_EMULATOR_HOST: undefined });
    expect(noEmulator.status).toBe(2);
    expect(noEmulator.stderr).toContain("Refusing to run");
  });
});
