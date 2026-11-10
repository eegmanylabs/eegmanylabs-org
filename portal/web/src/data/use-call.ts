// The answer of a callable function that reads, as a value a view can render with the same
// loading and error states as live data. It is asked for again on request, for example after
// an action has changed what it lists.
import type { CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { useCallback, useEffect, useState } from "react";
import { callFunction } from "./callable";
import { CallableError } from "./callable-error";
import type { Live } from "./subscription-cache";

export interface CallResult<T> {
  readonly live: Live<T>;
  /** Asks the function again. The previous answer stays on screen until the new one arrives. */
  reload(): void;
}

/**
 * Calls a function that reads, whenever `key` changes, and on `reload`. Pass a null input to
 * call nothing. `key` describes the input, so that a new object with the same content does not
 * call again.
 */
export function useCallResult<C extends CallableContract>(
  contract: C,
  input: CallableInput<C> | null,
  key: string,
): CallResult<CallableOutput<C>> {
  const [live, setLive] = useState<Live<CallableOutput<C>>>({ status: input === null ? "idle" : "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the input, and `attempt` is the reload trigger
  useEffect(() => {
    if (input === null) {
      setLive({ status: "idle" });
      return;
    }
    let current = true;
    setLive((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    callFunction(contract, input).then(
      (data) => current && setLive({ status: "ready", data, fromCache: false, hasPendingWrites: false }),
      (error: unknown) => {
        const failure = error instanceof CallableError ? error : new CallableError("internal");
        if (current) setLive({ status: "error", error: { code: failure.code, message: failure.message } });
      },
    );
    return () => {
      current = false;
    };
  }, [contract, key, attempt]);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { live, reload };
}
