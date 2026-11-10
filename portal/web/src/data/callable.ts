// The client for callable functions. Input and output types come from the contract in
// @eegml/shared, and both are validated here as well as on the server.
import type { CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/** The reasons a call can fail, as the interface needs to tell them apart. */
export type CallableErrorCode =
  | "invalid-argument"
  | "failed-precondition"
  | "permission-denied"
  | "not-found"
  | "already-exists"
  | "resource-exhausted"
  | "unauthenticated"
  | "unavailable"
  | "internal";

/** Codes the server raises on purpose, with a message written for the person using the portal. */
const DELIBERATE: readonly CallableErrorCode[] = [
  "invalid-argument",
  "failed-precondition",
  "permission-denied",
  "not-found",
  "already-exists",
  "resource-exhausted",
];

const GENERAL_MESSAGES: Record<"unauthenticated" | "unavailable" | "internal", string> = {
  unauthenticated: "Your session has ended. Sign in again to continue.",
  unavailable: "The portal could not reach its server. Check your connection and try again.",
  internal: "Something went wrong on our side. Try again in a moment.",
};

export class CallableError extends Error {
  override readonly name = "CallableError";

  constructor(
    readonly code: CallableErrorCode,
    /** Safe to show to the person using the portal. */
    message: string,
  ) {
    super(message);
  }
}

function toCallableError(error: unknown): CallableError {
  const raw = (error as { code?: unknown }).code;
  const code = typeof raw === "string" ? raw.replace(/^functions\//, "") : "";
  if ((DELIBERATE as readonly string[]).includes(code)) {
    // The SDK appends the HTTP status, for example " [400]", to the server's message.
    const message = error instanceof Error ? error.message.replace(/\s*\[\d{3}\]$/, "") : "";
    return new CallableError(code as CallableErrorCode, message || GENERAL_MESSAGES.internal);
  }
  if (code === "unauthenticated") return new CallableError(code, GENERAL_MESSAGES.unauthenticated);
  if (code === "unavailable" || code === "deadline-exceeded") {
    return new CallableError("unavailable", GENERAL_MESSAGES.unavailable);
  }
  return new CallableError("internal", GENERAL_MESSAGES.internal);
}

/**
 * Calls a function by its contract. Rejects with a `CallableError`, whose message can be shown
 * as it stands.
 */
export async function callFunction<C extends CallableContract>(
  contract: C,
  input: CallableInput<C>,
): Promise<CallableOutput<C>> {
  const request = contract.input.parse(input);
  let response: unknown;
  try {
    response = (await httpsCallable(functions, contract.name)(request)).data;
  } catch (error) {
    throw toCallableError(error);
  }
  const output = contract.output.safeParse(response);
  if (!output.success) throw new CallableError("internal", GENERAL_MESSAGES.internal);
  return output.data as CallableOutput<C>;
}
