// The scan engine against the storage fake, in memory. Fixtures are synthetic: invented servers
// on the example.org domain and files of no real recording.
import { compareManifest } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { memoryStorageFake } from "./fake";
import { FAKE_BASE_PATHS, FAKE_DATASET_PATHS, FAKE_SERVERS, syntheticBidsFiles, syntheticDigest } from "./fixtures";
import { checkTarget, scanTarget } from "./scan";
import type { StorageTarget } from "./types";

const bremen: StorageTarget = {
  protocol: "sftp",
  host: FAKE_SERVERS.bremen,
  port: null,
  basePath: FAKE_BASE_PATHS.bremen,
  path: FAKE_DATASET_PATHS.alphaAttention,
  credentialRef: "STORAGE_BREMEN_READONLY",
};

const central: StorageTarget = {
  ...bremen,
  protocol: "s3",
  host: FAKE_SERVERS.central,
  basePath: FAKE_BASE_PATHS.central,
};

describe("a metadata scan", () => {
  it("lists every file with its size and time, joins the checksums of the checksum file, and leaves that file out", async () => {
    const fake = memoryStorageFake();
    const outcome = await scanTarget(fake.adapter(), bremen, 1_000);
    if (!outcome.ok) throw new Error(outcome.message);
    const expected = syntheticBidsFiles(["01", "02", "03"], "flanker");
    expect(outcome.files.map((file) => file.relativePath).sort()).toEqual(expected.map((file) => file.path).sort());
    expect(outcome.checksumFiles).toBe(1);
    const recording = outcome.files.find((file) => file.relativePath === "sub-01/eeg/sub-01_task-flanker_eeg.eeg");
    expect(recording).toMatchObject({
      sizeBytes: 182_400_000,
      checksumAlgorithm: "sha256",
      checksum: syntheticDigest("sub-01/eeg/sub-01_task-flanker_eeg.eeg"),
      modifiedAt: "2026-10-05T14:30:00.000Z",
    });
  });

  it("reads the checksum file alone and never the content of a recording", async () => {
    const fake = memoryStorageFake();
    await scanTarget(fake.adapter(), bremen, 1_000);
    expect(fake.contentReads()).toEqual([
      `${FAKE_SERVERS.bremen}:${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}/SHA256SUMS`,
    ]);
  });

  it("takes the checksum of each object from object storage, which keeps no checksum file", async () => {
    const fake = memoryStorageFake();
    const outcome = await scanTarget(fake.adapter(), central, 1_000);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.checksumFiles).toBe(0);
    expect(outcome.files.every((file) => file.checksum !== undefined)).toBe(true);
    expect(fake.contentReads()).toEqual([]);
  });

  it("follows the pages of a long listing", async () => {
    const fake = memoryStorageFake();
    fake.transact((state) => {
      state.pageSize = 4;
    });
    const outcome = await scanTarget(fake.adapter(), bremen, 1_000);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.pages).toBe(4);
    expect(outcome.files).toHaveLength(12);
  });

  it("gives no listing at all when the server is down, so nothing can be reported missing", async () => {
    const fake = memoryStorageFake();
    fake.setMode(FAKE_SERVERS.bremen, "down");
    expect(await scanTarget(fake.adapter(), bremen, 1_000)).toEqual({
      ok: false,
      kind: "unreachable",
      message: "The server did not answer.",
    });
  });

  it("stops a call that takes too long", async () => {
    const fake = memoryStorageFake();
    fake.setLatency(FAKE_SERVERS.bremen, 200);
    expect(await scanTarget(fake.adapter(), bremen, 50)).toMatchObject({ ok: false, kind: "timeout" });
  });

  it("completes against a server that is slow but within the limit", async () => {
    const fake = memoryStorageFake();
    fake.setLatency(FAKE_SERVERS.bremen, 20);
    expect(await scanTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: true });
  });

  it("reports an account refused everywhere, or below one path", async () => {
    const fake = memoryStorageFake();
    fake.setDenied(FAKE_SERVERS.bremen, true);
    expect(await scanTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: false, kind: "permissionDenied" });
    fake.setDenied(FAKE_SERVERS.bremen, false, [`${FAKE_BASE_PATHS.bremen}/DemoAlpha2001`]);
    expect(await scanTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: false, kind: "permissionDenied" });
  });

  it("reports a path that does not exist, and a server nobody answers for", async () => {
    const fake = memoryStorageFake();
    expect(await scanTarget(fake.adapter(), { ...bremen, path: "DemoAlpha2001/nowhere" }, 1_000)).toMatchObject({
      ok: false,
      kind: "notFound",
    });
    expect(await scanTarget(fake.adapter(), { ...bremen, host: "unknown.example.org" }, 1_000)).toMatchObject({
      ok: false,
      kind: "unreachable",
    });
  });

  it("refuses a path that leaves the base path", async () => {
    const fake = memoryStorageFake();
    expect(await scanTarget(fake.adapter(), { ...bremen, path: "../outside" }, 1_000)).toMatchObject({ ok: false });
  });

  it("gives no listing when the server names a file with a control character, which is never stored", async () => {
    const fake = memoryStorageFake();
    const root = `${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}`;
    fake.putFile(FAKE_SERVERS.bremen, `${root}/notes\n!true.txt`, { size: 10, modified: "2026-10-06T08:00:00.000Z" });
    expect(await scanTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: false, kind: "failed" });
  });

  it("finds a file that went missing and one that arrived unannounced, against the earlier listing", async () => {
    const fake = memoryStorageFake();
    const first = await scanTarget(fake.adapter(), bremen, 1_000);
    if (!first.ok) throw new Error(first.message);
    const root = `${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}`;
    fake.removeFile(FAKE_SERVERS.bremen, `${root}/sub-03/eeg/sub-03_task-flanker_eeg.eeg`);
    fake.putFile(FAKE_SERVERS.bremen, `${root}/notes.txt`, { size: 10, modified: "2026-10-06T08:00:00.000Z" });
    const second = await scanTarget(fake.adapter(), bremen, 1_000);
    if (!second.ok) throw new Error(second.message);
    expect(compareManifest(second.files, first.files).counts).toEqual({ present: 11, missing: 1, unexpected: 1 });
  });
});

describe("a check of a server", () => {
  it("answers while the server is up and gives the reason while it is down", async () => {
    const fake = memoryStorageFake();
    expect(await checkTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: true });
    fake.setMode(FAKE_SERVERS.bremen, "down");
    expect(await checkTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: false, kind: "unreachable" });
    fake.setMode(FAKE_SERVERS.bremen, "up");
    expect(await checkTarget(fake.adapter(), bremen, 1_000)).toMatchObject({ ok: true });
  });
});
