// The client for callable functions. Input and output types come from the contract in
// @eegml/shared, and both are validated here as well as on the server.
import type { CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { httpsCallable } from "firebase/functions";
import { CallableError, toCallableError } from "./callable-error";
import { functions } from "./firebase";

/**
 * Calls a function by its contract. Always rejects with a `CallableError`, whose message can
 * be shown as it stands.
 */
export async function callFunction<C extends CallableContract>(
  contract: C,
  input: CallableInput<C>,
): Promise<CallableOutput<C>> {
  const request = contract.input.safeParse(input);
  // A caller that builds its input from what a person typed validates it first. Input that
  // still does not match the contract is a fault of the interface, and nothing is sent.
  if (!request.success) throw new CallableError("invalid-argument");
  let response: unknown;
  try {
    response = (await httpsCallable(functions, contract.name)(request.data)).data;
  } catch (error) {
    throw toCallableError(error);
  }
  const output = contract.output.safeParse(response);
  if (!output.success) throw new CallableError("internal");
  return output.data as CallableOutput<C>;
}
