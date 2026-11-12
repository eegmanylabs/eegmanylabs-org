// UNVERIFIED. Written from documentation and never run: no account on any research data server
// exists, and the portal makes no call to one (docs/INTEGRATIONS.md, section 7). Nothing in the
// emulator or in any test reaches a server: only the pure helpers of this file are unit tested.
//
// How a real adapter obtains the credential of an endpoint. The endpoint names a secret
// (`credentialRef`), which Secret Manager binds to the function as an environment variable of
// the same name; how the secrets of endpoints added after deployment are bound is settled when
// the first endpoint is connected (section 7). The secret holds JSON, whose fields depend on the
// protocol, and always names the `host` it is for and, where the institution fixed one, the
// `basePath` below which the account may be used: a credential is never sent to a host or a
// folder its secret does not name, whoever changed the endpoint. No credential is ever stored in
// Firestore or written to a log.
import { hasControlCharacter, normaliseStoragePath } from "@eegml/shared";
import { StorageError, type StorageTarget } from "../types";

/** The fields of the secret of an endpoint, read without trusting its shape. */
export type SecretFields = Readonly<Record<string, string>>;

export function credentialOf(target: StorageTarget, required: readonly string[]): SecretFields {
  if (target.credentialRef === null) {
    throw new StorageError("permissionDenied", "The endpoint names no secret, so the server cannot be reached.");
  }
  if (!/^STORAGE_[A-Z0-9_]+$/.test(target.credentialRef)) {
    throw new StorageError("permissionDenied", "The endpoint names a secret that is not a storage secret.");
  }
  const raw = process.env[target.credentialRef];
  if (raw === undefined || raw === "") {
    throw new StorageError("permissionDenied", "The secret the endpoint names is not available to this function.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageError("failed", "The secret of the endpoint is not JSON.");
  }
  if (typeof parsed !== "object" || parsed === null)
    throw new StorageError("failed", "The secret of the endpoint is not JSON.");
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") fields[key] = value;
  for (const name of [...required, "host"]) {
    if (fields[name] === undefined)
      throw new StorageError("failed", `The secret of the endpoint lacks the field ${name}.`);
  }
  if (fields.host?.toLowerCase() !== target.host.toLowerCase()) {
    throw new StorageError("permissionDenied", "The secret of the endpoint is for another host.");
  }
  if (
    fields.basePath !== undefined &&
    normaliseStoragePath(fields.basePath) !== normaliseStoragePath(target.basePath ?? "")
  ) {
    throw new StorageError("permissionDenied", "The secret of the endpoint is for another base path.");
  }
  return fields;
}

/** The full path of a copy on its server: the base path and the copy's path, with single slashes. */
export function remotePath(target: StorageTarget, relativePath = ""): string {
  if ([target.basePath ?? "", target.path, relativePath].some(hasControlCharacter)) {
    throw new StorageError("failed", "A path may not hold a control character.");
  }
  const parts = [target.basePath ?? "", target.path, relativePath]
    .flatMap((part) => part.split("/"))
    .filter((part) => part !== "" && part !== ".");
  if (parts.includes("..")) throw new StorageError("failed", "A path may not leave the base path of the endpoint.");
  return `/${parts.join("/")}`;
}
