// Which implementation serves the Google functions. In the emulator it is always the fake, over
// a state file of the run, so no request can leave the machine. Elsewhere the real adapters are
// used once the address of the service account is configured, and until then every Google
// connection is "not configured: credentials not supplied". No credential is ever read from
// Firestore: the service account obtains short-lived tokens from the platform.
import { defineString } from "firebase-functions/params";
import { runningInEmulator } from "../../framework";
import { initialFakeState } from "./fake/fixtures";
import { FileStore, fakeStatePath } from "./fake/store";
import { FakeWorkspace } from "./fake/workspace";
import { realAdapters } from "./real/adapters";
import type { WorkspaceAdapters } from "./types";

/** The parameter that names the service account. Empty until the administrators create one (section 10). */
export const SERVICE_ACCOUNT_PARAMETER = "GOOGLE_WORKSPACE_SERVICE_ACCOUNT";

export const NOT_CONFIGURED_MESSAGE = "Not connected: credentials not supplied.";

export type WorkspaceRuntime =
  | {
      readonly kind: "fake";
      readonly adapters: WorkspaceAdapters;
      readonly fake: FakeWorkspace;
      readonly identity: string;
    }
  | { readonly kind: "real"; readonly adapters: WorkspaceAdapters; readonly identity: string }
  | { readonly kind: "none"; readonly reason: string };

let serviceAccountParameter: ReturnType<typeof defineString> | undefined;

function serviceAccount(): string {
  // Declared on first use, as `portalOrigins` is, so that the emulator never writes its default.
  serviceAccountParameter ??= defineString(SERVICE_ACCOUNT_PARAMETER, {
    default: "",
    description: "The address of the Google service account that files are shared with. Empty until it exists.",
  });
  return serviceAccountParameter.value().trim();
}

/** The fake of an emulator run, over the run's state file. */
export function emulatorFake(): FakeWorkspace {
  return new FakeWorkspace(new FileStore(fakeStatePath(), initialFakeState));
}

export function workspaceRuntime(): WorkspaceRuntime {
  if (runningInEmulator()) {
    const fake = emulatorFake();
    return { kind: "fake", adapters: fake.adapters(), fake, identity: initialFakeState().account };
  }
  const identity = serviceAccount();
  if (identity === "") return { kind: "none", reason: NOT_CONFIGURED_MESSAGE };
  return { kind: "real", adapters: realAdapters(), identity };
}
