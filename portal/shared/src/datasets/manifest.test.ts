// Fixtures are synthetic: invented file names and digests of no real recording.
import { describe, expect, it } from "vitest";
import {
  checksumFileAlgorithm,
  checksumsOf,
  chunkManifest,
  compareManifest,
  type ManifestEntry,
  manifestMatches,
  normaliseAlgorithm,
  normalisePath,
  parseManifestText,
  receivedCount,
  validateManifest,
} from "./manifest";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

const expected: ManifestEntry[] = [
  {
    relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.vhdr",
    sizeBytes: 100,
    checksumAlgorithm: "sha256",
    checksum: SHA_A,
  },
  {
    relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.eeg",
    sizeBytes: 5_000,
    checksumAlgorithm: "sha256",
    checksum: SHA_B,
  },
  { relativePath: "sub-02/eeg/sub-02_task-oddball_eeg.eeg", sizeBytes: 5_100 },
];

describe("normalisePath", () => {
  it("gives the canonical form of a relative path", () => {
    expect(normalisePath("./sub-01\\eeg//file.eeg")).toBe("sub-01/eeg/file.eeg");
    expect(normalisePath("/sub-01/eeg/")).toBe("sub-01/eeg");
  });

  it("refuses a path that is empty or leaves the root", () => {
    expect(normalisePath("")).toBeNull();
    expect(normalisePath("./")).toBeNull();
    expect(normalisePath("sub-01/../../secret")).toBeNull();
  });
});

describe("normaliseAlgorithm and checksumFileAlgorithm", () => {
  it("know the usual spellings", () => {
    expect(normaliseAlgorithm("SHA-256")).toBe("sha256");
    expect(normaliseAlgorithm("md5")).toBe("md5");
    expect(normaliseAlgorithm("crc32")).toBeNull();
    expect(checksumFileAlgorithm("derivatives/SHA256SUMS")).toBe("sha256");
    expect(checksumFileAlgorithm("sub-01/eeg/file.eeg")).toBeNull();
  });
});

