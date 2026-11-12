// SYNTHETIC DATA. None of these servers, paths or files exists.
//
// The research data servers that the storage fake starts with: an SFTP server at a fictitious
// institution in Bremen, an FTPS server at one in Munich, an object store that stands for an
// optional central copy, and an institutional file system that only a manifest uploaded from
// inside the institution can describe. Every host is on the example.org domain. The files are
// named as a BIDS dataset would name them, for invented participants, and every size and digest
// is made up: a digest is the SHA-256 of the file's own name, never of any data.
import { createHash } from "node:crypto";
import type { FakeServer, FakeServerFile, StorageFakeState } from "./fake";

export const FAKE_SERVERS = {
  bremen: "sftp.bremen.example.org",
  munich: "ftps.munich.example.org",
  central: "objects.central.example.org",
  institutional: "nas.northfield.example.org",
} as const;

/** The base path of each server, as its endpoint records it. */
export const FAKE_BASE_PATHS = {
  bremen: "eeg",
  munich: "projects/eegmanylabs",
  central: "eegml-central",
  institutional: "data",
} as const;

/** The paths of the synthetic datasets below the base paths. */
export const FAKE_DATASET_PATHS = {
  alphaAttention: "DemoAlpha2001/attention-main",
  alphaSignal: "DemoAlpha2001/signal-main",
} as const;

const MODIFIED = "2026-10-05T14:30:00.000Z";

/** A made-up digest: the SHA-256 of the name of the file. */
export const syntheticDigest = (name: string) => createHash("sha256").update(`synthetic:${name}`, "utf8").digest("hex");

/** The files of a small synthetic BIDS dataset: three recordings of each participant, and the top-level files. */
export function syntheticBidsFiles(participants: readonly string[], task: string): { path: string; size: number }[] {
  const files: { path: string; size: number }[] = [
    { path: "dataset_description.json", size: 412 },
    { path: "participants.tsv", size: 96 },
    { path: "README", size: 1_204 },
  ];
  participants.forEach((label, index) => {
    const stem = `sub-${label}/eeg/sub-${label}_task-${task}_eeg`;
    files.push(
      { path: `${stem}.vhdr`, size: 1_830 + index },
      { path: `${stem}.vmrk`, size: 22_400 + index * 17 },
      { path: `${stem}.eeg`, size: 182_400_000 + index * 1_024 },
    );
  });
  return files;
}

/** The content of a `SHA256SUMS` file for the files named, in the format of `sha256sum`. */
export function checksumFile(paths: readonly string[]): string {
  return `${paths.map((name) => `${syntheticDigest(name)}  ${name}`).join("\n")}\n`;
}

function tree(
  root: string,
  files: readonly { path: string; size: number }[],
  options: { checksumFile: boolean; objectChecksums: boolean },
): Record<string, FakeServerFile> {
  const result: Record<string, FakeServerFile> = {};
  for (const file of files) {
    result[`${root}/${file.path}`] = {
      size: file.size,
      modified: MODIFIED,
      ...(options.objectChecksums ? { checksum: { algorithm: "sha256", value: syntheticDigest(file.path) } } : {}),
    };
  }
  if (options.checksumFile) {
    const text = checksumFile(files.map((file) => file.path));
    result[`${root}/SHA256SUMS`] = { size: text.length, modified: MODIFIED, text };
  }
  return result;
}

const server = (protocol: FakeServer["protocol"], files: Record<string, FakeServerFile>): FakeServer => ({
  protocol,
  mode: "up",
  latencyMs: 0,
  denyAll: false,
  deniedPaths: [],
  files,
});

export function initialStorageState(): StorageFakeState {
  const attention = syntheticBidsFiles(["01", "02", "03"], "flanker");
  // The Munich copy is incomplete: the third participant's recording has not arrived.
  const signal = syntheticBidsFiles(["01", "02"], "flanker");
  return {
    schema: 1,
    requestTimeoutMs: 2_000,
    pageSize: 500,
    reads: [],
    servers: {
      [FAKE_SERVERS.bremen]: server(
        "sftp",
        tree(`${FAKE_BASE_PATHS.bremen}/${FAKE_DATASET_PATHS.alphaAttention}`, attention, {
          checksumFile: true,
          objectChecksums: false,
        }),
      ),
      [FAKE_SERVERS.munich]: server(
        "ftps",
        tree(`${FAKE_BASE_PATHS.munich}/${FAKE_DATASET_PATHS.alphaSignal}`, signal, {
          checksumFile: true,
          objectChecksums: false,
        }),
      ),
      [FAKE_SERVERS.central]: server(
        "s3",
        tree(`${FAKE_BASE_PATHS.central}/${FAKE_DATASET_PATHS.alphaAttention}`, attention, {
          checksumFile: false,
          objectChecksums: true,
        }),
      ),
      [FAKE_SERVERS.institutional]: server("filesystem", {}),
    },
  };
}
