// UNVERIFIED. Written from the OpenSSH documentation of sftp(1) and never run: no SFTP account
// exists (docs/INTEGRATIONS.md, section 7). Nothing in the emulator or in any test reaches it.
//
// SFTP through the OpenSSH client in batch mode, which keeps a library of the SSH protocol out
// of the functions. The secret holds `host`, `username`, `privateKey` and `knownHosts` (the line of the
// server's host key, so that the key is checked and never trusted on first use). Each call runs
// one batch: `ls -ln` of one directory for a page of a listing, whose cursor is the queue of
// directories still to list, and `get` of one small file for a checksum file. The account needs
// read-only rights on the paths of its datasets.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasControlCharacter } from "@eegml/shared";
import { type ListedFile, type StorageAdapter, StorageError, type StorageTarget } from "../types";
import { credentialOf, remotePath } from "./credentials";

const SFTP_TIMEOUT_MS = 60_000;

interface Session {
  readonly directory: string;
  readonly arguments: readonly string[];
}

async function session(target: StorageTarget): Promise<Session> {
  const secret = credentialOf(target, ["username", "privateKey", "knownHosts"]);
  const directory = await mkdtemp(path.join(os.tmpdir(), "eegml-sftp-"));
  const keyFile = path.join(directory, "key");
  const knownHosts = path.join(directory, "known_hosts");
  await writeFile(keyFile, `${secret.privateKey}\n`, { mode: 0o600 });
  await writeFile(knownHosts, `${secret.knownHosts}\n`, { mode: 0o600 });
  return {
    directory,
    arguments: [
      "-b",
      "-",
      "-i",
      keyFile,
      "-P",
      String(target.port ?? 22),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${knownHosts}`,
      `${secret.username}@${target.host}`,
    ],
  };
}

/** Runs one batch of sftp commands and gives its standard output. */
async function batch(target: StorageTarget, commands: readonly string[]): Promise<string> {
  const opened = await session(target);
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "sftp",
        [...opened.arguments],
        { timeout: SFTP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error === null) return resolve(stdout);
          const text = String(stderr);
          if (/Permission denied/i.test(text))
            return reject(new StorageError("permissionDenied", "The server refused the account."));
          if (/No such file/i.test(text))
            return reject(new StorageError("notFound", "The path does not exist on the server."));
          if (/Connection (refused|timed out)|Could not resolve/i.test(text)) {
            return reject(new StorageError("unreachable", "The server did not answer."));
          }
          reject(new StorageError("failed", "The SFTP session ended with an error."));
        },
      );
      child.stdin?.end(`${commands.join("\n")}\n`);
    });
  } finally {
    await rm(opened.directory, { recursive: true, force: true });
  }
}

/**
 * A path quoted for a line of an sftp batch. A control character is refused, never escaped: a
 * line break would end the command and start another, and `!` runs a local shell command.
 */
function quoted(value: string): string {
  if (hasControlCharacter(value)) throw new StorageError("failed", "A path may not hold a control character.");
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** One line of `ls -ln`: permissions, links, owner, group, size, three fields of date, and the name. */
const LS_LINE = /^([dl-])\S+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/;

export const sftpAdapter: StorageAdapter = {
  check: async (target) => {
    await batch(target, [`ls -ln ${quoted(remotePath(target))}`]);
    return "The SFTP server answered.";
  },
  list: async (target, cursor) => {
    const queue: string[] = cursor === null ? [""] : (JSON.parse(cursor) as string[]);
    const directory = queue.shift() ?? "";
    const output = await batch(target, [`ls -ln ${quoted(remotePath(target, directory))}`]);
    const files: ListedFile[] = [];
    for (const line of output.split("\n")) {
      const match = LS_LINE.exec(line.trim());
      if (match === null) continue;
      const name = (match[3] ?? "").split("/").pop() ?? "";
      if (name === "." || name === "..") continue;
      // A name comes from the server and is queued for the next batch, so it is held to the
      // rule of a path before it can reach a command line.
      if (hasControlCharacter(name)) {
        throw new StorageError("failed", "The server lists a name that holds a control character. Rename it.");
      }
      const relativePath = directory === "" ? name : `${directory}/${name}`;
      if (match[1] === "d") queue.push(relativePath);
      else if (match[1] === "-") files.push({ relativePath, sizeBytes: Number(match[2]), modifiedAt: null });
    }
    return { files, nextCursor: queue.length === 0 ? null : JSON.stringify(queue) };
  },
  readText: async (target, relativePath, maxBytes) => {
    const local = await mkdtemp(path.join(os.tmpdir(), "eegml-sftp-get-"));
    try {
      const destination = path.join(local, "file");
      await batch(target, [`get ${quoted(remotePath(target, relativePath))} ${quoted(destination)}`]);
      const text = await readFile(destination, "utf8");
      if (text.length > maxBytes) throw new StorageError("failed", "The file is larger than a checksum file may be.");
      return text;
    } finally {
      await rm(local, { recursive: true, force: true });
    }
  },
};
