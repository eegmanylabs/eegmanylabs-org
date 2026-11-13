// Asks the emulators, as a browser client would, whether the security rules still decide reads
// after a restore. The requests carry unsigned sign-in tokens, which only the emulators accept.

/** An unsigned sign-in token for an account, in the form the emulators accept. */
export function emulatorToken(projectId: string, uid: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const header = { alg: "none", typ: "JWT" };
  const payload = {
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    auth_time: nowSeconds,
    sub: uid,
    user_id: uid,
    firebase: { identities: {}, sign_in_provider: "custom" },
  };
  return `${encode(header)}.${encode(payload)}.`;
}

export type ProbeOutcome = "allowed" | "denied" | "other";

function outcomeOf(status: number): ProbeOutcome {
  if (status === 200 || status === 404) return status === 200 ? "allowed" : "other";
  if (status === 401 || status === 403) return "denied";
  return "other";
}

/** Reads one document through the REST interface of the Firestore emulator. */
export async function probeDocument(
  firestoreHost: string,
  projectId: string,
  path: string,
  uid: string | null,
): Promise<ProbeOutcome> {
  const address = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const headers: Record<string, string> =
    uid === null ? {} : { Authorization: `Bearer ${emulatorToken(projectId, uid)}` };
  const response = await fetch(address, { headers });
  await response.arrayBuffer();
  return outcomeOf(response.status);
}

/** Downloads one object through the interface of the Storage emulator, which applies the storage rules. */
export async function probeObject(
  storageHost: string,
  bucket: string,
  name: string,
  projectId: string,
  uid: string | null,
): Promise<ProbeOutcome> {
  const address = `http://${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`;
  const headers: Record<string, string> =
    uid === null ? {} : { Authorization: `Firebase ${emulatorToken(projectId, uid)}` };
  const response = await fetch(address, { headers });
  await response.arrayBuffer();
  return outcomeOf(response.status);
}
