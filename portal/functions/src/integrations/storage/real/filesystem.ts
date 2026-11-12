// UNVERIFIED. Written from the documentation of the file system module of Node.js and never run
// against an institutional file system (docs/INTEGRATIONS.md, section 7). Nothing in the
// emulator or in any test reaches it.
//
// An institutional file system mounted where the function runs, read with the account of the
// process: the base path of the endpoint is the mount point. A Cloud Function cannot mount an
// institution's file system, so this adapter is for a runner inside the institution; from the
// cloud, such an endpoint is described by a manifest made inside the institution and uploaded.
import { readdir, readFile, stat } from "node:fs/promises";
import { type ListedFile, type StorageAdapter, StorageError } from "../types";
import { remotePath } from "./credentials";

function failure(error: unknown): StorageError {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "ENOENT") return new StorageError("notFound", "The path does not exist.");
  if (code === "EACCES" || code === "EPERM")
    return new StorageError("permissionDenied", "The account may not read the path.");
  return new StorageError("failed", "The file system could not be read.");
}

export const filesystemAdapter: StorageAdapter = {
  check: async (target) => {
    try {
      await stat(remotePath(target));
      return "The file system is mounted.";
    } catch (error) {
      throw failure(error);
    }
  },
  list: async (target, cursor) => {
    const queue: string[] = cursor === null ? [""] : (JSON.parse(cursor) as string[]);
    const directory = queue.shift() ?? "";
    try {
      const entries = await readdir(remotePath(target, directory), { withFileTypes: true });
      const files: ListedFile[] = [];
      for (const entry of entries) {
        const relativePath = directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (entry.isDirectory()) queue.push(relativePath);
        else if (entry.isFile()) {
          const info = await stat(remotePath(target, relativePath));
          files.push({ relativePath, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() });
        }
      }
      return { files, nextCursor: queue.length === 0 ? null : JSON.stringify(queue) };
    } catch (error) {
      throw failure(error);
    }
  },
  readText: async (target, relativePath, maxBytes) => {
    try {
      const file = remotePath(target, relativePath);
      if ((await stat(file)).size > maxBytes)
        throw new StorageError("failed", "The file is larger than a checksum file may be.");
      return await readFile(file, "utf8");
    } catch (error) {
      throw error instanceof StorageError ? error : failure(error);
    }
  },
};