describe("compareManifest", () => {
  it("marks every listed file present when there is no expected manifest", () => {
    const result = compareManifest(expected, null);
    expect(result.files.map((file) => file.status)).toEqual(["present", "present", "present"]);
    expect(result.counts).toEqual({ present: 3 });
  });

  it("finds what is present, missing, unexpected, duplicated and different", () => {
    const listed: ManifestEntry[] = [
      // Present, with the case of its extension changed and a leading ./ added.
      {
        relativePath: "./sub-01/eeg/sub-01_task-oddball_eeg.VHDR",
        sizeBytes: 100,
        checksumAlgorithm: "SHA-256",
        checksum: SHA_A.toUpperCase(),
      },
      // Present with another size: a mismatch.
      {
        relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.eeg",
        sizeBytes: 4_000,
        checksumAlgorithm: "sha256",
        checksum: SHA_B,
      },
      // Not expected.
      { relativePath: "notes/session-log.txt", sizeBytes: 12 },
      // A copy of the first file under another name: a duplicate by its checksum.
      { relativePath: "backup/header-copy.vhdr", sizeBytes: 100, checksumAlgorithm: "sha256", checksum: SHA_A },
      // The same path again: a duplicate by its path.
      { relativePath: "notes/session-log.txt", sizeBytes: 12 },
    ];
    const result = compareManifest(listed, expected);
    expect(result.files.map((file) => [file.relativePath, file.status])).toEqual([
      ["./sub-01/eeg/sub-01_task-oddball_eeg.VHDR", "present"],
      ["sub-01/eeg/sub-01_task-oddball_eeg.eeg", "mismatch"],
      ["notes/session-log.txt", "unexpected"],
      ["backup/header-copy.vhdr", "duplicate"],
      ["notes/session-log.txt", "duplicate"],
      ["sub-02/eeg/sub-02_task-oddball_eeg.eeg", "missing"],
    ]);
    expect(result.files[1]).toMatchObject({ expectedSizeBytes: 5_000, expectedChecksum: SHA_B });
    expect(result.counts).toEqual({ present: 1, mismatch: 1, unexpected: 1, duplicate: 2, missing: 1 });
    expect(manifestMatches(result.counts)).toBe(false);
    expect(receivedCount(result.counts)).toBe(2);
  });

  it("keeps the copy at the expected path as the original, wherever it is listed", () => {
    const listed: ManifestEntry[] = [
      { relativePath: "stray/copy.vhdr", checksumAlgorithm: "sha256", checksum: SHA_A },
      { relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.vhdr", checksumAlgorithm: "sha256", checksum: SHA_A },
    ];
    const result = compareManifest(listed, expected.slice(0, 1));
    expect(result.files.map((file) => file.status)).toEqual(["duplicate", "present"]);
  });

  it("finds no difference where a checksum of another algorithm or an absent size says nothing", () => {
    const listed: ManifestEntry[] = [
      { relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.vhdr", checksumAlgorithm: "md5", checksum: "d".repeat(32) },
      { relativePath: "sub-01/eeg/sub-01_task-oddball_eeg.eeg", checksumAlgorithm: "sha256", checksum: SHA_B },
      {
        relativePath: "sub-02/eeg/sub-02_task-oddball_eeg.eeg",
        sizeBytes: 5_100,
        checksumAlgorithm: "sha256",
        checksum: SHA_C,
      },
    ];
    const result = compareManifest(listed, expected);
    expect(result.counts).toEqual({ present: 3 });
    expect(manifestMatches(result.counts)).toBe(true);
  });

  it("reports every expected file missing from an empty listing that succeeded", () => {
    const result = compareManifest([], expected);
    expect(result.counts).toEqual({ missing: 3 });
    expect(receivedCount(result.counts)).toBe(0);
  });
});

describe("validateManifest", () => {
  it("names the position of each problem", () => {
    expect(
      validateManifest([
        { relativePath: "../outside.eeg" },
        { relativePath: "ok.eeg", sizeBytes: -1 },
        { relativePath: "ok2.eeg", checksum: SHA_A },
        { relativePath: "ok3.eeg", checksumAlgorithm: "sha256", checksum: "abc" },
        { relativePath: "ok4.eeg", checksumAlgorithm: "whirlpool", checksum: SHA_A },
        { relativePath: "fine.eeg", sizeBytes: 3, checksumAlgorithm: "md5", checksum: "0".repeat(32) },
      ]).map((problem) => problem.position),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("parseManifestText", () => {
  it("reads the output of sha256sum and md5sum, telling the algorithm by the digest", () => {
    const parsed = parseManifestText(
      `# synthetic checksums\n${SHA_A}  sub-01/eeg/a.vhdr\n${"e".repeat(32)} *sub-01/eeg/a.eeg\n\n`,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.files).toEqual([
      { relativePath: "sub-01/eeg/a.vhdr", checksumAlgorithm: "sha256", checksum: SHA_A },
      { relativePath: "sub-01/eeg/a.eeg", checksumAlgorithm: "md5", checksum: "e".repeat(32) },
    ]);
  });

  it("reads comma-separated values under a header that names path", () => {
    const parsed = parseManifestText(
      `Path,Size,Checksum,Algorithm\n"sub-01/eeg/a, b.eeg",42,${SHA_B},SHA-256\nsub-02/eeg/c.eeg,,,\n`,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.files).toEqual([
      { relativePath: "sub-01/eeg/a, b.eeg", sizeBytes: 42, checksumAlgorithm: "sha256", checksum: SHA_B },
      { relativePath: "sub-02/eeg/c.eeg" },
    ]);
  });

  it("reports lines it cannot read and an empty manifest", () => {
    expect(parseManifestText("not a manifest line").problems).toHaveLength(1);
    expect(parseManifestText("path,size\nx.eeg,big\n").problems).toEqual([
      { position: 2, message: "The size is not a whole number of bytes." },
    ]);
    expect(parseManifestText("\n# nothing\n").problems[0]?.message).toBe("The manifest lists no file.");
  });

  it("joins the checksums of a checksum file by canonical path", () => {
    const found = checksumsOf(`${SHA_C}  ./sub-03/eeg/x.eeg\n`, "sha256");
    expect(found.get("sub-03/eeg/x.eeg")).toEqual({ algorithm: "sha256", checksum: SHA_C });
  });
});

describe("chunkManifest", () => {
  it("cuts by the number of files and by size", () => {
    const files = Array.from({ length: 5 }, (_, index) => ({ relativePath: `file-${index}` }));
    expect(chunkManifest(files, 2).map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    expect(chunkManifest(files, 100, 40).map((chunk) => chunk.length)).toEqual([1, 1, 1, 1, 1]);
    expect(chunkManifest([], 2)).toEqual([]);
  });
});
