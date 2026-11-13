// Where the emulators of the current run are. Every test reads addresses from here, and this
// file reads them from scripts/ports.mjs, so tests cannot drift from the generated configuration.
import { DEMO_PROJECT_ID, PORTAL_ROOT } from "../../scripts/paths.mjs";
import { LOCAL_HOST, portsFor, resolvePortBase } from "../../scripts/ports.mjs";

export { PORTAL_ROOT };

export const PROJECT_ID = DEMO_PROJECT_ID;
export const HOST = LOCAL_HOST;
export const PORTS = portsFor(resolvePortBase());

export const AUTH_URL = `http://${HOST}:${PORTS.auth}`;
export const FIRESTORE_URL = `http://${HOST}:${PORTS.firestore}`;
export const FUNCTIONS_URL = `http://${HOST}:${PORTS.functions}`;
export const STORAGE_URL = `http://${HOST}:${PORTS.storage}`;

export const HUB_URL = `http://${HOST}:${PORTS.hub}`;

/** The status of a clear that found a transaction in progress: a trigger that is still writing, for example. */
const CONFLICT = 409;

/**
 * Deletes every document of a project in the Firestore emulator. The emulator refuses while a
 * transaction is in progress, which a trigger of the functions emulator can be, so a refused
 * clear is tried again for a few seconds.
 *
 * With the functions emulator running, the deletions reach the triggers like any other write.
 * A suite that must not see those events clears between `setBackgroundTriggers(false)` and
 * `setBackgroundTriggers(true)`.
 */
export async function clearFirestore(projectId: string = PROJECT_ID): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const response = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
      method: "DELETE",
    });
    if (response.ok) return;
    if (response.status !== CONFLICT || Date.now() > deadline) {
      throw new Error(`Could not clear the Firestore emulator: ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Switches the Firestore triggers of the functions emulator off or on, through the emulator
 * hub. Switching them off first waits for the trigger work that is queued, so it is also the
 * way to wait for the triggers to finish. Returns false when the functions emulator is not
 * running, in which case there are no triggers to switch, and when the hub does not answer within
 * `timeoutMs`.
 */
export async function setBackgroundTriggers(enabled: boolean, timeoutMs = 120_000): Promise<boolean> {
  const action = enabled ? "enableBackgroundTriggers" : "disableBackgroundTriggers";
  try {
    return (await fetch(`${HUB_URL}/functions/${action}`, { method: "PUT", signal: AbortSignal.timeout(timeoutMs) }))
      .ok;
  } catch {
    return false;
  }
}

/** Deletes every account of a project in the Authentication emulator. */
export async function clearAuth(projectId: string = PROJECT_ID): Promise<void> {
  const response = await fetch(`${AUTH_URL}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Could not clear the Authentication emulator: ${response.status}`);
}

interface OutOfBandCode {
  email: string;
  requestType: string;
  oobLink: string;
}

/** The newest sign-in link the Authentication emulator issued for an address. */
export async function latestSignInLink(email: string, projectId: string = PROJECT_ID): Promise<string> {
  const response = await fetch(`${AUTH_URL}/emulator/v1/projects/${projectId}/oobCodes`);
  const { oobCodes } = (await response.json()) as { oobCodes: OutOfBandCode[] };
  // The emulator stores addresses in lower case.
  const wanted = email.toLowerCase();
  const link = oobCodes
    .filter((code) => code.email.toLowerCase() === wanted && code.requestType === "EMAIL_SIGNIN")
    .at(-1);
  if (!link) throw new Error(`The Authentication emulator has issued no sign-in link for ${email}.`);
  return link.oobLink;
}
