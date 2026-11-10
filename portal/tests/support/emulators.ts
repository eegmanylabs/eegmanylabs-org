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

/** Deletes every document of a project in the Firestore emulator. Does not fire triggers. */
export async function clearFirestore(projectId: string = PROJECT_ID): Promise<void> {
  const response = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Could not clear the Firestore emulator: ${response.status}`);
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
