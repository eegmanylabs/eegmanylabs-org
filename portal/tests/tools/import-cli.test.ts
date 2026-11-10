// Integration tests of the import command line, run as a person would run it: in a process of
// its own, against the Firestore emulator. The input is the synthetic website fixture and a
// synthetic workbook, in which every study, person and address (on example.org) is invented.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { type WebsiteFixture, websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { namingWorkbook } from "../../tools/src/import/fixtures/workbooks";
import { adminDb } from "../support/admin";
import { PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";
import {
  freshDatabase,
  OBSERVED_ON,
  removeTemporaryDirectories,
  TEST_HASH_KEY,
  temporaryDirectory,
} from "./import-support";

const EMULATOR_VARIABLES = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"];
const withEmulators = emulatorEnvironment(PORTS, PROJECT_ID);

const TSX = path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx");

function environmentOf(environment: Record<string, string | undefined>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    GCLOUD_PROJECT: undefined,
    GOOGLE_CLOUD_PROJECT: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
  };
  for (const name of EMULATOR_VARIABLES) env[name] = undefined;
  return { ...env, ...environment };
}

/** Runs the command line in a process of its own. Without `environment` no emulator is named. */
function cli(args: string[], environment: Record<string, string | undefined> = withEmulators) {
  const result = spawnSync(TSX, ["src/cli.ts", "import", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: environmentOf(environment),
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

/** The same without blocking this process, which a command needs that calls the server of this test. */
function cliWhileServing(args: string[], environment: Record<string, string | undefined>) {
  return new Promise<ReturnType<typeof cli>>((resolve, reject) => {
    const child = spawn(TSX, ["src/cli.ts", "import", ...args], {
      cwd: path.join(PORTAL_ROOT, "tools"),
      env: environmentOf(environment),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr, output: `${stdout}\n${stderr}` }));
  });
}

function fixtureDirectory(change: (fixture: WebsiteFixture) => void = () => {}): string {
  const fixture = websiteFixture();
  change(fixture);
  return writeWebsiteFixture(temporaryDirectory(), fixture);
}

const batchOf = (output: string): string => /batch (run__[0-9A-Za-z_]+)/.exec(output)?.[1] ?? "";

let server: Server;
let workbook: Uint8Array;
let config = "";
let data = "";

beforeAll(async () => {
  await freshDatabase();
  workbook = await namingWorkbook();
  server = createServer((_request, response) => {
    response.writeHead(200);
    response.end(workbook);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  config = path.join(temporaryDirectory(), "sources.json");
  const exportUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/an-invented-file-identifier/export?format=xlsx`;
  writeFileSync(
    config,
    JSON.stringify({
      hashKey: TEST_HASH_KEY,
      sources: { b: { externalId: "an-invented-file-identifier", exportUrl } },
    }),
  );
  data = fixtureDirectory();
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  removeTemporaryDirectories();
});

const runArguments = (mode: string, input = data) => [
  "run",
  "h",
  "--input",
  input,
  "--mode",
  mode,
  "--observed-on",
  OBSERVED_ON,
  "--config",
  config,
];

describe("import list and import fetch", () => {
  it("lists every source of the registry with its importer, without any database", () => {
    const result = cli(["list"], {});
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^ {2}b {2}Naming conventions: namingConventions\./m);
    expect(result.stdout).toMatch(/^ {2}h {2}Website structured data: websiteData\./m);
    expect(result.stdout).toMatch(/^ {2}j {2}Linked documents: no importer yet$/m);
  });

  it("fetches the export of a source that the private configuration names, and records its hash", async () => {
    const out = temporaryDirectory();
    const result = await cliWhileServing(["fetch", "b", "--config", config, "--out", out], {});
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const sha256 = createHash("sha256").update(workbook).digest("hex");
    expect(result.stdout).toContain(`SHA-256 ${sha256}`);
    const [record, file] = readdirSync(out).sort();
    expect(
      createHash("sha256")
        .update(readFileSync(path.join(out, file ?? "")))
        .digest("hex"),
    ).toBe(sha256);
    expect(JSON.parse(readFileSync(path.join(out, record ?? ""), "utf8"))).toMatchObject({
      sourceKey: "b",
      sha256,
      route: "anonymousExport",
    });
    // Neither the address nor the identifier of the file reaches the output.
    expect(result.output).not.toContain("an-invented-file-identifier");
    expect(result.output).not.toContain("127.0.0.1");
  });

  it("refuses to fetch a source for which the configuration names no export address", () => {
    const result = cli(["fetch", "d", "--config", config, "--out", temporaryDirectory()], {});
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("names no export address for source d");
  });
});

describe("import run, show, verify and rollback", () => {
  let previewBatch = "";
  let applyBatch = "";

  it("previews without writing an entity, and prints counts and identifiers only", async () => {
    const result = cli(runArguments("preview"));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    previewBatch = batchOf(result.stdout);
    expect(previewBatch).not.toBe("");
    expect(result.stdout).toContain("import preview of source h against demo-eegml (emulator)");
    expect(result.stdout).toContain("replications: 1 header, 6 data. Data rows: 6 imported, 0 held in the queue.");
    expect(result.stdout).toContain("persons: 15 to create, 0 to change");
    expect(result.stdout).toMatch(/Items to raise: .*conflictingLead 1, duplicatePerson 2/);
    expect((await adminDb.collection("persons").count().get()).data().count).toBe(0);
    // No name, no address and no cell content of the input is printed.
    for (const text of ["Ada", "Example", "Nowhere", "Invented", "@", "forms.example.org", "Nobody"]) {
      expect(result.output, text).not.toContain(text);
    }
  });

  it("applies the previewed batch, and a second apply performs no write and says so", async () => {
    const first = cli([...runArguments("apply"), "--preview", previewBatch]);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    applyBatch = batchOf(first.stdout);
    expect(first.stdout).toContain("persons: 15 created, 0 changed");
    expect((await adminDb.collection("persons").count().get()).data().count).toBe(15);

    const second = cli(runArguments("apply"));
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(
      "Nothing was written except the batch record: the database already holds everything this input says.",
    );
    expect(second.stdout).toContain(
      "persons: 0 created, 0 changed, 0 with source records brought up to date, 15 left alone.",
    );
    for (const text of ["Ada", "Nowhere", "@"]) expect(second.output, text).not.toContain(text);
  });

  it("shows a batch: its state, its counts and what its change log holds", () => {
    const result = cli(["show", applyBatch]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Batch ${applyBatch} in demo-eegml (emulator)`);
    expect(result.stdout).toMatch(/^ {2}mode: apply$/m);
    expect(result.stdout).toMatch(/^ {2}status: applied$/m);
    expect(result.stdout).toMatch(new RegExp(`^ {2}previewBatchId: ${previewBatch}$`, "m"));
    expect(result.stdout).toMatch(/Changes in the log: \d+ \(.*persons created 15.*replications created 6/);
    expect(cli(["show", "run__no-such-batch"]).status).toBe(2);
  });

  it("verifies the import, and fails the verification when the input says something else", () => {
    const result = cli(["verify", "h", "--input", data, "--observed-on", OBSERVED_ON, "--config", config]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "passed  secondRun: a second run would write 0 source records, 0 documents and 0 items",
    );
    expect(result.stdout).toContain("Every check passed.");
    const other = fixtureDirectory((fixture) => {
      fixture.members.pop();
    });
    const failed = cli(["verify", "h", "--input", other, "--observed-on", OBSERVED_ON, "--config", config]);
    expect(failed.status).toBe(3);
    expect(failed.stdout).toContain("FAILED  secondRun");
  });

  it("refuses a rollback, and lists the documents, when a document has changed since the batch wrote it", async () => {
    await adminDb.doc("replications/Delta1999").update({ theme: "Edited in the portal" });
    const result = cli(["rollback", applyBatch]);
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Rollback of batch");
    expect(result.stdout).toMatch(/^ {2}replications\/Delta1999$/m);
    expect(result.stdout).not.toContain("Edited in the portal");
    expect((await adminDb.collection("persons").count().get()).data().count).toBe(15);
  });

  it("rolls a batch back once nothing has changed since", async () => {
    await adminDb.doc("replications/Delta1999").update({ theme: "Attention" });
    const result = cli(["rollback", applyBatch]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /rolled back: 0 documents restored, \d+ removed, \d+ items withdrawn\. Source records were kept\./,
    );
    expect((await adminDb.collection("persons").count().get()).data().count).toBe(0);
    expect((await adminDb.collection("sourceRecords").count().get()).data().count).toBe(37);
    expect(cli(["rollback", applyBatch]).stdout).toContain("has nothing to reverse: it was rolled back already");
    expect(cli(["rollback", "run__no-such-batch"]).status).toBe(2);
  });
});

describe("the exit status of import run", () => {
  it("is 3 when a check of the source blocks the import", () => {
    const quoted = fixtureDirectory((fixture) => {
      const [first] = fixture.replications;
      if (first) first.Title = 'An invented title with a "quoted" word';
    });
    const result = cli(runArguments("apply", quoted));
    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Blocking check quote: The file replications.tsv contains double quotes.");
    expect(result.stdout).toContain("failed");
  });

  it("is 4 when the apply does not match the preview it names", () => {
    const result = cli([...runArguments("apply"), "--preview", "run__no-such-batch"]);
    expect(result.status).toBe(4);
    expect(result.stderr).toContain("does not match the previewed batch");
  });

  it("is 2 for a wrong usage, a missing input and a missing configuration", () => {
    expect(cli(["run", "h", "--input", data, "--config", config]).status).toBe(2);
    expect(cli(["run", "h", "--input", data, "--mode", "write", "--config", config]).status).toBe(2);
    expect(cli(["run", "z", "--input", data, "--mode", "preview", "--config", config]).stderr).toContain(
      'No importer exists for "z"',
    );
    expect(
      cli(["run", "h", "--input", path.join(data, "absent"), "--mode", "preview", "--config", config]).status,
    ).toBe(2);
    expect(cli(["run", "h", "--input", data, "--mode", "preview", "--frobnicate"]).stderr).toContain(
      "Unknown option --frobnicate",
    );
    const missing = cli([
      "run",
      "h",
      "--input",
      data,
      "--mode",
      "preview",
      "--config",
      path.join(data, "no-such-config.json"),
    ]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("sources.example.json");
    expect(cli([]).status).toBe(2);
  });

  it("is 2, before anything is contacted, for any target that is not the emulator", () => {
    const noEmulator = cli(runArguments("preview"), {});
    expect(noEmulator.status).toBe(2);
    expect(noEmulator.stderr).toContain("only writes to the Local Emulator Suite");
    // The production flag alone reaches nothing: it needs the project and credentials, and no emulator beside it.
    const withoutCredentials = cli(
      [...runArguments("preview"), "--production", "--project", "an-invented-project"],
      {},
    );
    expect(withoutCredentials.status).toBe(2);
    expect(withoutCredentials.stderr).toContain("needs credentials");
    const beside = cli([...runArguments("preview"), "--production", "--project", "an-invented-project"]);
    expect(beside.status).toBe(2);
    expect(beside.stderr).toContain("so the target is in doubt");
    expect(cli([...runArguments("preview"), "--project", "an-invented-project"]).stderr).toContain(
      "only together with --production",
    );
    const demonstration = cli([...runArguments("preview"), "--production", "--project", "demo-eegml"], {
      GOOGLE_APPLICATION_CREDENTIALS: path.join(data, "no-such-credentials.json"),
    });
    expect(demonstration.status).toBe(2);
    expect(demonstration.stderr).toContain("demonstration project");
    expect(existsSync(path.join(data, "no-such-credentials.json"))).toBe(false);
  });
});
