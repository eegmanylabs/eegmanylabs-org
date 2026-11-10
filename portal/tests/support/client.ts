// A browser stand-in for integration tests: the Firebase web SDK running in Node, connected to
// the emulators. Each client is a separate app instance, so each has its own signed-in account.
import type { CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { FUNCTIONS_REGION } from "@eegml/shared";
import { deleteApp, type FirebaseApp, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  type User,
} from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { AUTH_URL, HOST, latestSignInLink, PORTS, PROJECT_ID } from "./emulators";

export interface TestClient {
  readonly app: FirebaseApp;
  readonly auth: Auth;
  /** Calls a function by its contract, as the web application does. */
  call<C extends CallableContract>(contract: C, input: CallableInput<C>): Promise<CallableOutput<C>>;
  /** Calls a function with arbitrary data, to test what the function does with bad input. */
  callRaw(name: string, data: unknown): Promise<unknown>;
  close(): Promise<void>;
}

let created = 0;

export function createTestClient(): TestClient {
  created += 1;
  const app = initializeApp(
    { apiKey: "fake-api-key", projectId: PROJECT_ID, appId: "1:1:web:test" },
    `test-client-${created}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_URL, { disableWarnings: true });
  const functions = getFunctions(app, FUNCTIONS_REGION);
  connectFunctionsEmulator(functions, HOST, PORTS.functions);
  const callRaw = async (name: string, data: unknown) => (await httpsCallable(functions, name)(data)).data;
  return {
    app,
    auth,
    callRaw,
    call: async (contract, input) => contract.output.parse(await callRaw(contract.name, input)) as never,
    close: () => deleteApp(app),
  };
}

/** The whole passwordless sign-in: request the link, read it from the emulator, complete it. */
export async function signInWithEmailLinkFromEmulator(client: TestClient, email: string): Promise<User> {
  await sendSignInLinkToEmail(client.auth, email, { url: "http://127.0.0.1/", handleCodeInApp: true });
  const credential = await signInWithEmailLink(client.auth, email, await latestSignInLink(email));
  return credential.user;
}

/** An account whose email address has not been verified, which email-link sign-in never produces. */
export async function signUpWithUnverifiedEmail(client: TestClient, email: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(client.auth, email, "not-a-real-password");
  return credential.user;
}

/** The error code of a rejected promise, or "(no error)". */
export async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return "(no error)";
}
