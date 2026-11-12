// Which implementation serves the storage functions. In the emulator it is always the fake, over
// a state file of the run, so no request can leave the machine. Elsewhere the real adapters are
// used only where the parameter `STORAGE_SCANS_ENABLED` is "true", which an administrator sets
// once the first institution has agreed a protocol and an account (docs/INTEGRATIONS.md,
// section 10). Until then no scan reaches a server, and a scan says so. The real adapters are
// written and unverified: none has ever been executed.
import type { StorageProtocol } from "@eegml/shared";
import { defineString } from "firebase-functions/params";
import { runningInEmulator } from "../../framework";
import { emulatorStorageFake } from "./fake";
import { filesystemAdapter } from "./real/filesystem";
import { ftpsAdapter } from "./real/ftps";
import { s3Adapter } from "./real/s3";
import { sftpAdapter } from "./real/sftp";
import type { StorageAdapter, StorageRuntime } from "./types";

export const STORAGE_SCANS_PARAMETER = "STORAGE_SCANS_ENABLED";

export const SCANS_NOT_ENABLED_MESSAGE =
  "Scans are not switched on: no institution has agreed a protocol and an account yet. Upload a manifest made inside the institution instead.";

/** How long one call to a real server may take, in milliseconds. */
const REAL_REQUEST_TIMEOUT_MS = 30_000;

const REAL_ADAPTERS: Partial<Record<StorageProtocol, StorageAdapter>> = {
  sftp: sftpAdapter,
  ftps: ftpsAdapter,
  filesystem: filesystemAdapter,
  s3: s3Adapter,
};

let scansParameter: ReturnType<typeof defineString> | undefined;

function scansEnabled(): boolean {
  // Declared on first use, so that the emulator never writes its default.
  scansParameter ??= defineString(STORAGE_SCANS_PARAMETER, {
    default: "false",
    description: "Whether metadata scans of research data servers may run. False until an institution has agreed.",
  });
  return scansParameter.value().trim() === "true";
}

/** The runtime of the storage functions, or null where scans are not switched on. */
export function storageRuntime(): StorageRuntime | null {
  if (runningInEmulator()) return emulatorStorageFake().runtime();
  if (!scansEnabled()) return null;
  return {
    kind: "real",
    adapterFor: (protocol) => REAL_ADAPTERS[protocol] ?? null,
    requestTimeoutMs: REAL_REQUEST_TIMEOUT_MS,
  };
}
